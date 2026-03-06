import cron from "node-cron";
import { Pool } from "pg";
import {
  calculateDailySavings,
  calculateSelfConsumption,
  type TariffSchedule,
} from "../../shared/tarifa";

export function startBillingJob(pool: Pool): void {
  cron.schedule("5 0 * * *", () => runDailyBilling(pool));
}

const DEFAULT_SCHEDULE: TariffSchedule = {
  peakRate: 0.82,
  offpeakRate: 0.25,
  intermediateRate: 0.55,
};

export async function runDailyBilling(pool: Pool): Promise<void> {
  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split("T")[0];

    // -- M4 BOUNDARY RULE: reads asset_hourly_metrics only. NEVER query telemetry_history directly.

    // Step 1: Fetch hour-level metrics for yesterday, per asset
    const hourlyResult = await pool.query<{
      asset_id: string;
      org_id: string;
      capacity_kwh: string;
      hour: number;
      total_charge_kwh: string;
      total_discharge_kwh: string;
      pv_generation_kwh: string;
      grid_import_kwh: string;
      grid_export_kwh: string;
    }>(
      `SELECT
         ahm.asset_id,
         a.org_id,
         a.capacity_kwh,
         EXTRACT(HOUR FROM ahm.hour_timestamp AT TIME ZONE 'America/Sao_Paulo')::INT AS hour,
         ahm.total_charge_kwh,
         ahm.total_discharge_kwh,
         ahm.pv_generation_kwh,
         ahm.grid_import_kwh,
         ahm.grid_export_kwh
       FROM asset_hourly_metrics ahm
       JOIN assets a ON a.asset_id = ahm.asset_id
       WHERE DATE(ahm.hour_timestamp AT TIME ZONE 'America/Sao_Paulo') = $1::date
       ORDER BY ahm.asset_id, ahm.hour_timestamp`,
      [dateStr],
    );

    // Step 2: Fetch tariff schedules per org
    const tariffResult = await pool.query<{
      org_id: string;
      peak_rate: string;
      offpeak_rate: string;
      intermediate_rate: string | null;
    }>(
      `SELECT DISTINCT ON (org_id)
         org_id, peak_rate, offpeak_rate, intermediate_rate
       FROM tariff_schedules
       WHERE effective_from <= $1::date
         AND (effective_to IS NULL OR effective_to >= $1::date)
       ORDER BY org_id, effective_from DESC`,
      [dateStr],
    );

    const tariffByOrg = new Map<string, TariffSchedule>(
      tariffResult.rows.map((r) => [
        r.org_id,
        {
          peakRate: Number(r.peak_rate),
          offpeakRate: Number(r.offpeak_rate),
          intermediateRate: r.intermediate_rate
            ? Number(r.intermediate_rate)
            : null,
        },
      ]),
    );

    // Step 3: Group hourly data by asset, compute daily totals
    const assetMap = new Map<
      string,
      {
        orgId: string;
        capacityKwh: number;
        hours: Array<{
          hour: number;
          chargeKwh: number;
          dischargeKwh: number;
        }>;
        totalPvKwh: number;
        totalGridImportKwh: number;
        totalGridExportKwh: number;
        totalDischargeKwh: number;
      }
    >();

    for (const row of hourlyResult.rows) {
      let entry = assetMap.get(row.asset_id);
      if (!entry) {
        entry = {
          orgId: row.org_id,
          capacityKwh: Number(row.capacity_kwh),
          hours: [],
          totalPvKwh: 0,
          totalGridImportKwh: 0,
          totalGridExportKwh: 0,
          totalDischargeKwh: 0,
        };
        assetMap.set(row.asset_id, entry);
      }
      entry.hours.push({
        hour: row.hour,
        chargeKwh: Number(row.total_charge_kwh),
        dischargeKwh: Number(row.total_discharge_kwh),
      });
      entry.totalPvKwh += Number(row.pv_generation_kwh);
      entry.totalGridImportKwh += Number(row.grid_import_kwh);
      entry.totalGridExportKwh += Number(row.grid_export_kwh);
      entry.totalDischargeKwh += Number(row.total_discharge_kwh);
    }

    // Step 4: Calculate and UPSERT per asset
    for (const [assetId, entry] of assetMap) {
      const schedule = tariffByOrg.get(entry.orgId) ?? DEFAULT_SCHEDULE;

      const clientSavings = calculateDailySavings(entry.hours, schedule);

      const selfConsumption = calculateSelfConsumption(
        entry.totalPvKwh,
        entry.totalGridExportKwh,
      );

      // PLD arbitrage kept for future-proofing (placeholder until PLD data is real)
      const arbitrageProfit = 0;

      await pool.query(
        `INSERT INTO revenue_daily
           (asset_id, date,
            vpp_arbitrage_profit_reais, client_savings_reais,
            revenue_reais, cost_reais, profit_reais,
            actual_self_consumption_pct,
            pv_energy_kwh, grid_export_kwh, grid_import_kwh, bat_discharged_kwh,
            calculated_at)
         VALUES ($1, $2, $3, $4, $4, 0, $4, $5, $6, $7, $8, $9, NOW())
         ON CONFLICT (asset_id, date) DO UPDATE SET
           vpp_arbitrage_profit_reais  = EXCLUDED.vpp_arbitrage_profit_reais,
           client_savings_reais        = EXCLUDED.client_savings_reais,
           revenue_reais               = EXCLUDED.revenue_reais,
           profit_reais                = EXCLUDED.profit_reais,
           actual_self_consumption_pct = EXCLUDED.actual_self_consumption_pct,
           pv_energy_kwh               = EXCLUDED.pv_energy_kwh,
           grid_export_kwh             = EXCLUDED.grid_export_kwh,
           grid_import_kwh             = EXCLUDED.grid_import_kwh,
           bat_discharged_kwh          = EXCLUDED.bat_discharged_kwh,
           calculated_at               = EXCLUDED.calculated_at`,
        [
          assetId,
          dateStr,
          arbitrageProfit,
          clientSavings,
          selfConsumption,
          entry.totalPvKwh,
          entry.totalGridExportKwh,
          entry.totalGridImportKwh,
          entry.totalDischargeKwh,
        ],
      );
    }

    console.log(`[BillingJob] Settled ${assetMap.size} assets for ${dateStr}`);
  } catch (err) {
    console.error("[BillingJob] Error:", err);
  }
}
