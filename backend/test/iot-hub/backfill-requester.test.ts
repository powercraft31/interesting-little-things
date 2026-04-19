import { BackfillRequester } from "../../src/iot-hub/services/backfill-requester";
import type { GatewayConnectionManager } from "../../src/iot-hub/services/gateway-connection-manager";

// ─── Mock Pool ──────────────────────────────────────────────────────────────
function createMockPool(rows: unknown[] = []) {
  const queries: Array<{ sql: string; params: unknown[] }> = [];

  const mockClient = {
    query: jest.fn(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });

      if (sql.includes("FROM backfill_requests")) {
        return { rows };
      }

      return { rows: [], rowCount: 1 };
    }),
    release: jest.fn(),
  };

  const pool = {
    connect: jest.fn().mockResolvedValue(mockClient),
    query: jest.fn(),
  } as unknown as import("pg").Pool;

  return { pool, mockClient, queries };
}

// ─── Mock ConnectionManager ─────────────────────────────────────────────────
function createMockConnectionManager(
  connected = true,
  publishResult = true,
): GatewayConnectionManager {
  return {
    isGatewayConnected: jest.fn().mockReturnValue(connected),
    publishToGateway: jest.fn().mockReturnValue(publishResult),
  } as unknown as GatewayConnectionManager;
}

// ─── Fixtures ───────────────────────────────────────────────────────────────
const BASE_REQUEST = {
  id: 1,
  gateway_id: "gw-001",
  gap_start: new Date("2026-03-12T10:00:00Z"),
  gap_end: new Date("2026-03-12T12:00:00Z"), // 2 hour gap = 4 chunks of 30min
  current_chunk_start: null as Date | null,
  last_chunk_sent_at: null as Date | null,
  status: "pending",
  created_at: new Date(Date.now() - 60_000), // 1 minute ago (> 30s delay)
};

// ─── Tests ──────────────────────────────────────────────────────────────────
describe("BackfillRequester", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("skips pending request when delay has not elapsed", async () => {
    const recentRequest = {
      ...BASE_REQUEST,
      created_at: new Date(Date.now() - 5_000), // only 5s ago (< 30s delay)
    };
    const { pool, queries } = createMockPool([recentRequest]);
    const cm = createMockConnectionManager();
    const requester = new BackfillRequester(pool, cm);

    requester.start();
    await jest.advanceTimersByTimeAsync(10_000);
    requester.stop();

    // Should have SELECT + BEGIN + COMMIT but no UPDATE to in_progress
    const statusUpdates = queries.filter(
      (q) => q.sql.includes("UPDATE backfill_requests") && q.sql.includes("status"),
    );
    expect(statusUpdates).toHaveLength(0);
    expect(cm.publishToGateway).not.toHaveBeenCalled();
  });

  it("publishes first chunk when pending delay has elapsed", async () => {
    const { pool, queries } = createMockPool([BASE_REQUEST]);
    const cm = createMockConnectionManager();
    const requester = new BackfillRequester(pool, cm);

    requester.start();
    await jest.advanceTimersByTimeAsync(10_000);
    requester.stop();

    // Should publish GET_MISSED
    expect(cm.publishToGateway).toHaveBeenCalledWith(
      "gw-001",
      "platform/ems/gw-001/data/get_missed",
      expect.any(String),
    );

    // Should update status to in_progress
    const progressUpdate = queries.find(
      (q) =>
        q.sql.includes("UPDATE backfill_requests") &&
        q.sql.includes("'in_progress'"),
    );
    expect(progressUpdate).toBeDefined();
  });

  it("skips in_progress request when cooldown has not elapsed", async () => {
    const inProgressRequest = {
      ...BASE_REQUEST,
      status: "in_progress",
      current_chunk_start: new Date("2026-03-12T10:00:00Z"),
      last_chunk_sent_at: new Date(Date.now() - 5_000), // 5s ago (< 20s cooldown)
    };
    const { pool } = createMockPool([inProgressRequest]);
    const cm = createMockConnectionManager();
    const requester = new BackfillRequester(pool, cm);

    requester.start();
    await jest.advanceTimersByTimeAsync(10_000);
    requester.stop();

    expect(cm.publishToGateway).not.toHaveBeenCalled();
  });

  it("advances to next chunk when cooldown has elapsed", async () => {
    const inProgressRequest = {
      ...BASE_REQUEST,
      status: "in_progress",
      current_chunk_start: new Date("2026-03-12T10:00:00Z"),
      last_chunk_sent_at: new Date(Date.now() - 25_000), // 25s ago (> 20s cooldown)
    };
    const { pool, queries } = createMockPool([inProgressRequest]);
    const cm = createMockConnectionManager();
    const requester = new BackfillRequester(pool, cm);

    requester.start();
    await jest.advanceTimersByTimeAsync(10_000);
    requester.stop();

    // Should publish next chunk
    expect(cm.publishToGateway).toHaveBeenCalledTimes(1);

    // Should update current_chunk_start
    const chunkUpdate = queries.find(
      (q) =>
        q.sql.includes("UPDATE backfill_requests") &&
        q.sql.includes("current_chunk_start"),
    );
    expect(chunkUpdate).toBeDefined();
  });

  it("marks request completed when all chunks are done", async () => {
    const lastChunkRequest = {
      ...BASE_REQUEST,
      status: "in_progress",
      // current_chunk_start is at the last chunk — next would exceed gap_end
      current_chunk_start: new Date("2026-03-12T11:30:00Z"),
      last_chunk_sent_at: new Date(Date.now() - 25_000),
    };
    const { pool, queries } = createMockPool([lastChunkRequest]);
    const cm = createMockConnectionManager();
    const requester = new BackfillRequester(pool, cm);

    requester.start();
    await jest.advanceTimersByTimeAsync(10_000);
    requester.stop();

    // Should NOT publish (all chunks done)
    expect(cm.publishToGateway).not.toHaveBeenCalled();

    // Should mark completed and stamp terminal evidence for retention cleanup
    const completedUpdate = queries.find(
      (q) =>
        q.sql.includes("UPDATE backfill_requests") &&
        q.sql.includes("'completed'"),
    );
    expect(completedUpdate).toBeDefined();
    expect(completedUpdate?.sql).toContain("completed_at = NOW()");
  });

  it("marks request failed when gateway is offline", async () => {
    const { pool, queries } = createMockPool([BASE_REQUEST]);
    const cm = createMockConnectionManager(false); // offline
    const requester = new BackfillRequester(pool, cm);

    requester.start();
    await jest.advanceTimersByTimeAsync(10_000);
    requester.stop();

    // Should mark failed and stamp completed_at for terminal retention cleanup
    const failedUpdate = queries.find(
      (q) =>
        q.sql.includes("UPDATE backfill_requests") &&
        q.sql.includes("'failed'"),
    );
    expect(failedUpdate).toBeDefined();
    expect(failedUpdate?.sql).toContain("completed_at = NOW()");
    expect(cm.publishToGateway).not.toHaveBeenCalled();
  });

  it("marks request failed with completed_at when first publish fails", async () => {
    const { pool, queries } = createMockPool([BASE_REQUEST]);
    const cm = createMockConnectionManager(true, false); // publish failure
    const requester = new BackfillRequester(pool, cm);

    requester.start();
    await jest.advanceTimersByTimeAsync(10_000);
    requester.stop();

    const failedUpdate = queries.find(
      (q) =>
        q.sql.includes("UPDATE backfill_requests") &&
        q.sql.includes("'failed'"),
    );
    expect(failedUpdate).toBeDefined();
    expect(failedUpdate?.sql).toContain("completed_at = NOW()");
  });

  it("publishes to correct topic format: platform/ems/{gatewayId}/data/get_missed", async () => {
    const { pool } = createMockPool([BASE_REQUEST]);
    const cm = createMockConnectionManager();
    const requester = new BackfillRequester(pool, cm);

    requester.start();
    await jest.advanceTimersByTimeAsync(10_000);
    requester.stop();

    const [gatewayId, topic, payloadStr] = (
      cm.publishToGateway as jest.Mock
    ).mock.calls[0];
    expect(gatewayId).toBe("gw-001");
    expect(topic).toBe("platform/ems/gw-001/data/get_missed");

    const payload = JSON.parse(payloadStr);
    expect(payload.data.start).toBeDefined();
    expect(payload.data.end).toBeDefined();
  });

  it("stop() clears the poll timer", async () => {
    const { pool } = createMockPool([]);
    const cm = createMockConnectionManager();
    const requester = new BackfillRequester(pool, cm);

    requester.start();
    requester.stop();

    // Advance past several poll intervals — should not trigger
    await jest.advanceTimersByTimeAsync(60_000);
    expect((pool as unknown as { connect: jest.Mock }).connect).toHaveBeenCalledTimes(0);
  });
});
