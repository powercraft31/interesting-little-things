import { getServicePool, closeAllPools } from "../../src/shared/db";
import { runScheduleGenerator } from "../../src/optimization-engine/services/schedule-generator";
import { Pool } from "pg";

// 讓 node-cron 的 schedule() 不真的啟動定時器
jest.mock("node-cron", () => ({
  schedule: jest.fn(),
}));

describe("schedule-generator (M2)", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = getServicePool();
  });

  afterAll(async () => {
    // 清除測試產生的 scheduled 排程（保留 seed 資料）
    await pool.query(`
      DELETE FROM trade_schedules
      WHERE status = 'scheduled'
        AND planned_time >= NOW()
        AND created_at >= NOW() - INTERVAL '5 minutes'
    `);
    await closeAllPools();
  });

  it("應為所有 active assets 寫入未來 24 小時的排程", async () => {
    // 執行排程生成器
    await runScheduleGenerator(pool);

    // 執行後應新增資料
    const after = await pool.query<{ count: string }>(
      `SELECT COUNT(*) FROM trade_schedules WHERE status = 'scheduled' AND planned_time > NOW()`,
    );
    const countAfter = parseInt(after.rows[0].count, 10);

    // 47 active assets × 24 hours = 1128 base slots
    // v5.16: + PS slots for assets with contracted_demand_kw (N assets × 4 peak hours)
    expect(countAfter).toBeGreaterThanOrEqual(1128);
    expect(countAfter).toBeLessThanOrEqual(1128 + 47 * 4); // upper bound
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

  // ── v5.16 Peak Shaving Tests ────────────────────────────────────

  it("v5.16: assets with contracted_demand_kw → peak_shaving slots generated", async () => {
    // Ensure at least one home has contracted_demand_kw
    await pool.query(
      `UPDATE homes SET contracted_demand_kw = 50.0 WHERE home_id = (SELECT home_id FROM homes ORDER BY home_id LIMIT 1)`,
    );

    await runScheduleGenerator(pool);

    // Check for PS discharge slots (planned_time in peak BRT hours 18-21 = UTC 21-00)
    const result = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM trade_schedules
       WHERE status = 'scheduled'
         AND action = 'discharge'
         AND planned_time > NOW()
         AND asset_id IN (
           SELECT a.asset_id FROM assets a
           JOIN homes h ON h.home_id = a.home_id
           WHERE h.contracted_demand_kw IS NOT NULL
         )`,
    );
    const count = parseInt(result.rows[0].count, 10);
    // At least some PS slots should be created
    expect(count).toBeGreaterThan(0);
  });

  it("v5.16: PS slots have target_mode = 'peak_shaving'", async () => {
    await pool.query(
      `UPDATE homes SET contracted_demand_kw = 50.0 WHERE home_id = (SELECT home_id FROM homes ORDER BY home_id LIMIT 1)`,
    );

    await runScheduleGenerator(pool);

    const result = await pool.query<{ target_mode: string | null }>(
      `SELECT DISTINCT target_mode FROM trade_schedules
       WHERE status = 'scheduled'
         AND target_pld_price = 0
         AND planned_time > NOW()
         AND asset_id IN (
           SELECT a.asset_id FROM assets a
           JOIN homes h ON h.home_id = a.home_id
           WHERE h.contracted_demand_kw IS NOT NULL
         )`,
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].target_mode).toBe("peak_shaving");
  });

  it("v5.16: assets without contracted_demand_kw → no extra peak_shaving slots", async () => {
    // Clear all contracted_demand_kw
    await pool.query(`UPDATE homes SET contracted_demand_kw = NULL`);

    await runScheduleGenerator(pool);

    // Query for PS-specific slots (peak BRT hours with target_pld_price = 0)
    // Since contracted_demand_kw is null for all, no PS slots should be generated
    const result = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM trade_schedules
       WHERE status = 'scheduled'
         AND target_pld_price = 0
         AND planned_time > NOW()`,
    );
    const count = parseInt(result.rows[0].count, 10);
    expect(count).toBe(0);

    // Restore seed data
    await pool.query(
      `UPDATE homes SET contracted_demand_kw = 50.0 WHERE home_id = (SELECT home_id FROM homes ORDER BY home_id LIMIT 1)`,
    );
  });
});
