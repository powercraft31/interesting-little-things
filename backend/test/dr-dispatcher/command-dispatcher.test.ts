import { getServicePool, closeAllPools } from "../../src/shared/db";
import { runCommandDispatcher } from "../../src/dr-dispatcher/services/command-dispatcher";
import { Pool } from "pg";

jest.mock("node-cron", () => ({
  schedule: jest.fn(),
}));

describe("command-dispatcher (M3)", () => {
  let pool: Pool;
  let testTradeId: number;
  let fixtureAssetId: string;
  let fixtureOrgId: string;
  let fixtureGatewayId: string;

  beforeAll(() => {
    pool = getServicePool();
  });

  beforeEach(async () => {
    const fixture = await pool.query<{
      asset_id: string;
      org_id: string;
      gateway_id: string;
    }>(`
      SELECT asset_id, org_id, gateway_id
      FROM assets
      WHERE is_active = true
        AND org_id = 'ORG_ENERGIA_001'
      ORDER BY asset_id
      LIMIT 1
    `);
    fixtureAssetId = fixture.rows[0].asset_id;
    fixtureOrgId = fixture.rows[0].org_id;
    fixtureGatewayId = fixture.rows[0].gateway_id;

    // 插入一筆「時間已到」的測試排程
    const result = await pool.query<{ id: number }>(`
      INSERT INTO trade_schedules
        (asset_id, org_id, planned_time, action, expected_volume_kwh, target_pld_price, status)
      VALUES
        ($1, $2, NOW() - INTERVAL '2 minutes', 'discharge', 5.0, 350.00, 'scheduled')
      RETURNING id
    `, [fixtureAssetId, fixtureOrgId]);
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
    await closeAllPools();
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

  it("v5.16: peak_shaving schedule → dispatch_records.target_mode = 'peak_shaving' with peak_limit_kva", async () => {
    // Insert a PS schedule with target_mode
    const psResult = await pool.query<{ id: number }>(`
      INSERT INTO trade_schedules
        (asset_id, org_id, planned_time, action, expected_volume_kwh, target_pld_price, status, target_mode)
      VALUES
        ($1, $2, NOW() - INTERVAL '1 minute', 'discharge', 4.0, 0, 'scheduled', 'peak_shaving')
      RETURNING id
    `, [fixtureAssetId, fixtureOrgId]);
    const psTradeId = psResult.rows[0].id;

    // Ensure gateway has contracted_demand_kw (v5.20: moved from homes to gateways)
    await pool.query(
      `UPDATE gateways SET contracted_demand_kw = 50.0 WHERE gateway_id = $1`,
      [fixtureGatewayId],
    );

    await runCommandDispatcher(pool);

    // Verify dispatch_records was written with target_mode = 'peak_shaving'
    const dr = await pool.query<{
      target_mode: string;
      commanded_power_kw: number;
    }>(
      `SELECT target_mode, commanded_power_kw FROM dispatch_records
       WHERE asset_id = $1 AND target_mode = 'peak_shaving'
       ORDER BY dispatched_at DESC LIMIT 1`,
      [fixtureAssetId],
    );
    expect(dr.rows).toHaveLength(1);
    expect(dr.rows[0].target_mode).toBe("peak_shaving");
    // peak_limit_kva = 50.0 / 0.92 ≈ 54.35
    expect(Number(dr.rows[0].commanded_power_kw)).toBeCloseTo(54.35, 1);

    // Cleanup
    await pool.query(
      `DELETE FROM dispatch_records WHERE asset_id = $1 AND target_mode = 'peak_shaving'`,
      [fixtureAssetId],
    );
    await pool.query(`DELETE FROM dispatch_commands WHERE trade_id = $1`, [
      psTradeId,
    ]);
    await pool.query(`DELETE FROM trade_schedules WHERE id = $1`, [psTradeId]);
  });

  it("v5.16: peak_limit_kva division by zero guard (pf=0 → peak_limit_kva = contractedKw)", async () => {
    // Set billing_power_factor = 0 in tariff_schedules
    await pool.query(
      `UPDATE tariff_schedules SET billing_power_factor = 0
       WHERE org_id = $1 AND effective_to IS NULL`,
      [fixtureOrgId],
    );

    // Ensure gateway has contracted_demand_kw (v5.20: moved from homes to gateways)
    await pool.query(
      `UPDATE gateways SET contracted_demand_kw = 60.0 WHERE gateway_id = $1`,
      [fixtureGatewayId],
    );

    const psResult = await pool.query<{ id: number }>(`
      INSERT INTO trade_schedules
        (asset_id, org_id, planned_time, action, expected_volume_kwh, target_pld_price, status, target_mode)
      VALUES
        ($1, $2, NOW() - INTERVAL '1 minute', 'discharge', 4.0, 0, 'scheduled', 'peak_shaving')
      RETURNING id
    `, [fixtureAssetId, fixtureOrgId]);
    const psTradeId = psResult.rows[0].id;

    await runCommandDispatcher(pool);

    const dr = await pool.query<{ commanded_power_kw: number }>(
      `SELECT commanded_power_kw FROM dispatch_records
       WHERE asset_id = $1 AND target_mode = 'peak_shaving'
       ORDER BY dispatched_at DESC LIMIT 1`,
      [fixtureAssetId],
    );
    expect(dr.rows).toHaveLength(1);
    // pf=0 → fallback: peak_limit_kva = contractedKw = 60.0
    expect(Number(dr.rows[0].commanded_power_kw)).toBe(60);

    // Cleanup & restore
    await pool.query(
      `UPDATE tariff_schedules SET billing_power_factor = 0.92
       WHERE org_id = $1 AND effective_to IS NULL`,
      [fixtureOrgId],
    );
    await pool.query(
      `DELETE FROM dispatch_records WHERE asset_id = $1 AND target_mode = 'peak_shaving'`,
      [fixtureAssetId],
    );
    await pool.query(`DELETE FROM dispatch_commands WHERE trade_id = $1`, [
      psTradeId,
    ]);
    await pool.query(`DELETE FROM trade_schedules WHERE id = $1`, [psTradeId]);
  });

  it("v5.9: executing trades are NOT auto-advanced (timeout-checker handles this now)", async () => {
    // Insert a stale 'executing' trade — command-dispatcher should NOT change it
    const result = await pool.query<{ id: number }>(`
      INSERT INTO trade_schedules
        (asset_id, org_id, planned_time, action, expected_volume_kwh, target_pld_price, status)
      VALUES
        ($1, $2, NOW() - INTERVAL '20 minutes', 'charge', 3.0, 100.00, 'executing')
      RETURNING id
    `, [fixtureAssetId, fixtureOrgId]);
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
