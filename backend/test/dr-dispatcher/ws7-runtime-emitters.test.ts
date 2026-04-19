/**
 * WS7 — Handler-level integration tests for M3 dispatch runtime emitters.
 *
 * Proves the actual wiring from command-dispatcher + timeout-checker into the
 * shared dispatch-emitter helpers:
 *   - a successful dispatcher run emits dispatch.loop.heartbeat exactly once
 *     per run, not per trade row
 *   - a successful run also updates dispatch.loop.alive via the shared M9
 *     latest-state model, with an m3.dispatch contributor marker in the
 *     detail payload
 *   - a failing dispatcher run emits dispatch.loop.stalled and does NOT emit
 *     a heartbeat (failure path doesn't claim success)
 *   - a successful timeout-checker run emits
 *     dispatch.timeout_checker.heartbeat exactly once per run
 *   - when the timeout-checker finds stale dispatch_commands, it ALSO emits
 *     dispatch.ack.stalled (stale-ack boundary, not ordinary failure)
 *   - when no stale rows are found, no ack.stalled is emitted
 *   - with governance flag OFF (or m3_dispatch slice OFF), the emitter helpers
 *     still receive a call but with a disabled-flag shape so the helper itself
 *     produces no runtime writes (runtime-off posture)
 *   - emitter throwing is swallowed; dispatcher / timeout-checker core flow
 *     still completes without surfacing the runtime failure to callers
 */

jest.mock("../../src/shared/runtime/dispatch-emitters", () => ({
  emitDispatchLoopHeartbeat: jest.fn(async () => ({ status: "persisted" })),
  emitDispatchLoopStalled: jest.fn(async () => ({ status: "persisted" })),
  emitDispatchTimeoutCheckerHeartbeat: jest.fn(async () => ({
    status: "persisted",
  })),
  emitDispatchAckStalled: jest.fn(async () => ({ status: "persisted" })),
  maybeEmitDispatchAckRecovered: jest.fn(async () => ({
    status: "no_active_issue",
  })),
  recordDispatchLoopAlive: jest.fn(async () => ({ status: "persisted" })),
}));

jest.mock("node-cron", () => ({
  schedule: jest.fn(),
}));

import type { Pool, PoolClient } from "pg";
import { runCommandDispatcher } from "../../src/dr-dispatcher/services/command-dispatcher";
import { runTimeoutChecker } from "../../src/dr-dispatcher/handlers/timeout-checker";
import {
  emitDispatchAckStalled,
  emitDispatchLoopHeartbeat,
  emitDispatchLoopStalled,
  emitDispatchTimeoutCheckerHeartbeat,
  maybeEmitDispatchAckRecovered,
  recordDispatchLoopAlive,
} from "../../src/shared/runtime/dispatch-emitters";

const emitDispatchLoopHeartbeatMock =
  emitDispatchLoopHeartbeat as jest.Mock;
const emitDispatchLoopStalledMock = emitDispatchLoopStalled as jest.Mock;
const emitDispatchTimeoutCheckerHeartbeatMock =
  emitDispatchTimeoutCheckerHeartbeat as jest.Mock;
const emitDispatchAckStalledMock = emitDispatchAckStalled as jest.Mock;
const maybeEmitDispatchAckRecoveredMock =
  maybeEmitDispatchAckRecovered as jest.Mock;
const recordDispatchLoopAliveMock = recordDispatchLoopAlive as jest.Mock;

const ENV_ON = {
  RUNTIME_GOVERNANCE_ENABLED: "true",
  RUNTIME_EMIT_M3_DISPATCH: "true",
} as const;

const ENV_OFF = {
  RUNTIME_GOVERNANCE_ENABLED: "false",
  RUNTIME_EMIT_M3_DISPATCH: "false",
} as const;

function applyEnv(env: Record<string, string>): void {
  for (const [k, v] of Object.entries(env)) {
    process.env[k] = v;
  }
}

function clearEnv(): void {
  delete process.env.RUNTIME_GOVERNANCE_ENABLED;
  delete process.env.RUNTIME_EMIT_M3_DISPATCH;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pool mocks
// ─────────────────────────────────────────────────────────────────────────────

interface FakeClient {
  query: jest.Mock;
  release: jest.Mock;
}

function makeDispatcherPool(opts: {
  dueRows?: Array<Record<string, unknown>>;
  throwOn?: "BEGIN" | "SELECT" | null;
}): Pool {
  const dueRows = opts.dueRows ?? [];
  const query = jest.fn(async (sql: string, _params?: readonly unknown[]) => {
    if (/BEGIN/i.test(sql)) {
      if (opts.throwOn === "BEGIN") {
        throw new Error("begin-boom");
      }
      return { rows: [], rowCount: 0 };
    }
    if (/FROM trade_schedules\s+WHERE status = 'scheduled'/i.test(sql)) {
      if (opts.throwOn === "SELECT") {
        throw new Error("select-due-failed");
      }
      return { rows: dueRows, rowCount: dueRows.length };
    }
    if (/UPDATE trade_schedules/i.test(sql)) {
      return { rows: [], rowCount: dueRows.length };
    }
    if (/INSERT INTO dispatch_commands/i.test(sql)) {
      return { rows: [], rowCount: 1 };
    }
    if (/FROM assets a/i.test(sql) || /LEFT JOIN gateways/i.test(sql)) {
      return {
        rows: [{ contracted_demand_kw: 0, billing_power_factor: 0.92 }],
        rowCount: 1,
      };
    }
    if (/INSERT INTO dispatch_records/i.test(sql)) {
      return { rows: [], rowCount: 1 };
    }
    if (/COMMIT|ROLLBACK/i.test(sql)) {
      return { rows: [], rowCount: 0 };
    }
    return { rows: [], rowCount: 0 };
  });
  const release = jest.fn();
  const client: FakeClient = { query, release };
  return {
    connect: jest.fn(async () => client as unknown as PoolClient),
  } as unknown as Pool;
}

function makeTimeoutCheckerPool(opts: {
  staleRows?: Array<{ id: number; trade_id: number }>;
  throwOn?: "BEGIN" | "SELECT" | null;
}): Pool {
  const staleRows = opts.staleRows ?? [];
  const query = jest.fn(async (sql: string, _params?: readonly unknown[]) => {
    if (/BEGIN/i.test(sql)) {
      if (opts.throwOn === "BEGIN") {
        throw new Error("begin-boom");
      }
      return { rows: [], rowCount: 0 };
    }
    if (/FROM dispatch_commands\s+WHERE status = 'dispatched'/i.test(sql)) {
      if (opts.throwOn === "SELECT") {
        throw new Error("stale-select-failed");
      }
      return { rows: staleRows, rowCount: staleRows.length };
    }
    if (/UPDATE dispatch_commands/i.test(sql)) {
      return { rows: [], rowCount: staleRows.length };
    }
    if (/UPDATE trade_schedules/i.test(sql)) {
      return { rows: [], rowCount: staleRows.length };
    }
    if (/COMMIT|ROLLBACK/i.test(sql)) {
      return { rows: [], rowCount: 0 };
    }
    return { rows: [], rowCount: 0 };
  });
  const release = jest.fn();
  const client: FakeClient = { query, release };
  return {
    connect: jest.fn(async () => client as unknown as PoolClient),
  } as unknown as Pool;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("WS7 command-dispatcher runtime emitters", () => {
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

  it("emits dispatch.loop.heartbeat exactly once per successful run (not per trade)", async () => {
    const pool = makeDispatcherPool({
      dueRows: [
        {
          id: 1,
          asset_id: "A",
          org_id: "O",
          action: "charge",
          expected_volume_kwh: 4,
          target_mode: null,
        },
        {
          id: 2,
          asset_id: "B",
          org_id: "O",
          action: "discharge",
          expected_volume_kwh: 5,
          target_mode: null,
        },
      ],
    });
    await runCommandDispatcher(pool);

    expect(emitDispatchLoopHeartbeatMock).toHaveBeenCalledTimes(1);
    const [opts, input] = emitDispatchLoopHeartbeatMock.mock.calls[0];
    expect(opts.flags.governanceEnabled).toBe(true);
    expect(opts.flags.slices.m3_dispatch).toBe(true);
    expect(input.commandsDispatched).toBe(2);
    expect(input.runStartedAt).toBeInstanceOf(Date);
    expect(typeof input.durationMs).toBe("number");
    expect(emitDispatchLoopStalledMock).not.toHaveBeenCalled();
  });

  it("contributes to dispatch.loop.alive on successful run with m3 contributor marker", async () => {
    const pool = makeDispatcherPool({
      dueRows: [
        {
          id: 1,
          asset_id: "A",
          org_id: "O",
          action: "charge",
          expected_volume_kwh: 4,
          target_mode: null,
        },
      ],
    });
    await runCommandDispatcher(pool);

    expect(recordDispatchLoopAliveMock).toHaveBeenCalledTimes(1);
    const [opts, input] = recordDispatchLoopAliveMock.mock.calls[0];
    expect(opts.flags.slices.m3_dispatch).toBe(true);
    expect(input.observedAt).toBeInstanceOf(Date);
    expect(typeof input.durationMs).toBe("number");
    expect(input.detail).toMatchObject({
      commands_dispatched: 1,
    });
  });

  it("emits dispatch.loop.stalled on error and skips heartbeat/self-check", async () => {
    const pool = makeDispatcherPool({ throwOn: "SELECT" });
    await runCommandDispatcher(pool);

    expect(emitDispatchLoopStalledMock).toHaveBeenCalledTimes(1);
    const [opts, input] = emitDispatchLoopStalledMock.mock.calls[0];
    expect(opts.flags.slices.m3_dispatch).toBe(true);
    expect(input.error).toBeInstanceOf(Error);
    expect(input.error.message).toBe("select-due-failed");
    expect(input.phase).toBe("run");
    expect(input.runStartedAt).toBeInstanceOf(Date);

    // No heartbeat or loop-alive on failure path.
    expect(emitDispatchLoopHeartbeatMock).not.toHaveBeenCalled();
    expect(recordDispatchLoopAliveMock).not.toHaveBeenCalled();
  });

  it("passes disabled-flag shape when runtime governance is off (emitter decides no-op)", async () => {
    applyEnv(ENV_OFF);
    const pool = makeDispatcherPool({ dueRows: [] });
    await runCommandDispatcher(pool);

    expect(emitDispatchLoopHeartbeatMock).toHaveBeenCalledTimes(1);
    const [opts] = emitDispatchLoopHeartbeatMock.mock.calls[0];
    expect(opts.flags.governanceEnabled).toBe(false);
    expect(opts.flags.slices.m3_dispatch).toBe(false);

    expect(recordDispatchLoopAliveMock).toHaveBeenCalledTimes(1);
    const [opts2] = recordDispatchLoopAliveMock.mock.calls[0];
    expect(opts2.flags.slices.m3_dispatch).toBe(false);
  });

  it("emitter throwing is swallowed; dispatcher core flow still completes", async () => {
    emitDispatchLoopHeartbeatMock.mockImplementationOnce(async () => {
      throw new Error("emitter boom");
    });
    recordDispatchLoopAliveMock.mockImplementationOnce(async () => {
      throw new Error("self-check boom");
    });

    const pool = makeDispatcherPool({ dueRows: [] });
    let threw = false;
    try {
      await runCommandDispatcher(pool);
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);

    // Core DB path still executed (BEGIN + SELECT + COMMIT).
    const connectMock = pool.connect as unknown as jest.Mock;
    expect(connectMock).toHaveBeenCalled();
  });
});

describe("WS7 timeout-checker runtime emitters", () => {
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

  it("emits dispatch.timeout_checker.heartbeat exactly once per successful run and drives canonical ack recovery when zero stale rows are observed (I4a)", async () => {
    const pool = makeTimeoutCheckerPool({ staleRows: [] });
    await runTimeoutChecker(pool);

    expect(emitDispatchTimeoutCheckerHeartbeatMock).toHaveBeenCalledTimes(1);
    const [opts, input] = emitDispatchTimeoutCheckerHeartbeatMock.mock.calls[0];
    expect(opts.flags.slices.m3_dispatch).toBe(true);
    expect(input.staleCommandsFailed).toBe(0);
    expect(input.runStartedAt).toBeInstanceOf(Date);
    expect(typeof input.durationMs).toBe("number");
    // No stale rows → no ack.stalled fact.
    expect(emitDispatchAckStalledMock).not.toHaveBeenCalled();

    // I4a: canonical recovery authority is consulted on zero-stale runs so a
    // prior dispatch.ack.stalled issue can transition out of active state.
    expect(maybeEmitDispatchAckRecoveredMock).toHaveBeenCalledTimes(1);
    const [recOpts, recInput] = maybeEmitDispatchAckRecoveredMock.mock.calls[0];
    expect(recOpts.flags.slices.m3_dispatch).toBe(true);
    expect(recInput.cutoffSeconds).toBe(900);
    expect(recInput.observedAt).toBeInstanceOf(Date);
  });

  it("emits dispatch.ack.stalled ONLY when stale rows are found and does NOT call the recovery helper on the same run", async () => {
    const pool = makeTimeoutCheckerPool({
      staleRows: [
        { id: 11, trade_id: 101 },
        { id: 12, trade_id: 102 },
        { id: 13, trade_id: 103 },
      ],
    });
    await runTimeoutChecker(pool);

    expect(emitDispatchTimeoutCheckerHeartbeatMock).toHaveBeenCalledTimes(1);
    const [, hbInput] = emitDispatchTimeoutCheckerHeartbeatMock.mock.calls[0];
    expect(hbInput.staleCommandsFailed).toBe(3);

    expect(emitDispatchAckStalledMock).toHaveBeenCalledTimes(1);
    const [ackOpts, ackInput] = emitDispatchAckStalledMock.mock.calls[0];
    expect(ackOpts.flags.slices.m3_dispatch).toBe(true);
    expect(ackInput.staleCount).toBe(3);
    expect(ackInput.cutoffSeconds).toBe(900);
    expect(ackInput.observedAt).toBeInstanceOf(Date);
    expect(ackInput.sampleDispatchIds).toEqual([11, 12, 13]);

    // Detect and recover are mutually exclusive per run: a run that observes
    // stale rows must not ALSO emit recovery — the canonical lifecycle must
    // see the detect event, not a simultaneous recover.
    expect(maybeEmitDispatchAckRecoveredMock).not.toHaveBeenCalled();
  });

  it("does NOT emit heartbeat or ack.stalled on a DB error (early-return)", async () => {
    const pool = makeTimeoutCheckerPool({ throwOn: "SELECT" });
    await runTimeoutChecker(pool);

    expect(emitDispatchTimeoutCheckerHeartbeatMock).not.toHaveBeenCalled();
    expect(emitDispatchAckStalledMock).not.toHaveBeenCalled();
  });

  it("passes disabled-flag shape when runtime governance is off (emitter decides no-op)", async () => {
    applyEnv(ENV_OFF);
    const pool = makeTimeoutCheckerPool({ staleRows: [] });
    await runTimeoutChecker(pool);

    expect(emitDispatchTimeoutCheckerHeartbeatMock).toHaveBeenCalledTimes(1);
    const [opts] = emitDispatchTimeoutCheckerHeartbeatMock.mock.calls[0];
    expect(opts.flags.governanceEnabled).toBe(false);
    expect(opts.flags.slices.m3_dispatch).toBe(false);
  });

  it("emitter throwing is swallowed; timeout-checker core flow still completes", async () => {
    emitDispatchTimeoutCheckerHeartbeatMock.mockImplementationOnce(async () => {
      throw new Error("emitter boom");
    });
    emitDispatchAckStalledMock.mockImplementationOnce(async () => {
      throw new Error("ack boom");
    });

    const pool = makeTimeoutCheckerPool({
      staleRows: [{ id: 42, trade_id: 420 }],
    });
    let threw = false;
    try {
      await runTimeoutChecker(pool);
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);

    const connectMock = pool.connect as unknown as jest.Mock;
    expect(connectMock).toHaveBeenCalled();
  });
});
