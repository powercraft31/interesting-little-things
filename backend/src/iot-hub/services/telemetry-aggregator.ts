// Hourly Aggregator — rolls up asset_5min_metrics into asset_hourly_metrics
// Cron: runs at :05 every hour
// v5.15: source changed from telemetry_history to asset_5min_metrics (no factor needed)
import cron from "node-cron";
import { Pool } from "pg";

type HourlyAggregationRow = {
  asset_id: string;
  charge: string;
  discharge: string;
  pv_generation: string;
  grid_import: string;
  grid_export: string;
  load_consumption: string;
  avg_soc: string;
  peak_bat_power: string;
  count: string;
};

function getPreviousHourWindow(now: Date): { hourStart: Date; hourEnd: Date } {
  const hourEnd = new Date(now);
  hourEnd.setMinutes(0, 0, 0);
  const hourStart = new Date(hourEnd);
  hourStart.setHours(hourStart.getHours() - 1);
  return { hourStart, hourEnd };
}

export function startTelemetryAggregator(pool: Pool): void {
  cron.schedule("5 * * * *", () => runHourlyAggregation(pool));
}

export async function runHourlyAggregationWindow(
  pool: Pool,
  hourStart: Date,
  hourEnd: Date,
): Promise<number> {
  const result = await pool.query<HourlyAggregationRow>(
    `SELECT
       asset_id,
       SUM(bat_charge_kwh)                       AS charge,
       SUM(bat_discharge_kwh)                    AS discharge,
       SUM(pv_energy_kwh)                        AS pv_generation,
       SUM(grid_import_kwh)                      AS grid_import,
       SUM(grid_export_kwh)                      AS grid_export,
       SUM(load_kwh)                             AS load_consumption,
       AVG(avg_battery_soc)                      AS avg_soc,
       MAX(bat_discharge_kwh * 12)               AS peak_bat_power,
       COUNT(*)                                  AS count
     FROM asset_5min_metrics
     WHERE window_start >= $1 AND window_start < $2
     GROUP BY asset_id`,
    [hourStart.toISOString(), hourEnd.toISOString()],
  );

  for (const row of result.rows) {
    await pool.query(
      `INSERT INTO asset_hourly_metrics
         (asset_id, hour_timestamp, total_charge_kwh, total_discharge_kwh,
          pv_generation_kwh, grid_import_kwh, grid_export_kwh,
          load_consumption_kwh, avg_battery_soc, peak_battery_power_kw,
          data_points_count, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
       ON CONFLICT (asset_id, hour_timestamp) DO UPDATE SET
         total_charge_kwh      = EXCLUDED.total_charge_kwh,
         total_discharge_kwh   = EXCLUDED.total_discharge_kwh,
         pv_generation_kwh     = EXCLUDED.pv_generation_kwh,
         grid_import_kwh       = EXCLUDED.grid_import_kwh,
         grid_export_kwh       = EXCLUDED.grid_export_kwh,
         load_consumption_kwh  = EXCLUDED.load_consumption_kwh,
         avg_battery_soc       = EXCLUDED.avg_battery_soc,
         peak_battery_power_kw = EXCLUDED.peak_battery_power_kw,
         data_points_count     = EXCLUDED.data_points_count,
         updated_at            = NOW()`,
      [
        row.asset_id,
        hourStart.toISOString(),
        parseFloat(row.charge),
        parseFloat(row.discharge),
        parseFloat(row.pv_generation),
        parseFloat(row.grid_import),
        parseFloat(row.grid_export),
        parseFloat(row.load_consumption),
        row.avg_soc ? parseFloat(row.avg_soc) : null,
        row.peak_bat_power ? parseFloat(row.peak_bat_power) : null,
        parseInt(row.count, 10),
      ],
    );
  }

  console.log(
    `[TelemetryAggregator] Aggregated ${result.rows.length} assets for hour ${hourStart.toISOString()}`,
  );
  return result.rows.length;
}

export async function runHourlyAggregation(pool: Pool): Promise<void> {
  try {
    const { hourStart, hourEnd } = getPreviousHourWindow(new Date());
    await runHourlyAggregationWindow(pool, hourStart, hourEnd);
  } catch (err) {
    console.error("[TelemetryAggregator] Error:", err);
  }
}
