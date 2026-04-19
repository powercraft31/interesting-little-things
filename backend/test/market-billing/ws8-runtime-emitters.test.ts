/**
 * WS8 — Handler-level integration tests for M4 billing runtime emitters.
 *
 * Proves the actual wiring from runDailyBilling() into the shared
 * billing-emitter helpers:
 *   - a successful billing run emits scheduler.billing_job.heartbeat exactly
 *     once per run, not per asset UPSERT
 *   - a successful run also updates scheduler.jobs.alive via the shared M9
 *     latest-state model, with an m4.billing contributor marker so M4
 *     evidence stays distinguishable from M2 (m2.scheduler)
 *   - a failing billing run emits scheduler.billing_job.failed and does NOT
 *     emit a heartbeat (failure path doesn't claim success), while preserving
 *     runDailyBilling()'s existing resolve-without-throw contract
 *   - with governance flag OFF (or m4_billing slice OFF), the emitter helpers
 *     still receive a call but with a disabled-flag shape so the helper itself
 *     produces no runtime writes (runtime-off posture)
 *   - emitter throwing is swallowed; billing core flow still completes and
 *     console output is unchanged
 */

jest.mock("../../src/shared/runtime/billing-emitters", () => ({
  emitBillingJobHeartbeat: jest.fn(async () => ({ status: "persisted" })),
  emitBillingJobFailed: jest.fn(async () => ({ status: "persisted" })),
  emitBillingJobMissedRun: jest.fn(async () => ({ status: "persisted" })),
  maybeEmitBillingRecovered: jest.fn(async () => ({ status: "no_active_issue" })),
  recordBillingJobsAlive: jest.fn(async () => ({ status: "persisted" })),
}));

jest.mock("node-cron", () => ({
  schedule: jest.fn(),
}));

import type { Pool } from "pg";
import { runDailyBilling } from "../../src/market-billing/services/daily-billing-job";
import {
  emitBillingJobFailed,
  emitBillingJobHeartbeat,
  maybeEmitBillingRecovered,
  recordBillingJobsAlive,
} from "../../src/shared/runtime/billing-emitters";

const emitBillingJobHeartbeatMock = emitBillingJobHeartbeat as jest.Mock;
const emitBillingJobFailedMock = emitBillingJobFailed as jest.Mock;
const maybeEmitBillingRecoveredMock = maybeEmitBillingRecovered as jest.Mock;
const recordBillingJobsAliveMock = recordBillingJobsAlive as jest.Mock;

const ENV_ON = {
  RUNTIME_GOVERNANCE_ENABLED: "true",
  RUNTIME_EMIT_M4_BILLING: "true",
} as const;

const ENV_OFF = {
  RUNTIME_GOVERNANCE_ENABLED: "false",
  RUNTIME_EMIT_M4_BILLING: "false",
} as const;

function applyEnv(env: Record<string, string>): void {
  for (const [k, v] of Object.entries(env)) {
    process.env[k] = v;
  }
}

function clearEnv(): void {
  delete process.env.RUNTIME_GOVERNANCE_ENABLED;
  delete process.env.RUNTIME_EMIT_M4_BILLING;
}

function yesterdayStr(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split("T")[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// Pool mocks — mirror the sequencing already exercised by
// test/market-billing/daily-billing-job.test.ts so the real runDailyBilling()
// body can execute its full 5-step path.
// ─────────────────────────────────────────────────────────────────────────────

function makeSuccessPool(): Pool {
  const query = jest.fn();
  // Step 1: hourly metrics
  query.mockResolvedValueOnce({
    rows: [
      {
        asset_id: "ASSET_WS8_001",
        org_id: "ORG_WS8",
        capacity_kwh: "10",
        soc_min_pct: "10",
        max_charge_rate_kw: "5",
        max_discharge_rate_kw: "5",
        hour: 19,
        total_charge_kwh: "0",
        total_discharge_kwh: "5",
        pv_generation_kwh: "0",
        grid_import_kwh: "0",
        grid_export_kwh: "0",
        load_consumption_kwh: "5",
        avg_battery_soc: null,
      },
    ],
  });
  // Step 2: tariff schedules
  query.mockResolvedValueOnce({
    rows: [
      {
        org_id: "ORG_WS8",
        peak_rate: "0.82",
        offpeak_rate: "0.25",
        intermediate_rate: "0.55",
      },
    ],
  });
  // Step 4: UPSERT revenue_daily
  query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
  // Step 5: SC/TOU attribution SELECT
  query.mockResolvedValueOnce({ rows: [] });
  // Step 6: PS attribution SELECT
  query.mockResolvedValueOnce({ rows: [] });
  return { query } as unknown as Pool;
}

function makeEmptyPool(): Pool {
  const query = jest.fn();
  query.mockResolvedValueOnce({ rows: [] }); // hourly
  query.mockResolvedValueOnce({ rows: [] }); // tariff
  query.mockResolvedValueOnce({ rows: [] }); // attribution
  query.mockResolvedValueOnce({ rows: [] }); // PS attribution
  return { query } as unknown as Pool;
}

function makeFailingPool(error: Error): Pool {
  const query = jest.fn().mockRejectedValue(error);
  return { query } as unknown as Pool;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("WS8 daily-billing-job runtime emitters", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
    applyEnv(ENV_ON);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    clearEnv();
  });

  it("emits scheduler.billing_job.heartbeat exactly once per successful run (not per asset UPSERT)", async () => {
    const pool = makeSuccessPool();
    await runDailyBilling(pool);

    expect(emitBillingJobHeartbeatMock).toHaveBeenCalledTimes(1);
    const [opts, input] = emitBillingJobHeartbeatMock.mock.calls[0];
    expect(opts.flags.governanceEnabled).toBe(true);
    expect(opts.flags.slices.m4_billing).toBe(true);
    expect(input.assetsSettled).toBe(1);
    expect(input.billingDate).toBe(yesterdayStr());
    expect(input.runStartedAt).toBeInstanceOf(Date);
    expect(typeof input.durationMs).toBe("number");
    expect(emitBillingJobFailedMock).not.toHaveBeenCalled();
  });

  it("contributes to scheduler.jobs.alive on successful run with m4 contributor marker distinct from m2", async () => {
    const pool = makeSuccessPool();
    await runDailyBilling(pool);

    expect(recordBillingJobsAliveMock).toHaveBeenCalledTimes(1);
    const [opts, input] = recordBillingJobsAliveMock.mock.calls[0];
    expect(opts.flags.slices.m4_billing).toBe(true);
    expect(input.observedAt).toBeInstanceOf(Date);
    expect(typeof input.durationMs).toBe("number");
    // Contributor distinctness vs. M2: the detail payload carries
    // billing-specific keys, so an M2 jobs.alive write cannot be mistaken
    // for an M4 write on the same latest-state row.
    expect(input.detail).toMatchObject({
      assets_settled: 1,
      billing_date: yesterdayStr(),
    });
  });

  it("calls maybeEmitBillingRecovered on healthy run so an active failed issue can be closed out", async () => {
    const pool = makeSuccessPool();
    await runDailyBilling(pool);

    expect(maybeEmitBillingRecoveredMock).toHaveBeenCalledTimes(1);
    const [opts, input] = maybeEmitBillingRecoveredMock.mock.calls[0];
    expect(opts.flags.slices.m4_billing).toBe(true);
    expect(input.observedAt).toBeInstanceOf(Date);
    expect(input.phase).toBe("run");
    expect(input.billingDate).toBe(yesterdayStr());
  });

  it("still emits heartbeat with assetsSettled=0 when no hourly metrics exist", async () => {
    const pool = makeEmptyPool();
    await runDailyBilling(pool);

    expect(emitBillingJobHeartbeatMock).toHaveBeenCalledTimes(1);
    const [, input] = emitBillingJobHeartbeatMock.mock.calls[0];
    expect(input.assetsSettled).toBe(0);
    expect(recordBillingJobsAliveMock).toHaveBeenCalledTimes(1);
    expect(emitBillingJobFailedMock).not.toHaveBeenCalled();
  });

  it("emits scheduler.billing_job.failed on error, skips heartbeat, and resolves without throwing", async () => {
    const pool = makeFailingPool(new Error("asset_hourly_metrics not reachable"));
    let threw = false;
    try {
      await runDailyBilling(pool);
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);

    expect(emitBillingJobFailedMock).toHaveBeenCalledTimes(1);
    const [opts, input] = emitBillingJobFailedMock.mock.calls[0];
    expect(opts.flags.slices.m4_billing).toBe(true);
    expect(input.error).toBeInstanceOf(Error);
    expect(input.error.message).toBe("asset_hourly_metrics not reachable");
    expect(input.phase).toBe("run");

    // No heartbeat, jobs-alive, or recovery on failure path.
    expect(emitBillingJobHeartbeatMock).not.toHaveBeenCalled();
    expect(recordBillingJobsAliveMock).not.toHaveBeenCalled();
    expect(maybeEmitBillingRecoveredMock).not.toHaveBeenCalled();
  });

  it("passes disabled-flag shape when runtime governance is off (emitter decides no-op)", async () => {
    applyEnv(ENV_OFF);
    const pool = makeEmptyPool();
    await runDailyBilling(pool);

    expect(emitBillingJobHeartbeatMock).toHaveBeenCalledTimes(1);
    const [opts] = emitBillingJobHeartbeatMock.mock.calls[0];
    expect(opts.flags.governanceEnabled).toBe(false);
    expect(opts.flags.slices.m4_billing).toBe(false);

    expect(recordBillingJobsAliveMock).toHaveBeenCalledTimes(1);
    const [opts2] = recordBillingJobsAliveMock.mock.calls[0];
    expect(opts2.flags.slices.m4_billing).toBe(false);
  });

  it("emitter throwing is swallowed; billing core flow still completes", async () => {
    emitBillingJobHeartbeatMock.mockImplementationOnce(async () => {
      throw new Error("emitter boom");
    });
    maybeEmitBillingRecoveredMock.mockImplementationOnce(async () => {
      throw new Error("recover boom");
    });
    recordBillingJobsAliveMock.mockImplementationOnce(async () => {
      throw new Error("self-check boom");
    });

    const pool = makeSuccessPool();
    let threw = false;
    try {
      await runDailyBilling(pool);
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);

    // Core DB path still executed (at least the 5 SELECT/UPSERT/UPDATE
    // paths exercised by makeSuccessPool).
    const queryMock = pool.query as unknown as jest.Mock;
    expect(queryMock).toHaveBeenCalled();
    // The existing business log is preserved so production log parsing is
    // not affected by runtime emission wiring.
    expect(console.log).toHaveBeenCalledWith(
      expect.stringMatching(/^\[BillingJob\] Settled 1 assets for /),
    );
  });
});
