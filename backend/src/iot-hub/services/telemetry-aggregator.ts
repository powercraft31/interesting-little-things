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
      count: string;
    }>(
      `SELECT
         asset_id,
         SUM(CASE WHEN energy_kwh > 0 THEN energy_kwh ELSE 0 END) AS charge,
         SUM(CASE WHEN energy_kwh < 0 THEN ABS(energy_kwh) ELSE 0 END) AS discharge,
         COUNT(*) AS count
       FROM telemetry_history
       WHERE recorded_at >= $1 AND recorded_at < $2
       GROUP BY asset_id`,
      [hourStart.toISOString(), hourEnd.toISOString()],
    );

    for (const row of result.rows) {
      await pool.query(
        `INSERT INTO asset_hourly_metrics
           (asset_id, hour_timestamp, total_charge_kwh, total_discharge_kwh, data_points_count, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
         ON CONFLICT (asset_id, hour_timestamp) DO UPDATE SET
           total_charge_kwh    = EXCLUDED.total_charge_kwh,
           total_discharge_kwh = EXCLUDED.total_discharge_kwh,
           data_points_count   = EXCLUDED.data_points_count,
           updated_at          = NOW()`,
        [
          row.asset_id,
          hourStart.toISOString(),
          parseFloat(row.charge),
          parseFloat(row.discharge),
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
