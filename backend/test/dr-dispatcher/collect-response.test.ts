import { getPool, closePool } from "../../src/shared/db";
import { createAckHandler } from "../../src/dr-dispatcher/handlers/collect-response";
import { Pool } from "pg";
import type { Request, Response } from "express";

jest.mock("node-cron", () => ({
  schedule: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Express mock helpers
// ---------------------------------------------------------------------------

function mockRes(): Response {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
}

function mockReq(body: Record<string, unknown>): Request {
  return { body } as unknown as Request;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("collect-response ACK handler (v5.9)", () => {
  let pool: Pool;
  let handler: (req: Request, res: Response) => Promise<void>;
  let testTradeId: number;
  let testDispatchId: number;

  beforeAll(() => {
    pool = getPool();
    handler = createAckHandler(pool);
  });

  beforeEach(async () => {
    // Insert a trade_schedule in 'executing' state
    const tradeResult = await pool.query<{ id: number }>(`
      INSERT INTO trade_schedules
        (asset_id, org_id, planned_time, action, expected_volume_kwh, target_pld_price, status)
      VALUES
        ('ASSET_SP_001', 'ORG_ENERGIA_001', NOW() - INTERVAL '2 minutes', 'discharge', 5.0, 350.00, 'executing')
      RETURNING id
    `);
    testTradeId = tradeResult.rows[0].id;

    // Insert a dispatch_command in 'dispatched' state
    const dispatchResult = await pool.query<{ id: number }>(`
      INSERT INTO dispatch_commands
        (trade_id, asset_id, org_id, action, volume_kwh, status, m1_boundary)
      VALUES
        ($1, 'ASSET_SP_001', 'ORG_ENERGIA_001', 'discharge', 5.0, 'dispatched', true)
      RETURNING id
    `, [testTradeId]);
    testDispatchId = dispatchResult.rows[0].id;
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM dispatch_commands WHERE trade_id = $1`, [testTradeId]);
    await pool.query(`DELETE FROM trade_schedules WHERE id = $1`, [testTradeId]);
  });

  afterAll(async () => {
    await closePool();
  });

  it("valid ACK (completed) → 200, dispatch marked completed, trade marked executed", async () => {
    const req = mockReq({ dispatch_id: testDispatchId, status: "completed", asset_id: "ASSET_SP_001" });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true, dispatch_id: testDispatchId, status: "completed" }),
    );

    // Verify DB state
    const dispatch = await pool.query(`SELECT status FROM dispatch_commands WHERE id = $1`, [testDispatchId]);
    expect(dispatch.rows[0].status).toBe("completed");

    const trade = await pool.query(`SELECT status FROM trade_schedules WHERE id = $1`, [testTradeId]);
    expect(trade.rows[0].status).toBe("executed");
  });

  it("valid ACK (failed) → 200, trade marked failed", async () => {
    const req = mockReq({ dispatch_id: testDispatchId, status: "failed", asset_id: "ASSET_SP_001" });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);

    const trade = await pool.query(`SELECT status FROM trade_schedules WHERE id = $1`, [testTradeId]);
    expect(trade.rows[0].status).toBe("failed");
  });

  it("already terminal → 409 Conflict", async () => {
    // First ACK: complete it
    await pool.query(`UPDATE dispatch_commands SET status = 'completed' WHERE id = $1`, [testDispatchId]);

    const req = mockReq({ dispatch_id: testDispatchId, status: "completed", asset_id: "ASSET_SP_001" });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false }),
    );
  });

  it("not found → 404", async () => {
    const req = mockReq({ dispatch_id: 999999, status: "completed", asset_id: "ASSET_SP_001" });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false }),
    );
  });

  it("missing fields → 400", async () => {
    const req = mockReq({ dispatch_id: testDispatchId });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});
