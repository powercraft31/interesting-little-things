import { handleHeartbeat } from "../../src/iot-hub/handlers/heartbeat-handler";
import type { SolfacilMessage } from "../../src/shared/types/solfacil-protocol";

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
  it("updates gateways.last_seen_at using payload.timeStamp", async () => {
    const pool = createMockPool();
    const ts = "1747534429979";

    await handleHeartbeat(
      pool as unknown as import("pg").Pool,
      "gw-001",
      "WKRD24070202100144F",
      makeHeartbeatPayload(ts),
    );

    expect(pool.queries).toHaveLength(1);
    const q = pool.queries[0];
    expect(q.sql).toContain("UPDATE gateways");
    expect(q.sql).toContain("to_timestamp");
    expect(q.params[0]).toBe(1747534429979); // device timestamp, NOT server time
    expect(q.params[1]).toBe("WKRD24070202100144F"); // client_id
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

  it("uses WHERE client_id = $2 (not gateway_id)", async () => {
    const pool = createMockPool();

    await handleHeartbeat(
      pool as unknown as import("pg").Pool,
      "gw-001",
      "MY_CLIENT_ID",
      makeHeartbeatPayload("1747534429979"),
    );

    expect(pool.queries[0].params[1]).toBe("MY_CLIENT_ID");
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
});
