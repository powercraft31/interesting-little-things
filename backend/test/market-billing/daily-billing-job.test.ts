import { getPool, closePool } from "../../src/shared/db";
import { runDailyBilling } from "../../src/market-billing/services/daily-billing-job";
import { Pool } from "pg";

jest.mock("node-cron", () => ({
  schedule: jest.fn(),
}));

describe("daily-billing-job (M4)", () => {
  let pool: Pool;
  const testAssetId = "ASSET_SP_001";
  const testOrgId = "ORG_ENERGIA_001";
  // 昨天日期
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split("T")[0];

  beforeAll(() => {
    pool = getPool();
  });

  beforeEach(async () => {
    // 插入昨天的 executed 排程（放電 2 小時，每次 5kWh）
    for (let hour = 17; hour <= 18; hour++) {
      const plannedTime = new Date(yesterday);
      plannedTime.setHours(hour, 0, 0, 0);
      await pool.query(
        `
        INSERT INTO trade_schedules
          (asset_id, org_id, planned_time, action, expected_volume_kwh, target_pld_price, status)
        VALUES ($1, $2, $3, 'discharge', 5.0, 350.00, 'executed')
      `,
        [testAssetId, testOrgId, plannedTime.toISOString()],
      );
    }
    // 確保 revenue_daily 沒有昨天的資料（避免舊資料干擾）
    await pool.query(
      `DELETE FROM revenue_daily WHERE asset_id = $1 AND date = $2`,
      [testAssetId, yesterdayStr],
    );
  });

  afterEach(async () => {
    // 清除測試資料
    await pool.query(
      `DELETE FROM trade_schedules WHERE asset_id = $1 AND DATE(planned_time) = $2 AND target_pld_price = 350.00`,
      [testAssetId, yesterdayStr],
    );
    await pool.query(
      `DELETE FROM revenue_daily WHERE asset_id = $1 AND date = $2`,
      [testAssetId, yesterdayStr],
    );
  });

  afterAll(async () => {
    await closePool();
  });

  it("應為昨天的 executed trades 寫入 revenue_daily", async () => {
    await runDailyBilling(pool);

    const result = await pool.query<{
      vpp_arbitrage_profit_reais: string;
      client_savings_reais: string;
    }>(
      `SELECT vpp_arbitrage_profit_reais, client_savings_reais
       FROM revenue_daily
       WHERE asset_id = $1 AND date = $2`,
      [testAssetId, yesterdayStr],
    );
    expect(result.rows).toHaveLength(1);

    // 2 筆 × 5 kWh discharge
    // B-side: 10 kWh × (avg_pld/1000) — avg_pld 來自 pld_horario，大約 R$150-400/MWh
    // 只驗證是正數，不驗證精確值（因為 avg_pld 是從 DB 動態算）
    const arbitrage = parseFloat(result.rows[0].vpp_arbitrage_profit_reais);
    const savings = parseFloat(result.rows[0].client_savings_reais);
    expect(arbitrage).toBeGreaterThan(0);
    expect(savings).toBeGreaterThan(0);
  });

  it("重複執行不應產生重複資料（UPSERT 冪等性）", async () => {
    await runDailyBilling(pool);
    await runDailyBilling(pool); // 跑兩次

    const result = await pool.query<{ count: string }>(
      `SELECT COUNT(*) FROM revenue_daily WHERE asset_id = $1 AND date = $2`,
      [testAssetId, yesterdayStr],
    );
    expect(parseInt(result.rows[0].count, 10)).toBe(1); // 只有 1 筆，不是 2
  });
});
