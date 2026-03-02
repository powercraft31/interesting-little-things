import { getPool, closePool } from "../../src/shared/db";
import { runCommandDispatcher } from "../../src/dr-dispatcher/services/command-dispatcher";
import { Pool } from "pg";

jest.mock("node-cron", () => ({
  schedule: jest.fn(),
}));

describe("command-dispatcher (M3)", () => {
  let pool: Pool;
  let testTradeId: number;

  beforeAll(() => {
    pool = getPool();
  });

  beforeEach(async () => {
    // 插入一筆「時間已到」的測試排程
    const result = await pool.query<{ id: number }>(`
      INSERT INTO trade_schedules
        (asset_id, org_id, planned_time, action, expected_volume_kwh, target_pld_price, status)
      VALUES
        ('ASSET_SP_001', 'ORG_ENERGIA_001', NOW() - INTERVAL '2 minutes', 'discharge', 5.0, 350.00, 'scheduled')
      RETURNING id
    `);
    testTradeId = result.rows[0].id;
  });

  afterEach(async () => {
    // 清除測試資料
    await pool.query(`DELETE FROM dispatch_commands WHERE trade_id = $1`, [
      testTradeId,
    ]);
    await pool.query(`DELETE FROM trade_schedules WHERE id = $1`, [
      testTradeId,
    ]);
  });

  afterAll(async () => {
    await closePool();
  });

  it("時間已到的 scheduled 排程應被推進為 executing", async () => {
    await runCommandDispatcher(pool);

    const result = await pool.query<{ status: string }>(
      `SELECT status FROM trade_schedules WHERE id = $1`,
      [testTradeId],
    );
    expect(result.rows[0].status).toBe("executing");
  });

  it("推進 executing 時應寫入一筆 dispatch_commands", async () => {
    await runCommandDispatcher(pool);

    const result = await pool.query<{
      trade_id: number;
      action: string;
      m1_boundary: boolean;
    }>(
      `SELECT trade_id, action, m1_boundary FROM dispatch_commands WHERE trade_id = $1`,
      [testTradeId],
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].action).toBe("discharge");
    expect(result.rows[0].m1_boundary).toBe(true); // v5.6 永遠為 true
  });

  it("v5.9: executing trades are NOT auto-advanced (timeout-checker handles this now)", async () => {
    // Insert a stale 'executing' trade — command-dispatcher should NOT change it
    const result = await pool.query<{ id: number }>(`
      INSERT INTO trade_schedules
        (asset_id, org_id, planned_time, action, expected_volume_kwh, target_pld_price, status)
      VALUES
        ('ASSET_SP_001', 'ORG_ENERGIA_001', NOW() - INTERVAL '20 minutes', 'charge', 3.0, 100.00, 'executing')
      RETURNING id
    `);
    const staleId = result.rows[0].id;

    await runCommandDispatcher(pool);

    const check = await pool.query<{ status: string }>(
      `SELECT status FROM trade_schedules WHERE id = $1`,
      [staleId],
    );
    // Should still be 'executing' — NOT 'executed' (timeout-checker.ts owns this now)
    expect(check.rows[0].status).toBe("executing");

    // 清理
    await pool.query(`DELETE FROM trade_schedules WHERE id = $1`, [staleId]);
  });
});
