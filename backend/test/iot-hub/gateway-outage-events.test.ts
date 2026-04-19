// Scope: this file tests domain-level outage / backfill behavior. Runtime
// governance emission is covered in test/iot-hub/ws5-runtime-emitters.test.ts.
// We mock the shared ingest-emitters module so the handler's fire-and-forget
// runtime calls never reach the real service pool (which would leak open
// PG connections after these tests finish when env vars happen to be set).
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
describe("IoT retention compatibility proof", () => {
  it("keeps current alert/fleet readers on hot-table semantics only in v6.10.1", () => {
    const fs = require("fs");
    const alerts = fs.readFileSync(
      require.resolve("../../src/bff/handlers/get-alerts"),
      "utf8",
    );
    const summary = fs.readFileSync(
      require.resolve("../../src/bff/handlers/get-alerts-summary"),
      "utf8",
    );
    const overview = fs.readFileSync(
      require.resolve("../../src/bff/handlers/get-fleet-overview"),
      "utf8",
    );
    const offlineEvents = fs.readFileSync(
      require.resolve("../../src/bff/handlers/get-fleet-offline-events"),
      "utf8",
    );
    const integradores = fs.readFileSync(
      require.resolve("../../src/bff/handlers/get-fleet-integradores"),
      "utf8",
    );

    expect(alerts).toContain("FROM gateway_alarm_events a");
    expect(summary).toContain("FROM gateway_alarm_events a");
    expect(alerts).not.toContain("gateway_alarm_events_archive");
    expect(summary).not.toContain("gateway_alarm_events_archive");

    expect(overview).toContain("FROM backfill_requests br");
    expect(overview).toContain("WHERE br.status IN ('pending','in_progress','failed')");
    expect(offlineEvents).toContain("FROM backfill_requests br");
    expect(integradores).toContain("FROM backfill_requests br");
    expect(overview).not.toContain("backfill_requests_archive");
    expect(offlineEvents).not.toContain("backfill_requests_archive");
    expect(integradores).not.toContain("backfill_requests_archive");
  });

  it("preserves the gateway alarm columns needed by current alert readers when archiving", () => {
    const fs = require("fs");
    const source = fs.readFileSync(
      require.resolve("../../src/shared/runtime/retention-job"),
      "utf8",
    );

    expect(source).toMatch(/INSERT INTO gateway_alarm_events_archive[\s\S]*id,[\s\S]*gateway_id,[\s\S]*org_id,[\s\S]*device_sn,[\s\S]*sub_dev_id,[\s\S]*sub_dev_name,[\s\S]*product_type,[\s\S]*event_id,[\s\S]*event_name,[\s\S]*event_type,[\s\S]*level,[\s\S]*status,[\s\S]*prop_id,[\s\S]*prop_name,[\s\S]*prop_value,[\s\S]*description,[\s\S]*event_create_time,[\s\S]*event_update_time,[\s\S]*created_at,[\s\S]*archived_at,[\s\S]*archive_reason/);
    expect(source).toMatch(/FROM gateway_alarm_events[\s\S]*WHERE event_create_time < \$1/);
    expect(source).toMatch(/ON CONFLICT \(id\) DO NOTHING/);
  });
});

describe("GatewayConnectionManager v6.1 — Heartbeat Threshold", () => {
  it("uses 30 min (1800000 ms) threshold instead of the older 10/15 min assumptions", async () => {
    // Verify the constant by importing the module source
    const fs = require("fs");
    const source = fs.readFileSync(
      require.resolve("../../src/iot-hub/services/gateway-connection-manager"),
      "utf8",
    );
    expect(source).toContain("1_800_000");
    // Verify older thresholds are gone
    expect(source).toMatch(/OFFLINE_THRESHOLD_MS\s*=\s*1_800_000/);
    expect(source).not.toMatch(/OFFLINE_THRESHOLD_MS\s*=\s*900_000/);
    expect(source).not.toMatch(/OFFLINE_THRESHOLD_MS\s*=\s*600_000/);
    expect(source).toContain("30 minutes");
  });
});
