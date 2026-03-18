import { handleHeartbeat } from "../../src/iot-hub/handlers/heartbeat-handler";
import {
  handleTelemetry,
  _clearTelemetryCache,
} from "../../src/iot-hub/handlers/telemetry-handler";
import type { SolfacilMessage } from "../../src/shared/types/solfacil-protocol";

// ─── Mock Pool ──────────────────────────────────────────────────────────────
function createMockPool(cteRows: unknown[] = [], selectRows: unknown[] = []) {
  const queries: Array<{ sql: string; params: unknown[] }> = [];

  const queryFn = jest.fn(async (sql: string, params?: unknown[]) => {
    queries.push({ sql, params: params ?? [] });

    if (sql.includes("WITH prev AS")) {
      return { rows: cteRows, rowCount: 1 };
    }
    if (sql.includes("SELECT id, ended_at FROM gateway_outage_events")) {
      return { rows: selectRows, rowCount: selectRows.length };
    }
    return { rows: [], rowCount: 1 };
  });

  return { query: queryFn, queries };
}

// ─── Fixtures ───────────────────────────────────────────────────────────────
function makeHeartbeatPayload(timeStamp: string): SolfacilMessage {
  return {
    DS: 0,
    ackFlag: 0,
    clientId: "WKRD24070202100144F",
    deviceName: "EMS_N2",
    productKey: "ems",
    messageId: "9163436",
    timeStamp,
    data: {},
  };
}

function makeTelemetryPayload(timeStamp: string): SolfacilMessage {
  return {
    DS: 0,
    ackFlag: 0,
    clientId: "WKRD24070202100144F",
    deviceName: "EMS_N2",
    productKey: "ems",
    messageId: "1001",
    timeStamp,
    data: { bat: { soc: "50" } },
  };
}

// Mock FragmentAssembler to avoid side effects
jest.mock("../../src/iot-hub/services/fragment-assembler", () => ({
  FragmentAssembler: jest.fn().mockImplementation(() => ({
    receive: jest.fn(),
    destroy: jest.fn(),
  })),
}));

// ─── Tests: Heartbeat → Outage Close ────────────────────────────────────────
describe("HeartbeatHandler v6.1 — Outage Close", () => {
  it("closes open outage event on reconnect (prev_status != online)", async () => {
    const fiveMinAgo = new Date(Date.now() - 300_000);
    const pool = createMockPool([
      { prev_last_seen: fiveMinAgo, prev_status: "offline" },
    ]);

    const nowTs = String(Date.now());
    await handleHeartbeat(
      pool as unknown as import("pg").Pool,
      "gw-001",
      "CID",
      makeHeartbeatPayload(nowTs),
    );

    // CTE UPDATE + outage close + pg_notify = 3 queries
    expect(pool.queries).toHaveLength(3);
    const closeQ = pool.queries.find((q) =>
      q.sql.includes("UPDATE gateway_outage_events"),
    );
    expect(closeQ).toBeDefined();
    expect(closeQ!.sql).toContain("ended_at = NOW()");
    expect(closeQ!.sql).toContain("ended_at IS NULL");
    expect(closeQ!.params[0]).toBe("gw-001");
  });

  it("does NOT close outage when gateway was already online", async () => {
    const recentTime = new Date(Date.now() - 30_000);
    const pool = createMockPool([
      { prev_last_seen: recentTime, prev_status: "online" },
    ]);

    const nowTs = String(Date.now());
    await handleHeartbeat(
      pool as unknown as import("pg").Pool,
      "gw-001",
      "CID",
      makeHeartbeatPayload(nowTs),
    );

    // CTE UPDATE + pg_notify only (no outage close)
    expect(pool.queries).toHaveLength(2);
    const closeQ = pool.queries.find((q) =>
      q.sql.includes("UPDATE gateway_outage_events"),
    );
    expect(closeQ).toBeUndefined();
  });

  it("does NOT insert backfill_request on reconnect (v6.1: removed from heartbeat)", async () => {
    const fiveMinAgo = new Date(Date.now() - 300_000);
    const pool = createMockPool([
      { prev_last_seen: fiveMinAgo, prev_status: "offline" },
    ]);

    const nowTs = String(Date.now());
    await handleHeartbeat(
      pool as unknown as import("pg").Pool,
      "gw-001",
      "CID",
      makeHeartbeatPayload(nowTs),
    );

    const backfillQ = pool.queries.find((q) =>
      q.sql.includes("INSERT INTO backfill_requests"),
    );
    expect(backfillQ).toBeUndefined();
  });
});

// ─── Tests: Telemetry → Backfill Trigger ────────────────────────────────────
describe("TelemetryHandler v6.1 — Backfill Trigger", () => {
  // Each test creates its own pool, so WeakMap isolation is automatic.
  // No afterEach cleanup needed since pools are garbage-collected.

  it("inserts backfill_request when telemetry gap > 5 min", async () => {
    const pool = createMockPool();

    const t1 = Date.now() - 600_000; // 10 min ago
    const t2 = Date.now(); // now (gap = 10 min)

    // First message sets the baseline
    await handleTelemetry(
      pool as unknown as import("pg").Pool,
      "gw-001",
      "CID",
      makeTelemetryPayload(String(t1)),
    );

    // Second message detects the gap
    await handleTelemetry(
      pool as unknown as import("pg").Pool,
      "gw-001",
      "CID",
      makeTelemetryPayload(String(t2)),
    );

    const backfillQ = pool.queries.find((q) =>
      q.sql.includes("INSERT INTO backfill_requests"),
    );
    expect(backfillQ).toBeDefined();
    expect(backfillQ!.params[0]).toBe("gw-001");
    expect(backfillQ!.sql).toContain("status");
    expect(backfillQ!.sql).toContain("'pending'");
  });

  it("does NOT insert backfill_request when telemetry gap < 5 min", async () => {
    const pool = createMockPool();

    const t1 = Date.now() - 120_000; // 2 min ago
    const t2 = Date.now(); // now (gap = 2 min)

    await handleTelemetry(
      pool as unknown as import("pg").Pool,
      "gw-001",
      "CID",
      makeTelemetryPayload(String(t1)),
    );

    await handleTelemetry(
      pool as unknown as import("pg").Pool,
      "gw-001",
      "CID",
      makeTelemetryPayload(String(t2)),
    );

    const backfillQ = pool.queries.find((q) =>
      q.sql.includes("INSERT INTO backfill_requests"),
    );
    expect(backfillQ).toBeUndefined();
  });

  it("does NOT trigger backfill on first message (no previous timestamp)", async () => {
    const pool = createMockPool();

    await handleTelemetry(
      pool as unknown as import("pg").Pool,
      "gw-001",
      "CID",
      makeTelemetryPayload(String(Date.now())),
    );

    const backfillQ = pool.queries.find((q) =>
      q.sql.includes("INSERT INTO backfill_requests"),
    );
    expect(backfillQ).toBeUndefined();
  });

  it("tracks separate timestamps per gateway", async () => {
    const pool = createMockPool();
    const now = Date.now();

    // gw-001: first message
    await handleTelemetry(
      pool as unknown as import("pg").Pool,
      "gw-001",
      "CID1",
      makeTelemetryPayload(String(now - 600_000)),
    );

    // gw-002: first message (no backfill since no previous for gw-002)
    await handleTelemetry(
      pool as unknown as import("pg").Pool,
      "gw-002",
      "CID2",
      makeTelemetryPayload(String(now - 600_000)),
    );

    // gw-001: second message with gap > 5 min
    await handleTelemetry(
      pool as unknown as import("pg").Pool,
      "gw-001",
      "CID1",
      makeTelemetryPayload(String(now)),
    );

    // gw-002: second message with NO gap (small interval)
    await handleTelemetry(
      pool as unknown as import("pg").Pool,
      "gw-002",
      "CID2",
      makeTelemetryPayload(String(now - 600_000 + 60_000)), // 1 min gap
    );

    const backfillQueries = pool.queries.filter((q) =>
      q.sql.includes("INSERT INTO backfill_requests"),
    );
    // Only gw-001 should trigger backfill
    expect(backfillQueries).toHaveLength(1);
    expect(backfillQueries[0].params[0]).toBe("gw-001");
  });
});

// ─── Tests: Heartbeat Threshold ────────────────────────────────────────────
describe("GatewayConnectionManager v6.1 — Heartbeat Threshold", () => {
  it("uses 15 min (900000 ms) threshold instead of 10 min", async () => {
    // Verify the constant by importing the module source
    const fs = require("fs");
    const source = fs.readFileSync(
      require.resolve("../../src/iot-hub/services/gateway-connection-manager"),
      "utf8",
    );
    expect(source).toContain("900_000");
    // Verify old 10-min threshold is gone (OFFLINE_THRESHOLD_MS was 600_000)
    expect(source).toMatch(/OFFLINE_THRESHOLD_MS\s*=\s*900_000/);
    expect(source).not.toMatch(/OFFLINE_THRESHOLD_MS\s*=\s*600_000/);
    expect(source).toContain("15 minutes");
  });
});
