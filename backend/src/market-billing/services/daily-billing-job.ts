import cron from "node-cron";
import { Pool } from "pg";

export function startBillingJob(pool: Pool): void {
  cron.schedule("5 0 * * *", () => runDailyBilling(pool));
}

export async function runDailyBilling(pool: Pool): Promise<void> {
  try {
    // 昨天的日期
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split("T")[0]; // 'YYYY-MM-DD'

    // 取得昨天 executed 的所有 trades，JOIN assets 取得費率，JOIN pld_horario 取得電價
    // pld_horario 用小時平均值作為代理（因為 pld_horario 沒有真實昨天的資料）
    const result = await pool.query<{
      asset_id: string;
      org_id: string;
      total_discharge_kwh: number;
      total_charge_kwh: number;
      avg_pld: number;
      retail_buy_rate_kwh: number;
    }>(
      `
      SELECT
        ts.asset_id,
        ts.org_id,
        SUM(CASE WHEN ts.action = 'discharge' THEN ts.expected_volume_kwh ELSE 0 END) AS total_discharge_kwh,
        SUM(CASE WHEN ts.action = 'charge'    THEN ts.expected_volume_kwh ELSE 0 END) AS total_charge_kwh,
        COALESCE(
          (SELECT AVG(p.pld_hora) FROM pld_horario p
           WHERE p.hora = EXTRACT(HOUR FROM ts.planned_time)::INT
           LIMIT 1),
          150
        ) AS avg_pld,
        a.retail_buy_rate_kwh
      FROM trade_schedules ts
      JOIN assets a ON a.asset_id = ts.asset_id
      WHERE ts.status = 'executed'
        AND DATE(ts.planned_time AT TIME ZONE 'America/Sao_Paulo') = $1::date
      GROUP BY ts.asset_id, ts.org_id, ts.planned_time, a.retail_buy_rate_kwh
    `,
      [dateStr],
    );

    // 按 asset + org 聚合
    const byAsset: Record<
      string,
      {
        org_id: string;
        arbitrage_profit: number;
        savings: number;
      }
    > = {};

    for (const row of result.rows) {
      if (!byAsset[row.asset_id]) {
        byAsset[row.asset_id] = {
          org_id: row.org_id,
          arbitrage_profit: 0,
          savings: 0,
        };
      }
      // B-side: discharge kWh × PLD (R$/MWh ÷ 1000 = R$/kWh)
      byAsset[row.asset_id].arbitrage_profit +=
        Number(row.total_discharge_kwh) * (Number(row.avg_pld) / 1000);
      // C-side: discharge kWh × retail rate
      byAsset[row.asset_id].savings +=
        Number(row.total_discharge_kwh) * Number(row.retail_buy_rate_kwh);
    }

    // UPSERT revenue_daily
    for (const [assetId, data] of Object.entries(byAsset)) {
      const arbitrage = Math.round(data.arbitrage_profit * 100) / 100;
      const savings = Math.round(data.savings * 100) / 100;
      await pool.query(
        `
        INSERT INTO revenue_daily
          (asset_id, date, vpp_arbitrage_profit_reais, client_savings_reais, revenue_reais, cost_reais, profit_reais)
        VALUES ($1, $2, $3, $4, $3, 0, $3)
        ON CONFLICT (asset_id, date) DO UPDATE SET
          vpp_arbitrage_profit_reais = EXCLUDED.vpp_arbitrage_profit_reais,
          client_savings_reais       = EXCLUDED.client_savings_reais,
          revenue_reais              = EXCLUDED.revenue_reais,
          profit_reais               = EXCLUDED.profit_reais
      `,
        [assetId, dateStr, arbitrage, savings],
      );
    }

    console.log(
      `[BillingJob] Settled revenue for ${Object.keys(byAsset).length} assets on ${dateStr}`,
    );
  } catch (err) {
    console.error("[BillingJob] Error:", err);
  }
}
