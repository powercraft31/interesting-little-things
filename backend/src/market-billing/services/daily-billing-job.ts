import cron from "node-cron";
import { Pool } from "pg";
import {
  calculateBaselineCost,
  calculateActualCost,
  calculateBestTouCost,
  calculateSelfConsumption,
  calculateSelfSufficiency,
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

    // Step 1: Fetch hour-level metrics for yesterday, per asset — v5.14: add load + soc + DP params
    const hourlyResult = await pool.query<{
      asset_id: string;
      org_id: string;
      capacity_kwh: string;
      soc_min_pct: string | null;
      max_charge_rate_kw: string | null;
      max_discharge_rate_kw: string | null;
      hour: number;
      total_charge_kwh: string;
      total_discharge_kwh: string;
      pv_generation_kwh: string;
      grid_import_kwh: string;
      grid_export_kwh: string;
      load_consumption_kwh: string;
      avg_battery_soc: string | null;
    }>(
      `SELECT
         ahm.asset_id,
         a.org_id,
         a.capacity_kwh,
         a.soc_min_pct,
         a.max_charge_rate_kw,
         a.max_discharge_rate_kw,
         EXTRACT(HOUR FROM ahm.hour_timestamp AT TIME ZONE 'America/Sao_Paulo')::INT AS hour,
         ahm.total_charge_kwh,
         ahm.total_discharge_kwh,
         ahm.pv_generation_kwh,
         ahm.grid_import_kwh,
         ahm.grid_export_kwh,
         ahm.load_consumption_kwh,
         ahm.avg_battery_soc
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
        socMinPct: number;
        maxChargeRateKw: number;
        maxDischargeRateKw: number;
        hours: Array<{
          hour: number;
          chargeKwh: number;
          dischargeKwh: number;
          loadKwh: number;
          pvKwh: number;
          gridImportKwh: number;
        }>;
        initialSoc: number;
        totalPvKwh: number;
        totalGridImportKwh: number;
        totalGridExportKwh: number;
        totalDischargeKwh: number;
        totalLoadKwh: number;
      }
    >();

    for (const row of hourlyResult.rows) {
      const capacityKwh = Number(row.capacity_kwh);
      let entry = assetMap.get(row.asset_id);
      if (!entry) {
        entry = {
          orgId: row.org_id,
          capacityKwh,
          socMinPct: row.soc_min_pct ? Number(row.soc_min_pct) : 10,
          maxChargeRateKw: row.max_charge_rate_kw
            ? Number(row.max_charge_rate_kw)
            : capacityKwh,
          maxDischargeRateKw: row.max_discharge_rate_kw
            ? Number(row.max_discharge_rate_kw)
            : capacityKwh,
          hours: [],
          initialSoc: capacityKwh * 0.5, // fallback: 50%
          totalPvKwh: 0,
          totalGridImportKwh: 0,
          totalGridExportKwh: 0,
          totalDischargeKwh: 0,
          totalLoadKwh: 0,
        };
        assetMap.set(row.asset_id, entry);
      }
      const loadKwh = Number(row.load_consumption_kwh);
      const pvKwh = Number(row.pv_generation_kwh);
      const gridImportKwh = Number(row.grid_import_kwh);
      entry.hours.push({
        hour: row.hour,
        chargeKwh: Number(row.total_charge_kwh),
        dischargeKwh: Number(row.total_discharge_kwh),
        loadKwh,
        pvKwh,
        gridImportKwh,
      });
      // Use hour 0 SoC as initial SoC for DP
      if (row.hour === 0 && row.avg_battery_soc) {
        entry.initialSoc =
          (Number(row.avg_battery_soc) / 100) * entry.capacityKwh;
      }
      entry.totalPvKwh += pvKwh;
      entry.totalGridImportKwh += gridImportKwh;
      entry.totalGridExportKwh += Number(row.grid_export_kwh);
      entry.totalDischargeKwh += Number(row.total_discharge_kwh);
      entry.totalLoadKwh += loadKwh;
    }

    // Step 4: Calculate and UPSERT per asset
    for (const [assetId, entry] of assetMap) {
      const schedule = tariffByOrg.get(entry.orgId) ?? DEFAULT_SCHEDULE;

      const hourlyLoads = entry.hours.map((h) => ({
        hour: h.hour,
        loadKwh: h.loadKwh,
      }));
      const hourlyGridImports = entry.hours.map((h) => ({
        hour: h.hour,
        gridImportKwh: h.gridImportKwh,
      }));
      const hourlyData = entry.hours.map((h) => ({
        hour: h.hour,
        loadKwh: h.loadKwh,
        pvKwh: h.pvKwh,
      }));

      const baselineCost = calculateBaselineCost(hourlyLoads, schedule);
      const actualCost = calculateActualCost(hourlyGridImports, schedule);

      const dpResult = calculateBestTouCost({
        hourlyData,
        schedule,
        capacity: entry.capacityKwh,
        socInitial: entry.initialSoc,
        socMinPct: entry.socMinPct,
        maxChargeRateKw: entry.maxChargeRateKw,
        maxDischargeRateKw: entry.maxDischargeRateKw,
      });

      const selfConsumption = calculateSelfConsumption(
        entry.totalPvKwh,
        entry.totalGridExportKwh,
      );

      const selfSufficiency = calculateSelfSufficiency(
        entry.totalLoadKwh,
        entry.totalGridImportKwh,
      );

      // client_savings_reais = baseline - actual (simple, correct)
      const clientSavings = Math.round((baselineCost - actualCost) * 100) / 100;

      // PLD arbitrage kept for future-proofing (placeholder until PLD data is real)
      const arbitrageProfit = 0;

      await pool.query(
        `INSERT INTO revenue_daily
           (asset_id, date,
            vpp_arbitrage_profit_reais, client_savings_reais,
            revenue_reais, cost_reais, profit_reais,
            actual_self_consumption_pct,
            pv_energy_kwh, grid_export_kwh, grid_import_kwh, bat_discharged_kwh,
            baseline_cost_reais, actual_cost_reais, best_tou_cost_reais,
            self_sufficiency_pct,
            calculated_at)
         VALUES ($1, $2, $3, $4, $4, 0, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
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
           baseline_cost_reais         = EXCLUDED.baseline_cost_reais,
           actual_cost_reais           = EXCLUDED.actual_cost_reais,
           best_tou_cost_reais         = EXCLUDED.best_tou_cost_reais,
           self_sufficiency_pct        = EXCLUDED.self_sufficiency_pct,
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
          baselineCost,
          actualCost,
          dpResult.bestCost,
          selfSufficiency,
        ],
      );
    }

    // Step 5 (v5.15): SC/TOU Attribution from 5-min windows + dispatch_records
    // BRT-aligned billing window: yesterday BRT = [yesterday 03:00 UTC, today 03:00 UTC)
    const brtWindowStart = new Date(yesterday);
    brtWindowStart.setUTCHours(3, 0, 0, 0);
    const brtWindowEnd = new Date(brtWindowStart);
    brtWindowEnd.setUTCDate(brtWindowEnd.getUTCDate() + 1);

    const attributionResult = await pool.query<{
      asset_id: string;
      sc_energy_kwh: string;
      tou_discharge_kwh: string;
      tou_charge_kwh: string;
    }>(
      `WITH windowed AS (
        SELECT
          m.asset_id,
          m.window_start,
          m.pv_energy_kwh,
          m.bat_discharge_kwh,
          m.grid_export_kwh,
          m.bat_charge_from_grid_kwh,
          COALESCE(
            (SELECT COALESCE(dr.target_mode, 'UNASSIGNED')
             FROM dispatch_records dr
             WHERE dr.asset_id = m.asset_id
               AND dr.dispatched_at <= m.window_start
             ORDER BY dr.dispatched_at DESC
             LIMIT 1),
            'UNASSIGNED'
          ) AS active_mode
        FROM asset_5min_metrics m
        WHERE m.window_start >= $1 AND m.window_start < $2
      )
      SELECT
        asset_id,
        SUM(CASE WHEN active_mode = 'self_consumption'
          THEN GREATEST(0, pv_energy_kwh - grid_export_kwh) ELSE 0 END) AS sc_energy_kwh,
        SUM(CASE WHEN active_mode = 'peak_valley_arbitrage'
          THEN bat_discharge_kwh ELSE 0 END) AS tou_discharge_kwh,
        SUM(CASE WHEN active_mode = 'peak_valley_arbitrage'
          THEN bat_charge_from_grid_kwh ELSE 0 END) AS tou_charge_kwh
      FROM windowed
      GROUP BY asset_id`,
      [brtWindowStart.toISOString(), brtWindowEnd.toISOString()],
    );

    for (const attr of attributionResult.rows) {
      const assetEntry = assetMap.get(attr.asset_id);
      const schedule = assetEntry
        ? (tariffByOrg.get(assetEntry.orgId) ?? DEFAULT_SCHEDULE)
        : DEFAULT_SCHEDULE;

      const scEnergyKwh = parseFloat(attr.sc_energy_kwh);
      const touDischargeKwh = parseFloat(attr.tou_discharge_kwh);
      const touChargeKwh = parseFloat(attr.tou_charge_kwh);

      // SC savings: energy self-consumed valued at average rate
      // Simplified: use intermediate rate as weighted average approximation
      const avgRate = schedule.intermediateRate ?? schedule.peakRate;
      const scSavings = Math.round(scEnergyKwh * avgRate * 100) / 100;

      // TOU savings: discharge at peak rate minus charge cost at offpeak rate
      const touSavings =
        Math.round(
          (touDischargeKwh * schedule.peakRate -
            touChargeKwh * schedule.offpeakRate) *
            100,
        ) / 100;

      await pool.query(
        `UPDATE revenue_daily SET
           sc_savings_reais = $1,
           tou_savings_reais = $2
         WHERE asset_id = $3 AND date = $4`,
        [scSavings, touSavings, attr.asset_id, dateStr],
      );
    }

    console.log(`[BillingJob] Settled ${assetMap.size} assets for ${dateStr}`);
  } catch (err) {
    console.error("[BillingJob] Error:", err);
  }
}
