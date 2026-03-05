import { getServicePool, closeAllPools } from "../../src/shared/db";
import { runTimeoutChecker } from "../../src/dr-dispatcher/handlers/timeout-checker";
import { Pool } from "pg";

jest.mock("node-cron", () => ({
  schedule: jest.fn(),
}));

describe("timeout-checker (v5.9)", () => {
  let pool: Pool;
  let testTradeId: number;
  let testDispatchId: number;

  beforeAll(() => {
    pool = getServicePool();
  });

  beforeEach(async () => {
    // Insert a trade_schedule in 'executing' state with an old planned_time
    const tradeResult = await pool.query<{ id: number }>(`
      INSERT INTO trade_schedules
        (asset_id, org_id, planned_time, action, expected_volume_kwh, target_pld_price, status)
      VALUES
        ('ASSET_SP_001', 'ORG_ENERGIA_001', NOW() - INTERVAL '30 minutes', 'discharge', 5.0, 350.00, 'executing')
      RETURNING id
    `);
    testTradeId = tradeResult.rows[0].id;

    // Insert a stale dispatch_command (dispatched > 15 min ago)
    const dispatchResult = await pool.query<{ id: number }>(
      `
      INSERT INTO dispatch_commands
        (trade_id, asset_id, org_id, action, volume_kwh, status, m1_boundary, dispatched_at)
      VALUES
        ($1, 'ASSET_SP_001', 'ORG_ENERGIA_001', 'discharge', 5.0, 'dispatched', true,
         NOW() - INTERVAL '20 minutes')
      RETURNING id
    `,
      [testTradeId],
    );
    testDispatchId = dispatchResult.rows[0].id;
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM dispatch_commands WHERE trade_id = $1`, [
      testTradeId,
    ]);
    await pool.query(`DELETE FROM trade_schedules WHERE id = $1`, [
      testTradeId,
    ]);
  });

  afterAll(async () => {
    await closeAllPools();
  });

  it("marks stale dispatched commands as failed after 15 minutes", async () => {
    await runTimeoutChecker(pool);

    const dispatch = await pool.query<{ status: string }>(
      `SELECT status FROM dispatch_commands WHERE id = $1`,
      [testDispatchId],
    );
    expect(dispatch.rows[0].status).toBe("failed");
  });

  it("cascades failure to parent trade_schedules", async () => {
    await runTimeoutChecker(pool);

    const trade = await pool.query<{ status: string }>(
      `SELECT status FROM trade_schedules WHERE id = $1`,
      [testTradeId],
    );
    expect(trade.rows[0].status).toBe("failed");
  });

  it("does nothing when no stale commands exist", async () => {
    // Update dispatched_at to recent → should not be caught by timeout
    await pool.query(
      `UPDATE dispatch_commands SET dispatched_at = NOW() WHERE id = $1`,
      [testDispatchId],
    );

    await runTimeoutChecker(pool);

    const dispatch = await pool.query<{ status: string }>(
      `SELECT status FROM dispatch_commands WHERE id = $1`,
      [testDispatchId],
    );
    expect(dispatch.rows[0].status).toBe("dispatched"); // unchanged
  });
});
