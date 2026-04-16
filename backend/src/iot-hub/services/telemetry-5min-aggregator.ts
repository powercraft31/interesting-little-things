// 5-Min Aggregator — rolls up telemetry_history into asset_5min_metrics
// Cron: runs every 5 minutes at :00, :05, :10, etc.
import cron from "node-cron";
import { Pool } from "pg";

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const PARTITION_DAY_CUTOFF_HOURS_UTC = 3;

export type Asset5MinPartitionSpec = {
  partitionName: string;
  start: Date;
  end: Date;
};

type AggregationRow = {
  asset_id: string;
  pv_energy_kwh: string;
  bat_charge_kwh: string;
  bat_discharge_kwh: string;
  grid_import_kwh: string;
  grid_export_kwh: string;
  load_kwh: string;
  avg_battery_soc: string | null;
  data_points: string;
};

function formatPartitionDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

export function computeAsset5MinPartitionSpec(windowStart: Date): Asset5MinPartitionSpec {
  const shifted = new Date(windowStart.getTime() - PARTITION_DAY_CUTOFF_HOURS_UTC * 60 * 60 * 1000);
  const partitionStart = new Date(
    Date.UTC(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth(),
      shifted.getUTCDate(),
      PARTITION_DAY_CUTOFF_HOURS_UTC,
      0,
      0,
      0,
    ),
  );
  const partitionEnd = new Date(partitionStart.getTime() + 24 * 60 * 60 * 1000);

  return {
    partitionName: `asset_5min_metrics_${formatPartitionDate(shifted)}`,
    start: partitionStart,
    end: partitionEnd,
  };
}

export async function ensureAsset5MinPartition(pool: Pool, windowStart: Date): Promise<void> {
  const spec = computeAsset5MinPartitionSpec(windowStart);
  await pool.query(
    `CREATE TABLE IF NOT EXISTS ${spec.partitionName} PARTITION OF asset_5min_metrics
     FOR VALUES FROM ('${spec.start.toISOString()}') TO ('${spec.end.toISOString()}')`,
  );
}

function getPreviousFiveMinuteWindow(now: Date): { windowStart: Date; windowEnd: Date } {
  const windowEnd = new Date(now);
  windowEnd.setSeconds(0, 0);
  const mins = windowEnd.getMinutes();
  windowEnd.setMinutes(mins - (mins % 5));
  const windowStart = new Date(windowEnd.getTime() - FIVE_MINUTES_MS);
  return { windowStart, windowEnd };
}

export function startTelemetry5MinAggregator(pool: Pool): void {
  cron.schedule("*/5 * * * *", () => runFiveMinAggregation(pool));
}

export async function runFiveMinAggregationWindow(
  pool: Pool,
  windowStart: Date,
  windowEnd: Date,
): Promise<number> {
  await ensureAsset5MinPartition(pool, windowStart);

  const result = await pool.query<AggregationRow>(
    `SELECT
       asset_id,
       AVG(CASE WHEN pv_power > 0 THEN pv_power ELSE 0 END)         * (1.0/12) AS pv_energy_kwh,
       AVG(CASE WHEN battery_power > 0 THEN battery_power ELSE 0 END) * (1.0/12) AS bat_charge_kwh,
       AVG(CASE WHEN battery_power < 0 THEN ABS(battery_power) ELSE 0 END) * (1.0/12) AS bat_discharge_kwh,
       AVG(CASE WHEN grid_power_kw > 0 THEN grid_power_kw ELSE 0 END)  * (1.0/12) AS grid_import_kwh,
       AVG(CASE WHEN grid_power_kw < 0 THEN ABS(grid_power_kw) ELSE 0 END) * (1.0/12) AS grid_export_kwh,
       AVG(COALESCE(load_power, 0))                                   * (1.0/12) AS load_kwh,
       AVG(battery_soc) AS avg_battery_soc,
       COUNT(*) AS data_points
     FROM telemetry_history
     WHERE recorded_at >= $1 AND recorded_at < $2
     GROUP BY asset_id`,
    [windowStart.toISOString(), windowEnd.toISOString()],
  );

  for (const row of result.rows) {
    const pvEnergy = parseFloat(row.pv_energy_kwh);
    const batCharge = parseFloat(row.bat_charge_kwh);
    const load = parseFloat(row.load_kwh);

    // Derived: how much of battery charge came from grid
    // PV surplus that could go to battery = max(0, pvEnergy - load)
    const pvSurplus = Math.max(0, pvEnergy - load);
    const pvToBat = Math.min(batCharge, pvSurplus);
    const batFromGrid = Math.max(0, batCharge - pvToBat);

    await pool.query(
      `INSERT INTO asset_5min_metrics
         (asset_id, window_start, pv_energy_kwh, bat_charge_kwh, bat_discharge_kwh,
          grid_import_kwh, grid_export_kwh, load_kwh, bat_charge_from_grid_kwh,
          avg_battery_soc, data_points)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (asset_id, window_start) DO UPDATE SET
         pv_energy_kwh            = EXCLUDED.pv_energy_kwh,
         bat_charge_kwh           = EXCLUDED.bat_charge_kwh,
         bat_discharge_kwh        = EXCLUDED.bat_discharge_kwh,
         grid_import_kwh          = EXCLUDED.grid_import_kwh,
         grid_export_kwh          = EXCLUDED.grid_export_kwh,
         load_kwh                 = EXCLUDED.load_kwh,
         bat_charge_from_grid_kwh = EXCLUDED.bat_charge_from_grid_kwh,
         avg_battery_soc          = EXCLUDED.avg_battery_soc,
         data_points              = EXCLUDED.data_points`,
      [
        row.asset_id,
        windowStart.toISOString(),
        pvEnergy,
        batCharge,
        parseFloat(row.bat_discharge_kwh),
        parseFloat(row.grid_import_kwh),
        parseFloat(row.grid_export_kwh),
        load,
        batFromGrid,
        row.avg_battery_soc ? parseFloat(row.avg_battery_soc) : null,
        parseInt(row.data_points, 10),
      ],
    );
  }

  console.log(
    `[5MinAggregator] Aggregated ${result.rows.length} assets for window ${windowStart.toISOString()}`,
  );
  return result.rows.length;
}

export async function runFiveMinAggregation(pool: Pool): Promise<void> {
  try {
    const { windowStart, windowEnd } = getPreviousFiveMinuteWindow(new Date());
    await runFiveMinAggregationWindow(pool, windowStart, windowEnd);
  } catch (err) {
    console.error("[5MinAggregator] Error:", err);
  }
}
