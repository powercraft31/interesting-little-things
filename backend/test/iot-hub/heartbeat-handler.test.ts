import { handleHeartbeat } from "../../src/iot-hub/handlers/heartbeat-handler";
import type { SolfacilMessage } from "../../src/shared/types/solfacil-protocol";

// ─── Mock Pool ──────────────────────────────────────────────────────────────
function createMockPool(cteRows: unknown[] = []) {
  const queries: Array<{ sql: string; params: unknown[] }> = [];

  const queryFn = jest.fn(async (sql: string, params?: unknown[]) => {
    queries.push({ sql, params: params ?? [] });

    // CTE query returns prev state for reconnect detection
    if (sql.includes("WITH prev AS")) {
      return { rows: cteRows, rowCount: 1 };
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

// ─── Tests ──────────────────────────────────────────────────────────────────
describe("HeartbeatHandler", () => {
  it("updates gateways.last_seen_at using CTE with payload.timeStamp", async () => {
    const pool = createMockPool();
    const ts = "1747534429979";

    await handleHeartbeat(
      pool as unknown as import("pg").Pool,
      "gw-001",
      "WKRD24070202100144F",
      makeHeartbeatPayload(ts),
    );

    // v6.1: CTE query + pg_notify = 2 queries (no reconnect)
    expect(pool.queries).toHaveLength(2);
    const q = pool.queries[0];
    expect(q.sql).toContain("WITH prev AS");
    expect(q.sql).toContain("UPDATE gateways");
    expect(q.sql).toContain("to_timestamp");
    expect(q.params[0]).toBe(1747534429979); // device timestamp, NOT server time
    expect(q.params[1]).toBe("gw-001"); // v5.22: gateway_id, not client_id
  });

  it("sets status to 'online'", async () => {
    const pool = createMockPool();

    await handleHeartbeat(
      pool as unknown as import("pg").Pool,
      "gw-001",
      "CID",
      makeHeartbeatPayload("1747534429979"),
    );

    expect(pool.queries[0].sql).toContain("status = 'online'");
  });

  it("uses WHERE gateway_id = $2 (v5.22: switched from client_id)", async () => {
    const pool = createMockPool();

    await handleHeartbeat(
      pool as unknown as import("pg").Pool,
      "gw-001",
      "MY_CLIENT_ID",
      makeHeartbeatPayload("1747534429979"),
    );

    // $2 is now gateway_id, not client_id
    expect(pool.queries[0].params[1]).toBe("gw-001");
    expect(pool.queries[0].sql).toContain("WHERE gateway_id = $2");
  });

  it("skips update on invalid timeStamp (NaN)", async () => {
    const pool = createMockPool();

    await handleHeartbeat(
      pool as unknown as import("pg").Pool,
      "gw-001",
      "CID",
      makeHeartbeatPayload("not_a_number"),
    );

    expect(pool.queries).toHaveLength(0);
  });

  it("skips update on empty timeStamp", async () => {
    const pool = createMockPool();

    await handleHeartbeat(
      pool as unknown as import("pg").Pool,
      "gw-001",
      "CID",
      makeHeartbeatPayload(""),
    );

    expect(pool.queries).toHaveLength(0);
  });

  it("skips update on zero timeStamp", async () => {
    const pool = createMockPool();

    await handleHeartbeat(
      pool as unknown as import("pg").Pool,
      "gw-001",
      "CID",
      makeHeartbeatPayload("0"),
    );

    expect(pool.queries).toHaveLength(0);
  });

  it("uses device clock not server clock (timestamp from payload)", async () => {
    const pool = createMockPool();
    // Use a specific historical timestamp to prove we're not using NOW()
    const historicalTs = "1609459200000"; // 2021-01-01 00:00:00 UTC

    await handleHeartbeat(
      pool as unknown as import("pg").Pool,
      "gw-001",
      "CID",
      makeHeartbeatPayload(historicalTs),
    );

    const q = pool.queries[0];
    // The SQL should use to_timestamp($1), not NOW()
    expect(q.sql).toContain("to_timestamp($1");
    expect(q.sql).not.toMatch(/last_seen_at\s*=\s*NOW\(\)/);
    expect(q.params[0]).toBe(1609459200000);
  });

  // ─── v6.1: Outage close on reconnect ─────────────────────────────────────

  it("closes outage event on reconnect (prev_status=offline)", async () => {
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
    expect(closeQ!.params[0]).toBe("gw-001");
  });

  it("does NOT close outage when gateway was already online", async () => {
    const recentTime = new Date(Date.now() - 300_000);
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
  });

  it("v6.1: does NOT insert backfill_request on reconnect", async () => {
    const fiveMinAgo = new Date(Date.now() - 300_000);
    const pool = createMockPool([
      { prev_last_seen: fiveMinAgo, prev_status: "offline" },
    ]);

    await handleHeartbeat(
      pool as unknown as import("pg").Pool,
      "gw-001",
      "CID",
      makeHeartbeatPayload(String(Date.now())),
    );

    const backfillQ = pool.queries.find((q) =>
      q.sql.includes("INSERT INTO backfill_requests"),
    );
    expect(backfillQ).toBeUndefined();
  });

  it("emits pg_notify('gateway_health') on every heartbeat", async () => {
    const pool = createMockPool();

    await handleHeartbeat(
      pool as unknown as import("pg").Pool,
      "gw-001",
      "CID",
      makeHeartbeatPayload("1747534429979"),
    );

    const notifyQ = pool.queries.find((q) =>
      q.sql.includes("pg_notify('gateway_health'"),
    );
    expect(notifyQ).toBeDefined();
    expect(notifyQ!.params[0]).toBe("gw-001");
  });
});
