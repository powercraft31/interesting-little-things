// Hourly Aggregator — rolls up telemetry_history into asset_hourly_metrics
// Cron: runs at :05 every hour
import cron from "node-cron";
import { Pool } from "pg";

export function startTelemetryAggregator(pool: Pool): void {
  cron.schedule("5 * * * *", () => runHourlyAggregation(pool));
}

export async function runHourlyAggregation(pool: Pool): Promise<void> {
  try {
    // Aggregate the PREVIOUS hour (e.g. if now is 14:05, aggregate 13:00–14:00)
    const now = new Date();
    const hourEnd = new Date(now);
    hourEnd.setMinutes(0, 0, 0);
    const hourStart = new Date(hourEnd);
    hourStart.setHours(hourStart.getHours() - 1);

    const result = await pool.query<{
      asset_id: string;
      charge: string;
      discharge: string;
      pv_generation: string;
      grid_import: string;
      grid_export: string;
      load_consumption: string;
      avg_soc: string;
      peak_bat_power: string;
      avg_battery_soh: string | null;
      avg_battery_voltage: string | null;
      avg_battery_temperature: string | null;
      count: string;
    }>(
      `SELECT
         asset_id,
         SUM(CASE WHEN battery_power > 0 THEN battery_power * (1.0/4) ELSE 0 END)     AS charge,
         SUM(CASE WHEN battery_power < 0 THEN ABS(battery_power) * (1.0/4) ELSE 0 END) AS discharge,
         SUM(COALESCE(pv_power, 0) * (1.0/4))                                           AS pv_generation,
         SUM(CASE WHEN grid_power_kw > 0 THEN grid_power_kw * (1.0/4) ELSE 0 END)      AS grid_import,
         SUM(CASE WHEN grid_power_kw < 0 THEN ABS(grid_power_kw) * (1.0/4) ELSE 0 END) AS grid_export,
         SUM(COALESCE(load_power, 0) * (1.0/4))                                          AS load_consumption,
         AVG(battery_soc)                                                                 AS avg_soc,
         MAX(ABS(COALESCE(battery_power, 0)))                                             AS peak_bat_power,
         AVG(battery_soh)                                                                 AS avg_battery_soh,
         AVG(battery_voltage)                                                             AS avg_battery_voltage,
         AVG(battery_temperature)                                                         AS avg_battery_temperature,
         COUNT(*)                                                                         AS count
       FROM telemetry_history
       WHERE recorded_at >= $1 AND recorded_at < $2
       GROUP BY asset_id`,
      [hourStart.toISOString(), hourEnd.toISOString()],
    );

    for (const row of result.rows) {
      await pool.query(
        `INSERT INTO asset_hourly_metrics
           (asset_id, hour_timestamp, total_charge_kwh, total_discharge_kwh,
            pv_generation_kwh, grid_import_kwh, grid_export_kwh,
            load_consumption_kwh, avg_battery_soc, peak_battery_power_kw,
            avg_battery_soh, avg_battery_voltage, avg_battery_temperature,
            data_points_count, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW())
         ON CONFLICT (asset_id, hour_timestamp) DO UPDATE SET
           total_charge_kwh      = EXCLUDED.total_charge_kwh,
           total_discharge_kwh   = EXCLUDED.total_discharge_kwh,
           pv_generation_kwh     = EXCLUDED.pv_generation_kwh,
           grid_import_kwh       = EXCLUDED.grid_import_kwh,
           grid_export_kwh       = EXCLUDED.grid_export_kwh,
           load_consumption_kwh  = EXCLUDED.load_consumption_kwh,
           avg_battery_soc       = EXCLUDED.avg_battery_soc,
           peak_battery_power_kw = EXCLUDED.peak_battery_power_kw,
           avg_battery_soh       = EXCLUDED.avg_battery_soh,
           avg_battery_voltage   = EXCLUDED.avg_battery_voltage,
           avg_battery_temperature = EXCLUDED.avg_battery_temperature,
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
          row.avg_battery_soh ? parseFloat(row.avg_battery_soh) : null,
          row.avg_battery_voltage ? parseFloat(row.avg_battery_voltage) : null,
          row.avg_battery_temperature ? parseFloat(row.avg_battery_temperature) : null,
          parseInt(row.count, 10),
        ],
      );
    }

    console.log(
      `[TelemetryAggregator] Aggregated ${result.rows.length} assets for hour ${hourStart.toISOString()}`,
    );
  } catch (err) {
    console.error("[TelemetryAggregator] Error:", err);
  }
}
