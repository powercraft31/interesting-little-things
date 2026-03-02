import cron from "node-cron";
import { Pool } from "pg";

export function startBillingJob(pool: Pool): void {
  cron.schedule("5 0 * * *", () => runDailyBilling(pool));
}

export async function runDailyBilling(pool: Pool): Promise<void> {
  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split("T")[0]; // 'YYYY-MM-DD'

    // -- M4 BOUNDARY RULE: reads asset_hourly_metrics only. NEVER query telemetry_history directly.
    const result = await pool.query<{
      asset_id: string;
      org_id: string;
      total_discharge_kwh: number;
      total_charge_kwh: number;
      arbitrage_profit_reais: number;
      retail_buy_rate_kwh: number;
    }>(
      `SELECT
         ahm.asset_id,
         a.org_id,
         SUM(ahm.total_discharge_kwh) AS total_discharge_kwh,
         SUM(ahm.total_charge_kwh)    AS total_charge_kwh,
         SUM(ahm.total_discharge_kwh * COALESCE(p.pld_hora, 150) / 1000.0) AS arbitrage_profit_reais,
         a.retail_buy_rate_kwh
       FROM asset_hourly_metrics ahm
       JOIN assets a ON a.asset_id = ahm.asset_id
       LEFT JOIN pld_horario p
         ON p.hora = EXTRACT(HOUR FROM ahm.hour_timestamp)::INT
         AND p.dia = EXTRACT(DAY FROM ahm.hour_timestamp AT TIME ZONE 'America/Sao_Paulo')::INT
         AND p.mes_referencia = (EXTRACT(YEAR FROM ahm.hour_timestamp AT TIME ZONE 'America/Sao_Paulo') * 100
                                + EXTRACT(MONTH FROM ahm.hour_timestamp AT TIME ZONE 'America/Sao_Paulo'))::INT
         AND p.submercado = a.submercado
       WHERE DATE(ahm.hour_timestamp AT TIME ZONE 'America/Sao_Paulo') = $1::date
       GROUP BY ahm.asset_id, a.org_id, a.retail_buy_rate_kwh`,
      [dateStr],
    );

    // UPSERT revenue_daily
    for (const row of result.rows) {
      const arbitrage =
        Math.round(Number(row.arbitrage_profit_reais) * 100) / 100;
      const savings =
        Math.round(
          Number(row.total_discharge_kwh) *
            Number(row.retail_buy_rate_kwh) *
            100,
        ) / 100;

      await pool.query(
        `INSERT INTO revenue_daily
           (asset_id, date, vpp_arbitrage_profit_reais, client_savings_reais, revenue_reais, cost_reais, profit_reais)
         VALUES ($1, $2, $3, $4, $3, 0, $3)
         ON CONFLICT (asset_id, date) DO UPDATE SET
           vpp_arbitrage_profit_reais = EXCLUDED.vpp_arbitrage_profit_reais,
           client_savings_reais       = EXCLUDED.client_savings_reais,
           revenue_reais              = EXCLUDED.revenue_reais,
           profit_reais               = EXCLUDED.profit_reais`,
        [row.asset_id, dateStr, arbitrage, savings],
      );
    }

    console.log(
      `[BillingJob] Settled revenue for ${result.rows.length} assets on ${dateStr}`,
    );
  } catch (err) {
    console.error("[BillingJob] Error:", err);
  }
}
