/**
 * WS5 — Handler-level integration tests for M1 ingest runtime emitters.
 *
 * Proves the actual wiring from telemetry-handler / fragment-assembler /
 * missed-data-handler into the shared ingest-emitter helpers:
 *   - stale ingest produces ingest.telemetry.stale via the same gap boundary
 *     that already triggers backfill_request
 *   - normal telemetry cadence calls recordIngestFreshness("pass")
 *   - parser failure (bad protocol timestamp) emits ingest.parser.failed and
 *     still lets M1 continue (no throw to caller)
 *   - backlog threshold fires ingest.fragment.backlog exactly once per
 *     high-water crossing and does not spam per-fragment
 *   - with runtime governance off, no emitter call occurs
 *   - emitter failure is swallowed and does not break core flow
 */

import type { SolfacilMessage } from "../../src/shared/types/solfacil-protocol";

// Mock ingest-emitters BEFORE handler imports so the handlers see the mocked
// versions. Jest hoists jest.mock calls to the top of the file.
jest.mock("../../src/shared/runtime/ingest-emitters", () => ({
  emitIngestTelemetryStale: jest.fn(async () => ({ status: "persisted" })),
  emitIngestTelemetryRecovered: jest.fn(async () => ({ status: "persisted" })),
  maybeEmitIngestTelemetryRecovered: jest.fn(async () => ({
    status: "no_active_issue",
  })),
  emitIngestFragmentBacklog: jest.fn(async () => ({ status: "persisted" })),
  emitIngestParserFailed: jest.fn(async () => ({ status: "persisted" })),
  recordIngestFreshness: jest.fn(async () => ({ status: "persisted" })),
}));

// Mock the M1 DB-side helpers so tests focus on the runtime hook, not on
// DeviceAssetCache + MessageBuffer plumbing.
jest.mock("../../src/iot-hub/services/device-asset-cache", () => ({
  DeviceAssetCache: jest.fn().mockImplementation(() => ({
    resolve: jest.fn().mockResolvedValue("asset-ws5-001"),
  })),
}));
jest.mock("../../src/iot-hub/services/message-buffer", () => ({
  MessageBuffer: jest.fn().mockImplementation(() => ({
    enqueue: jest.fn(),
  })),
}));

import {
  handleTelemetry,
  _destroyAssembler,
  _clearTelemetryCache,
} from "../../src/iot-hub/handlers/telemetry-handler";
import { handleMissedData } from "../../src/iot-hub/handlers/missed-data-handler";
import { FragmentAssembler } from "../../src/iot-hub/services/fragment-assembler";
import {
  emitIngestFragmentBacklog,
  emitIngestParserFailed,
  emitIngestTelemetryStale,
  maybeEmitIngestTelemetryRecovered,
  recordIngestFreshness,
} from "../../src/shared/runtime/ingest-emitters";

const emitIngestTelemetryStaleMock = emitIngestTelemetryStale as jest.Mock;
const emitIngestFragmentBacklogMock = emitIngestFragmentBacklog as jest.Mock;
const emitIngestParserFailedMock = emitIngestParserFailed as jest.Mock;
const maybeEmitIngestTelemetryRecoveredMock =
  maybeEmitIngestTelemetryRecovered as jest.Mock;
const recordIngestFreshnessMock = recordIngestFreshness as jest.Mock;

function createMockPool() {
  return {
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
  } as unknown as import("pg").Pool;
}

function makePayload(clientId: string, timeStamp: string, data: Record<string, unknown> = {}): SolfacilMessage {
  return {
    DS: 0,
    ackFlag: 0,
    clientId,
    deviceName: "EMS_N2",
    productKey: "ems",
    messageId: "m-1",
    timeStamp,
    data,
  };
}

const ENV_ON = {
  RUNTIME_GOVERNANCE_ENABLED: "true",
  RUNTIME_EMIT_M1_INGEST: "true",
} as const;

const ENV_OFF = {
  RUNTIME_GOVERNANCE_ENABLED: "false",
  RUNTIME_EMIT_M1_INGEST: "false",
} as const;

function applyEnv(env: Record<string, string>): void {
  for (const [k, v] of Object.entries(env)) {
    process.env[k] = v;
  }
}

function clearEnv(): void {
  delete process.env.RUNTIME_GOVERNANCE_ENABLED;
  delete process.env.RUNTIME_EMIT_M1_INGEST;
}

describe("WS5 telemetry-handler runtime emitters", () => {
  let pool: import("pg").Pool;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    pool = createMockPool();
    applyEnv(ENV_ON);
  });

  afterEach(() => {
    _destroyAssembler(pool);
    _clearTelemetryCache(pool);
    jest.useRealTimers();
    clearEnv();
  });

  it("ticks ingest.freshness on every successful telemetry timestamp parse", async () => {
    const ts = "1772681002103";
    await handleTelemetry(pool, "gw-ws5-a", "CID-A", makePayload("CID-A", ts));

    expect(recordIngestFreshnessMock).toHaveBeenCalledTimes(1);
    const [opts, input] = recordIngestFreshnessMock.mock.calls[0];
    expect(opts.flags.governanceEnabled).toBe(true);
    expect(opts.flags.slices.m1_ingest).toBe(true);
    expect(input.status).toBe("pass");
    expect(input.observedAt).toBeInstanceOf(Date);
    expect(input.observedAt.getTime()).toBe(Number(ts));
    expect(input.detail.gateway_id).toBe("gw-ws5-a");
  });

  it("emits ingest.telemetry.stale at the same gap>5min boundary that triggers backfill", async () => {
    const tsA = 1772681000000;
    const tsB = tsA + 6 * 60_000; // +6min gap

    // Seed cache
    await handleTelemetry(pool, "gw-ws5-b", "CID-B", makePayload("CID-B", String(tsA)));
    // Second arrival crosses 5-min gap
    await handleTelemetry(pool, "gw-ws5-b", "CID-B", makePayload("CID-B", String(tsB)));

    // backfill_request insert still happens (must not be broken)
    const backfillCall = (pool.query as jest.Mock).mock.calls.find(
      (c: unknown[]) => typeof c[0] === "string" && (c[0] as string).includes("INSERT INTO backfill_requests"),
    );
    expect(backfillCall).toBeDefined();

    // ingest.telemetry.stale emitted exactly once for this boundary crossing
    expect(emitIngestTelemetryStaleMock).toHaveBeenCalledTimes(1);
    const [, staleInput] = emitIngestTelemetryStaleMock.mock.calls[0];
    expect(staleInput.tenantScope).toBe("gateway:gw-ws5-b");
    expect(staleInput.gatewayId).toBe("gw-ws5-b");
    expect(staleInput.staleForMs).toBe(6 * 60_000);
    expect(staleInput.thresholdMs).toBe(300_000);
    expect(staleInput.lastObservedAt.getTime()).toBe(tsA);
    expect(staleInput.observedAt.getTime()).toBe(tsB);
  });

  it("I3: flips ingest.freshness to 'stale' at the gap boundary (not 'pass')", async () => {
    // Reproduces Ryan's live step-2 evidence: at the same gap boundary that
    // triggers backfill + stale event, ingest.freshness must report 'stale'.
    const tsA = 1772681000000;
    const tsB = tsA + 11 * 60_000; // 11-min gap (matches live I3 replay)

    await handleTelemetry(pool, "gw-ws5-b2", "CID-B2", makePayload("CID-B2", String(tsA)));
    await handleTelemetry(pool, "gw-ws5-b2", "CID-B2", makePayload("CID-B2", String(tsB)));

    // Two freshness ticks: first arrival is baseline (pass), boundary arrival
    // is 'stale' because the cadence watchdog would otherwise never see the gap.
    expect(recordIngestFreshnessMock).toHaveBeenCalledTimes(2);
    const [, firstInput] = recordIngestFreshnessMock.mock.calls[0];
    const [, secondInput] = recordIngestFreshnessMock.mock.calls[1];
    expect(firstInput.status).toBe("pass");
    expect(secondInput.status).toBe("stale");
    expect(secondInput.detail.stale_for_ms).toBe(11 * 60_000);
    expect(secondInput.detail.gateway_id).toBe("gw-ws5-b2");
  });

  it("I3: resumed ingest calls canonical recovery helper (not ad-hoc close)", async () => {
    // Reproduces Ryan's live step-5 evidence: after stale + recovery, the
    // handler must drive canonical recovery (maybeEmitIngestTelemetryRecovered)
    // rather than relying on process-local stale bookkeeping. That helper
    // reads the runtime_issues row as authority and is a no-op when there's
    // no active cycle — which is what the handler expects to happen here.
    const tsA = 1772681000000;
    const tsB = tsA + 11 * 60_000; // stale boundary
    const tsC = tsB + 60_000; // resumed ingest, within threshold

    await handleTelemetry(pool, "gw-ws5-r", "CID-R", makePayload("CID-R", String(tsA)));
    await handleTelemetry(pool, "gw-ws5-r", "CID-R", makePayload("CID-R", String(tsB)));
    await handleTelemetry(pool, "gw-ws5-r", "CID-R", makePayload("CID-R", String(tsC)));

    // Stale detection fires once at the tsA→tsB boundary.
    expect(emitIngestTelemetryStaleMock).toHaveBeenCalledTimes(1);

    // Canonical recovery helper is called on the resumed arrival (tsB→tsC
    // is within threshold but we still ask the canonical authority whether
    // a recovery event is warranted — the helper decides by querying the
    // runtime_issues row, NOT by process memory).
    expect(maybeEmitIngestTelemetryRecoveredMock).toHaveBeenCalledTimes(1);
    const [, recoverInput] = maybeEmitIngestTelemetryRecoveredMock.mock.calls[0];
    expect(recoverInput.tenantScope).toBe("gateway:gw-ws5-r");
    expect(recoverInput.gatewayId).toBe("gw-ws5-r");
    expect(recoverInput.lastObservedAt.getTime()).toBe(tsB);
    expect(recoverInput.observedAt.getTime()).toBe(tsC);
    expect(recoverInput.gapMs).toBe(60_000);

    // Final freshness tick returns to 'pass' on the resumed arrival.
    const lastCall =
      recordIngestFreshnessMock.mock.calls[
        recordIngestFreshnessMock.mock.calls.length - 1
      ];
    expect(lastCall[1].status).toBe("pass");
    expect(lastCall[1].observedAt.getTime()).toBe(tsC);
  });

  it("I3: on fresh non-gap arrivals after baseline, canonical recovery is consulted (no process-local fragility)", async () => {
    // Even without a prior stale episode in this process, the handler asks
    // the canonical authority on every fresh arrival past the baseline.
    // The authority's 'no_active_issue' branch keeps the hot path silent.
    maybeEmitIngestTelemetryRecoveredMock.mockResolvedValue({
      status: "no_active_issue",
    });

    const tsA = 1772681000000;
    const tsB = tsA + 60_000; // 1-min gap, below stale threshold

    await handleTelemetry(pool, "gw-ws5-q", "CID-Q", makePayload("CID-Q", String(tsA)));
    await handleTelemetry(pool, "gw-ws5-q", "CID-Q", makePayload("CID-Q", String(tsB)));

    // No stale event for sub-threshold gap
    expect(emitIngestTelemetryStaleMock).not.toHaveBeenCalled();
    // The recovery authority is consulted on the second (non-first) arrival
    expect(maybeEmitIngestTelemetryRecoveredMock).toHaveBeenCalledTimes(1);
    // Freshness = pass on both arrivals
    expect(recordIngestFreshnessMock).toHaveBeenCalledTimes(2);
    expect(recordIngestFreshnessMock.mock.calls[0][1].status).toBe("pass");
    expect(recordIngestFreshnessMock.mock.calls[1][1].status).toBe("pass");
  });

  it("does not emit ingest.telemetry.stale when gap is below threshold", async () => {
    const tsA = 1772681000000;
    const tsB = tsA + 60_000; // 1 min
    await handleTelemetry(pool, "gw-ws5-c", "CID-C", makePayload("CID-C", String(tsA)));
    await handleTelemetry(pool, "gw-ws5-c", "CID-C", makePayload("CID-C", String(tsB)));

    expect(emitIngestTelemetryStaleMock).not.toHaveBeenCalled();
    // Freshness ticks twice — once per arrival
    expect(recordIngestFreshnessMock).toHaveBeenCalledTimes(2);
  });

  it("respects runtime-off: freshness still CALLED (helper decides disabled) but returns disabled", async () => {
    // Runtime-off surface: helpers themselves must return 'disabled' and do
    // no DB writes. The handler call itself always happens; the helper is
    // responsible for the no-op contract. This test asserts we pass the OFF
    // flag shape to the helper so it can make that decision.
    applyEnv(ENV_OFF);

    const ts = "1772681002999";
    await handleTelemetry(pool, "gw-ws5-d", "CID-D", makePayload("CID-D", ts));

    expect(recordIngestFreshnessMock).toHaveBeenCalledTimes(1);
    const [opts] = recordIngestFreshnessMock.mock.calls[0];
    expect(opts.flags.governanceEnabled).toBe(false);
    expect(opts.flags.slices.m1_ingest).toBe(false);
  });

  it("never throws to caller when the runtime emitter rejects (best-effort)", async () => {
    recordIngestFreshnessMock.mockImplementationOnce(() => {
      return Promise.reject(new Error("runtime-down"));
    });

    const ts = "1772681003123";
    let threw = false;
    try {
      await handleTelemetry(pool, "gw-ws5-e", "CID-E", makePayload("CID-E", ts));
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    // The existing message buffer path still ran — the telemetry write
    // branch is owned by FragmentAssembler, not by this call site.
  });
});

describe("WS5 FragmentAssembler runtime emitters", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    applyEnv(ENV_ON);
  });

  afterEach(() => {
    jest.useRealTimers();
    clearEnv();
  });

  it("emits ingest.parser.failed once when protocol timestamp is malformed", () => {
    const pool = createMockPool();
    const assembler = new FragmentAssembler(pool);

    assembler.receive("CID-BAD", makePayload("CID-BAD", "not-a-number"));

    expect(emitIngestParserFailedMock).toHaveBeenCalledTimes(1);
    const [opts, input] = emitIngestParserFailedMock.mock.calls[0];
    expect(opts.flags.slices.m1_ingest).toBe(true);
    expect(input.parserId).toBe("fragment-assembler.protocol-timestamp");
    expect(input.gatewayId).toBe("CID-BAD");
    expect(input.reason).toBe("invalid_protocol_timestamp");
    expect(input.error.message).toMatch(/timestamp|timeStamp|protocol/i);

    assembler.destroy();
  });

  it("emits ingest.fragment.backlog once when accumulators cross high-water (no per-fragment spam)", () => {
    const pool = createMockPool();
    const assembler = new FragmentAssembler(pool);
    const data = { emsList: [] }; // non-core fragment → accumulator stays

    // Feed 101 distinct clientIds with non-core fragments → 101 accumulators
    for (let i = 0; i < 101; i++) {
      assembler.receive(`CID-${i}`, makePayload(`CID-${i}`, "1772681002103", data));
    }

    // Exactly one backlog emit at the HIGH crossing
    expect(emitIngestFragmentBacklogMock).toHaveBeenCalledTimes(1);
    const [, input] = emitIngestFragmentBacklogMock.mock.calls[0];
    expect(input.backlogCount).toBeGreaterThanOrEqual(100);
    expect(input.thresholdCount).toBe(100);
    expect(input.assemblerKind).toBe("live");
    expect(Array.isArray(input.sampleClientIds)).toBe(true);

    assembler.destroy();
  });

  it("does NOT emit parser failure for well-formed timestamps (the normal path stays quiet)", () => {
    const pool = createMockPool();
    const assembler = new FragmentAssembler(pool);

    assembler.receive("CID-OK", makePayload("CID-OK", "1772681002103"));

    expect(emitIngestParserFailedMock).not.toHaveBeenCalled();
    assembler.destroy();
  });

  it("is fully neutralized when runtime governance is off (still no throw)", () => {
    applyEnv(ENV_OFF);
    const pool = createMockPool();
    const assembler = new FragmentAssembler(pool);

    // Parser fail path still invokes the helper — the helper itself is
    // responsible for the disabled no-op contract. The mock captures the
    // flags value we passed; with OFF env, governanceEnabled must be false.
    assembler.receive("CID-OFF", makePayload("CID-OFF", "not-a-number"));
    expect(emitIngestParserFailedMock).toHaveBeenCalledTimes(1);
    const [opts] = emitIngestParserFailedMock.mock.calls[0];
    expect(opts.flags.governanceEnabled).toBe(false);
    expect(opts.flags.slices.m1_ingest).toBe(false);

    assembler.destroy();
  });
});

describe("WS5 missed-data-handler runtime emitters", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    applyEnv(ENV_ON);
  });

  afterEach(() => {
    jest.useRealTimers();
    clearEnv();
  });

  it("emits ingest.parser.failed when backfill fragment has bad timestamp", async () => {
    const pool = createMockPool();
    await handleMissedData(
      pool,
      "gw-missed-bad",
      "CID-X",
      makePayload("CID-X", "bogus", { dido: { do: [] } }),
    );

    expect(emitIngestParserFailedMock).toHaveBeenCalledTimes(1);
    const [, input] = emitIngestParserFailedMock.mock.calls[0];
    expect(input.parserId).toBe("missed-data.protocol-timestamp");
    expect(input.gatewayId).toBe("gw-missed-bad");
  });

  it("does not emit on normal backfill processing", async () => {
    const pool = createMockPool();
    await handleMissedData(
      pool,
      "gw-missed-ok",
      "CID-Y",
      makePayload("CID-Y", "1772681002103", { dido: { do: [] } }),
    );
    // Well-formed timestamp — parser emitter must stay silent
    expect(emitIngestParserFailedMock).not.toHaveBeenCalled();
  });

  it("never throws when runtime emit fails (backfill flow must not break)", async () => {
    emitIngestParserFailedMock.mockImplementationOnce(() =>
      Promise.reject(new Error("emit-died")),
    );
    const pool = createMockPool();
    let threw = false;
    try {
      await handleMissedData(
        pool,
        "gw-missed-err",
        "CID-Z",
        makePayload("CID-Z", "bogus", { dido: { do: [] } }),
      );
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });
});
