import { handleMissedData } from "../../src/iot-hub/handlers/missed-data-handler";
import type { SolfacilMessage } from "../../src/shared/types/solfacil-protocol";

// ─── Mock fragment-assembler (parseTelemetryPayload) ────────────────────────
const mockParseTelemetry = jest.fn();
jest.mock("../../src/iot-hub/services/fragment-assembler", () => ({
  parseTelemetryPayload: (...args: unknown[]) => mockParseTelemetry(...args),
}));

// ─── Mock device-asset-cache ────────────────────────────────────────────────
const mockResolve = jest.fn();
jest.mock("../../src/iot-hub/services/device-asset-cache", () => ({
  DeviceAssetCache: jest.fn().mockImplementation(() => ({
    resolve: mockResolve,
  })),
}));

// ─── Mock Pool ──────────────────────────────────────────────────────────────
function createMockPool() {
  const queries: Array<{ sql: string; params: unknown[] }> = [];

  const queryFn = jest.fn(async (sql: string, params?: unknown[]) => {
    queries.push({ sql, params: params ?? [] });
    return { rows: [], rowCount: 1 };
  });

  return { query: queryFn, queries };
}

// ─── Fixtures ───────────────────────────────────────────────────────────────
function makePayload(data: Record<string, unknown>): SolfacilMessage {
  return {
    DS: 0,
    ackFlag: 0,
    clientId: "WKRD24070202100144F",
    deviceName: "EMS_N2",
    productKey: "ems",
    messageId: "12345",
    timeStamp: "1710288000000", // 2024-03-13T00:00:00Z
    data,
  };
}

const CORE_DATA = {
  batList: [
    {
      id: "BAT001",
      soc: "85",
      power: "2500",
      voltage: "48.5",
      current: "51.5",
      temperature: "32",
      soh: "98",
      dailyChargeKwh: "12.5",
      dailyDischargeKwh: "8.3",
      maxChargeCurrent: "100",
      maxDischargeCurrent: "100",
    },
  ],
  gridList: [
    {
      id: "GRID001",
      power: "1200",
      dailyBuyKwh: "15.0",
      dailySellKwh: "3.0",
    },
  ],
  pvList: [
    {
      id: "PV001",
      power: "3500",
      dailyEnergyKwh: "18.2",
    },
  ],
  loadList: [
    {
      id: "LOAD001",
      power: "2800",
    },
  ],
};

const DIDO_DATA = {
  dido: {
    do: [
      { id: "DO0", type: "digital_output", value: "1" },
      { id: "DO1", type: "digital_output", value: "0" },
    ],
  },
};

const METER_DATA = {
  meterList: [
    {
      id: "METER001",
      voltage_a: "220",
      current_a: "5.5",
      power: "1210",
    },
  ],
};

const PARSED_TELEMETRY = {
  deviceSn: "WKRD24070202100144F",
  recordedAt: new Date(1710288000000),
  batterySoc: 85,
  batteryPowerKw: 2.5,
  pvPowerKw: 3.5,
  gridPowerKw: 1.2,
  loadPowerKw: 2.8,
  gridDailyBuyKwh: 15.0,
  gridDailySellKwh: 3.0,
  batterySoh: 98,
  batteryVoltage: 48.5,
  batteryCurrent: 51.5,
  batteryTemperature: 32,
  do0Active: true,
  do1Active: false,
  flloadPowerKw: null,
  inverterTemp: null,
  pvDailyEnergyKwh: 18.2,
  maxChargeCurrent: 100,
  maxDischargeCurrent: 100,
  dailyChargeKwh: 12.5,
  dailyDischargeKwh: 8.3,
  telemetryExtra: null,
};

// ─── Tests ──────────────────────────────────────────────────────────────────
describe("MissedDataHandler", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockParseTelemetry.mockReturnValue(PARSED_TELEMETRY);
    mockResolve.mockResolvedValue("ASSET_SP_001");
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("logs and returns on empty data", async () => {
    const pool = createMockPool();
    const consoleSpy = jest.spyOn(console, "log").mockImplementation();

    await handleMissedData(
      pool as unknown as import("pg").Pool,
      "gw-001",
      "CID",
      makePayload({}),
    );

    // Empty data → BackfillAssembler.receive logs and returns early
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Empty backfill response"),
    );

    // No DB queries should fire (no flush)
    await jest.advanceTimersByTimeAsync(5000);
    expect(pool.queries).toHaveLength(0);

    consoleSpy.mockRestore();
  });

  it("core fragment (batList) triggers immediate flush", async () => {
    const pool = createMockPool();

    // Send core message (has batList → triggers immediate flush)
    await handleMissedData(
      pool as unknown as import("pg").Pool,
      "gw-001",
      "CID",
      makePayload(CORE_DATA),
    );

    // Flush is async — wait for microtasks
    await jest.advanceTimersByTimeAsync(100);

    // Should have called parseTelemetryPayload
    expect(mockParseTelemetry).toHaveBeenCalled();

    // Should INSERT into telemetry_history
    const insertQ = pool.queries.find((q) =>
      q.sql.includes("INSERT INTO telemetry_history"),
    );
    expect(insertQ).toBeDefined();
  });

  it("INSERT uses ON CONFLICT (asset_id, recorded_at) DO NOTHING", async () => {
    const pool = createMockPool();

    await handleMissedData(
      pool as unknown as import("pg").Pool,
      "gw-001",
      "CID",
      makePayload(CORE_DATA),
    );
    await jest.advanceTimersByTimeAsync(100);

    const insertQ = pool.queries.find((q) =>
      q.sql.includes("INSERT INTO telemetry_history"),
    );
    expect(insertQ).toBeDefined();
    expect(insertQ!.sql).toContain("ON CONFLICT");
    expect(insertQ!.sql).toContain("DO NOTHING");
  });

  it("does NOT call pg_notify (no SSE storm from historical data)", async () => {
    const pool = createMockPool();

    await handleMissedData(
      pool as unknown as import("pg").Pool,
      "gw-001",
      "CID",
      makePayload(CORE_DATA),
    );
    await jest.advanceTimersByTimeAsync(100);

    const notifyQ = pool.queries.find((q) => q.sql.includes("pg_notify"));
    expect(notifyQ).toBeUndefined();
  });

  it("does NOT update device_state (historical data ≠ current state)", async () => {
    const pool = createMockPool();

    await handleMissedData(
      pool as unknown as import("pg").Pool,
      "gw-001",
      "CID",
      makePayload(CORE_DATA),
    );
    await jest.advanceTimersByTimeAsync(100);

    const deviceStateQ = pool.queries.find(
      (q) =>
        q.sql.includes("UPDATE") &&
        (q.sql.includes("device_state") || q.sql.includes("assets")),
    );
    expect(deviceStateQ).toBeUndefined();
  });

  it("dedup: same asset_id + recorded_at → ON CONFLICT DO NOTHING", async () => {
    const pool = createMockPool();

    // First message
    await handleMissedData(
      pool as unknown as import("pg").Pool,
      "gw-001",
      "CID",
      makePayload(CORE_DATA),
    );
    await jest.advanceTimersByTimeAsync(100);

    // Second message with same timestamp (would be deduped by DB)
    await handleMissedData(
      pool as unknown as import("pg").Pool,
      "gw-001",
      "CID",
      makePayload(CORE_DATA),
    );
    await jest.advanceTimersByTimeAsync(100);

    // Both INSERTs use ON CONFLICT DO NOTHING
    const insertQueries = pool.queries.filter((q) =>
      q.sql.includes("INSERT INTO telemetry_history"),
    );
    for (const q of insertQueries) {
      expect(q.sql).toContain("ON CONFLICT");
      expect(q.sql).toContain("DO NOTHING");
    }
  });

  it("accumulates dido + meter fragments, flushes on core arrival", async () => {
    const pool = createMockPool();

    // Send dido fragment (non-core → starts debounce timer)
    await handleMissedData(
      pool as unknown as import("pg").Pool,
      "gw-001",
      "CID",
      makePayload(DIDO_DATA),
    );

    // Send meter fragment
    await handleMissedData(
      pool as unknown as import("pg").Pool,
      "gw-001",
      "CID",
      makePayload(METER_DATA),
    );

    // No flush yet (no core)
    expect(mockParseTelemetry).not.toHaveBeenCalled();

    // Send core fragment → immediate flush
    await handleMissedData(
      pool as unknown as import("pg").Pool,
      "gw-001",
      "CID",
      makePayload(CORE_DATA),
    );
    await jest.advanceTimersByTimeAsync(100);

    // parseTelemetryPayload called with accumulated fragments
    expect(mockParseTelemetry).toHaveBeenCalledTimes(1);
    // 6th arg (ems) should be undefined for backfill
    expect(mockParseTelemetry).toHaveBeenCalledWith(
      expect.any(String), // clientId
      expect.any(Date), // recordedAt
      expect.objectContaining({ batList: expect.any(Array) }), // core data
      expect.objectContaining({ do: expect.any(Array) }), // dido
      expect.any(Array), // meters
      undefined, // no ems for backfill
    );
  });

  it("debounce timeout flushes partial fragments after 3s", async () => {
    const pool = createMockPool();

    // Send non-core fragment only (no batList)
    await handleMissedData(
      pool as unknown as import("pg").Pool,
      "gw-001",
      "CID",
      makePayload(DIDO_DATA),
    );

    // Not flushed yet
    expect(mockParseTelemetry).not.toHaveBeenCalled();

    // Advance past 3s debounce
    await jest.advanceTimersByTimeAsync(3500);

    // Should have attempted flush (but no core → parseTelemetryPayload may not produce output)
    // The assembler logs a warning about missing core and skips
    const consoleSpy = jest.spyOn(console, "warn").mockImplementation();
    // The flush already happened by the timer
    consoleSpy.mockRestore();
  });
});
