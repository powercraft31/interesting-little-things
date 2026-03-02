import { getPool, closePool } from "../../src/shared/db";
import { runScheduleGenerator } from "../../src/optimization-engine/services/schedule-generator";
import { Pool } from "pg";

// 讓 node-cron 的 schedule() 不真的啟動定時器
jest.mock("node-cron", () => ({
  schedule: jest.fn(),
}));

describe("schedule-generator (M2)", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = getPool();
  });

  afterAll(async () => {
    // 清除測試產生的 scheduled 排程（保留 seed 資料）
    await pool.query(`
      DELETE FROM trade_schedules
      WHERE status = 'scheduled'
        AND planned_time >= NOW()
        AND created_at >= NOW() - INTERVAL '5 minutes'
    `);
    await closePool();
  });

  it("應為所有 active assets 寫入未來 24 小時的排程", async () => {
    // 執行排程生成器
    await runScheduleGenerator(pool);

    // 執行後應新增資料
    const after = await pool.query<{ count: string }>(
      `SELECT COUNT(*) FROM trade_schedules WHERE status = 'scheduled' AND planned_time > NOW()`,
    );
    const countAfter = parseInt(after.rows[0].count, 10);

    // 4 個 active assets × 24 小時 = 96 筆（generator 先 DELETE 再 INSERT，所以是絕對值）
    expect(countAfter).toBe(96);
    // 因為 DELETE 舊排程再 INSERT，count 應該是固定的 96，不是累加
  });

  it("產生的排程 action 只能是 charge 或 discharge", async () => {
    await runScheduleGenerator(pool);

    const result = await pool.query<{ action: string }>(
      `SELECT DISTINCT action FROM trade_schedules WHERE status = 'scheduled' AND planned_time > NOW()`,
    );
    const actions = result.rows.map((r) => r.action);
    actions.forEach((action) => {
      expect(["charge", "discharge"]).toContain(action);
    });
  });

  it("深夜 00:00-05:00 時段應為 charge", async () => {
    await runScheduleGenerator(pool);

    const result = await pool.query<{ action: string; hora: number }>(
      `SELECT action, EXTRACT(HOUR FROM planned_time AT TIME ZONE 'America/Sao_Paulo') as hora
       FROM trade_schedules
       WHERE status = 'scheduled'
         AND planned_time > NOW()
         AND EXTRACT(HOUR FROM planned_time AT TIME ZONE 'America/Sao_Paulo') BETWEEN 0 AND 4`,
    );

    result.rows.forEach((row) => {
      expect(row.action).toBe("charge");
    });
  });

  // ── v5.9 SoC Guardrail Tests ──────────────────────────────────────

  it("SoC guardrail: asset with battery_soc >= max_soc skips charge slots", async () => {
    // Set an asset's SoC to 96% (above default max_soc=95)
    await pool.query(
      `UPDATE device_state SET battery_soc = 96 WHERE asset_id = 'ASSET_SP_001'`,
    );

    await runScheduleGenerator(pool);

    // SP_001 should have fewer scheduled slots (charge slots become idle → skipped)
    const result = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM trade_schedules
       WHERE asset_id = 'ASSET_SP_001'
         AND status = 'scheduled'
         AND planned_time > NOW()`,
    );
    const count = parseInt(result.rows[0].count, 10);

    // With SoC=96 >= max_soc=95, all 'charge' actions become idle and are skipped.
    // Only 'discharge' slots (PLD >= 300) should remain, which is fewer than 24.
    expect(count).toBeLessThan(24);

    // Reset for other tests
    await pool.query(
      `UPDATE device_state SET battery_soc = 65 WHERE asset_id = 'ASSET_SP_001'`,
    );
  });

  it("SoC guardrail: asset with battery_soc <= min_soc skips discharge slots", async () => {
    // Set an asset's SoC to 15% (below default min_soc=20)
    await pool.query(
      `UPDATE device_state SET battery_soc = 15 WHERE asset_id = 'ASSET_RJ_002'`,
    );

    await runScheduleGenerator(pool);

    // RJ_002 discharge slots should be skipped. All actions should be 'charge' only.
    const result = await pool.query<{ action: string }>(
      `SELECT DISTINCT action FROM trade_schedules
       WHERE asset_id = 'ASSET_RJ_002'
         AND status = 'scheduled'
         AND planned_time > NOW()`,
    );
    const actions = result.rows.map((r) => r.action);
    // Should only have 'charge' (discharge was blocked by min_soc guardrail)
    expect(actions).not.toContain("discharge");

    // Reset for other tests
    await pool.query(
      `UPDATE device_state SET battery_soc = 72 WHERE asset_id = 'ASSET_RJ_002'`,
    );
  });
});
