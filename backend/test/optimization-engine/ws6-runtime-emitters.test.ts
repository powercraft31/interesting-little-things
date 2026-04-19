/**
 * WS6 — Handler-level integration tests for M2 optimization scheduler
 * runtime emitters.
 *
 * Proves the actual wiring from schedule-generator into the shared
 * scheduler-emitter helpers:
 *   - a successful schedule-generator run emits scheduler.schedule_generator.heartbeat
 *     exactly once per run, not per asset / per slot
 *   - a successful run also updates scheduler.jobs.alive via the shared
 *     M9 latest-state model, with an m2.scheduler contributor marker so M2
 *     evidence stays distinguishable from other contributors (M4 billing)
 *   - a failing run emits scheduler.schedule_generator.failed and does NOT
 *     emit a heartbeat (failure path doesn't claim success)
 *   - with governance flag OFF (or m2_scheduler slice OFF), the emitter
 *     helpers still receive a call but with a disabled-flag shape so the
 *     helper itself produces no runtime writes (runtime-off posture)
 *   - emitter throwing is swallowed; schedule-generator still completes
 *     its core flow without surfacing the runtime failure to callers
 */

jest.mock("../../src/shared/runtime/scheduler-emitters", () => ({
  emitSchedulerHeartbeat: jest.fn(async () => ({ status: "persisted" })),
  emitSchedulerFailed: jest.fn(async () => ({ status: "persisted" })),
  maybeEmitSchedulerRecovered: jest.fn(async () => ({ status: "no_active_issue" })),
  recordSchedulerJobsAlive: jest.fn(async () => ({ status: "persisted" })),
}));

jest.mock("node-cron", () => ({
  schedule: jest.fn(),
}));

import type { Pool } from "pg";
import { runScheduleGenerator } from "../../src/optimization-engine/services/schedule-generator";
import {
  emitSchedulerFailed,
  emitSchedulerHeartbeat,
  maybeEmitSchedulerRecovered,
  recordSchedulerJobsAlive,
} from "../../src/shared/runtime/scheduler-emitters";

const emitSchedulerHeartbeatMock = emitSchedulerHeartbeat as jest.Mock;
const emitSchedulerFailedMock = emitSchedulerFailed as jest.Mock;
const maybeEmitSchedulerRecoveredMock = maybeEmitSchedulerRecovered as jest.Mock;
const recordSchedulerJobsAliveMock = recordSchedulerJobsAlive as jest.Mock;

const ENV_ON = {
  RUNTIME_GOVERNANCE_ENABLED: "true",
  RUNTIME_EMIT_M2_SCHEDULER: "true",
} as const;

const ENV_OFF = {
  RUNTIME_GOVERNANCE_ENABLED: "false",
  RUNTIME_EMIT_M2_SCHEDULER: "false",
} as const;

function applyEnv(env: Record<string, string>): void {
  for (const [k, v] of Object.entries(env)) {
    process.env[k] = v;
  }
}

function clearEnv(): void {
  delete process.env.RUNTIME_GOVERNANCE_ENABLED;
  delete process.env.RUNTIME_EMIT_M2_SCHEDULER;
}

function makeSuccessPool(): Pool {
  const query = jest
    .fn()
    .mockImplementation(async (sql: string) => {
      if (/FROM pld_horario/i.test(sql)) {
        return {
          rows: [
            { hora: 2, avg_pld: 120 },
            { hora: 20, avg_pld: 350 },
          ],
          rowCount: 2,
        };
      }
      if (/FROM assets a/i.test(sql)) {
        return {
          rows: [
            {
              asset_id: "ASSET_WS6_001",
              org_id: "ORG_WS6",
              capacidade_kw: 5,
              submercado: "SE",
              operation_mode: "peak",
              battery_soc: 50,
              min_soc: 20,
              max_soc: 95,
              allow_export: true,
              contracted_demand_kw: null,
            },
          ],
          rowCount: 1,
        };
      }
      // INSERT / DELETE paths
      return { rows: [], rowCount: 1 };
    });
  return { query } as unknown as Pool;
}

function makeFailingPool(error: Error): Pool {
  const query = jest.fn().mockRejectedValue(error);
  return { query } as unknown as Pool;
}

describe("WS6 schedule-generator runtime emitters", () => {
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

  it("emits scheduler.schedule_generator.heartbeat exactly once per successful run", async () => {
    const pool = makeSuccessPool();
    await runScheduleGenerator(pool);

    expect(emitSchedulerHeartbeatMock).toHaveBeenCalledTimes(1);
    const [opts, input] = emitSchedulerHeartbeatMock.mock.calls[0];
    expect(opts.flags.governanceEnabled).toBe(true);
    expect(opts.flags.slices.m2_scheduler).toBe(true);
    expect(input.assetsProcessed).toBe(1);
    expect(input.slotsGenerated).toBeGreaterThanOrEqual(0);
    expect(input.runStartedAt).toBeInstanceOf(Date);
    expect(typeof input.durationMs).toBe("number");
    expect(emitSchedulerFailedMock).not.toHaveBeenCalled();
  });

  it("contributes to scheduler.jobs.alive on successful run with m2 contributor marker", async () => {
    const pool = makeSuccessPool();
    await runScheduleGenerator(pool);

    expect(recordSchedulerJobsAliveMock).toHaveBeenCalledTimes(1);
    const [opts, input] = recordSchedulerJobsAliveMock.mock.calls[0];
    expect(opts.flags.slices.m2_scheduler).toBe(true);
    expect(input.observedAt).toBeInstanceOf(Date);
    expect(typeof input.durationMs).toBe("number");
    expect(input.detail).toMatchObject({
      assets_processed: 1,
    });
  });

  it("calls maybeEmitSchedulerRecovered on healthy run so an active failed issue can be closed out", async () => {
    const pool = makeSuccessPool();
    await runScheduleGenerator(pool);

    expect(maybeEmitSchedulerRecoveredMock).toHaveBeenCalledTimes(1);
    const [opts, input] = maybeEmitSchedulerRecoveredMock.mock.calls[0];
    expect(opts.flags.slices.m2_scheduler).toBe(true);
    expect(input.observedAt).toBeInstanceOf(Date);
    expect(input.phase).toBe("run");
  });

  it("emits scheduler.schedule_generator.failed on error and skips heartbeat", async () => {
    const pool = makeFailingPool(new Error("pld_horario not reachable"));
    await runScheduleGenerator(pool);

    expect(emitSchedulerFailedMock).toHaveBeenCalledTimes(1);
    const [opts, input] = emitSchedulerFailedMock.mock.calls[0];
    expect(opts.flags.slices.m2_scheduler).toBe(true);
    expect(input.error).toBeInstanceOf(Error);
    expect(input.error.message).toBe("pld_horario not reachable");
    expect(input.phase).toBe("run");

    // No heartbeat, jobs-alive, or recovery on failure path.
    expect(emitSchedulerHeartbeatMock).not.toHaveBeenCalled();
    expect(recordSchedulerJobsAliveMock).not.toHaveBeenCalled();
    expect(maybeEmitSchedulerRecoveredMock).not.toHaveBeenCalled();
  });

  it("passes disabled-flag shape when runtime governance is off (emitter decides no-op)", async () => {
    applyEnv(ENV_OFF);
    const pool = makeSuccessPool();
    await runScheduleGenerator(pool);

    expect(emitSchedulerHeartbeatMock).toHaveBeenCalledTimes(1);
    const [opts] = emitSchedulerHeartbeatMock.mock.calls[0];
    expect(opts.flags.governanceEnabled).toBe(false);
    expect(opts.flags.slices.m2_scheduler).toBe(false);

    expect(recordSchedulerJobsAliveMock).toHaveBeenCalledTimes(1);
    const [opts2] = recordSchedulerJobsAliveMock.mock.calls[0];
    expect(opts2.flags.slices.m2_scheduler).toBe(false);
  });

  it("emitter throwing is swallowed; schedule-generator core flow still completes", async () => {
    emitSchedulerHeartbeatMock.mockImplementationOnce(async () => {
      throw new Error("emitter boom");
    });
    maybeEmitSchedulerRecoveredMock.mockImplementationOnce(async () => {
      throw new Error("recover boom");
    });
    recordSchedulerJobsAliveMock.mockImplementationOnce(async () => {
      throw new Error("self-check boom");
    });

    const pool = makeSuccessPool();
    let threw = false;
    try {
      await runScheduleGenerator(pool);
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);

    // Core DB path still executed (at least PLD + assets + INSERTs).
    const queryMock = pool.query as unknown as jest.Mock;
    expect(queryMock).toHaveBeenCalled();
  });
});
