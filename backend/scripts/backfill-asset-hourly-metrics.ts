import { getServicePool, closeAllPools } from "../src/shared/db";
import { runHourlyAggregationWindow } from "../src/iot-hub/services/telemetry-aggregator";

const ONE_HOUR_MS = 60 * 60 * 1000;

type Args = {
  from?: Date;
  to?: Date;
  maxHours?: number;
};

function floorToHour(date: Date): Date {
  const floored = new Date(date);
  floored.setUTCMinutes(0, 0, 0);
  return floored;
}

function getPreviousCompleteHourStart(now: Date): Date {
  return new Date(floorToHour(now).getTime() - ONE_HOUR_MS);
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--from" && next) {
      args.from = floorToHour(new Date(next));
      i += 1;
    } else if (arg === "--to" && next) {
      args.to = floorToHour(new Date(next));
      i += 1;
    } else if (arg === "--max-hours" && next) {
      args.maxHours = parseInt(next, 10);
      i += 1;
    }
  }
  return args;
}

async function detectBackfillStart(pool: ReturnType<typeof getServicePool>): Promise<Date | null> {
  const latest = await pool.query<{ max_hour_timestamp: string | null }>(
    "SELECT MAX(hour_timestamp) AS max_hour_timestamp FROM asset_hourly_metrics",
  );
  const latestHour = latest.rows[0]?.max_hour_timestamp;
  if (latestHour) {
    return new Date(new Date(latestHour).getTime() + ONE_HOUR_MS);
  }

  const earliest = await pool.query<{ min_window_start: string | null }>(
    "SELECT MIN(window_start) AS min_window_start FROM asset_5min_metrics",
  );
  const minWindow = earliest.rows[0]?.min_window_start;
  return minWindow ? floorToHour(new Date(minWindow)) : null;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const pool = getServicePool();

  try {
    const from = args.from ?? (await detectBackfillStart(pool));
    const targetHourStart = args.to ?? getPreviousCompleteHourStart(new Date());
    const maxHours = args.maxHours ?? Number.POSITIVE_INFINITY;

    if (!from) {
      console.log("[HourlyBackfill] No source asset_5min_metrics rows found; nothing to backfill.");
      return;
    }

    if (Number.isNaN(from.getTime()) || Number.isNaN(targetHourStart.getTime())) {
      throw new Error("Invalid --from/--to timestamp");
    }

    if (from.getTime() > targetHourStart.getTime()) {
      console.log(
        `[HourlyBackfill] No backlog detected. from=${from.toISOString()} target=${targetHourStart.toISOString()}`,
      );
      return;
    }

    console.log(
      `[HourlyBackfill] Starting backfill from ${from.toISOString()} to ${targetHourStart.toISOString()} (maxHours=${Number.isFinite(maxHours) ? maxHours : "unbounded"})`,
    );

    let processedHours = 0;
    let totalAssets = 0;
    let cursor = new Date(from);

    while (cursor.getTime() <= targetHourStart.getTime() && processedHours < maxHours) {
      const hourEnd = new Date(cursor.getTime() + ONE_HOUR_MS);
      const assetCount = await runHourlyAggregationWindow(pool, cursor, hourEnd);
      totalAssets += assetCount;
      processedHours += 1;

      if (processedHours % 24 == 0) {
        console.log(
          `[HourlyBackfill] Progress: ${processedHours} hours processed; current=${cursor.toISOString()}`,
        );
      }

      cursor = hourEnd;
    }

    const backlogRemaining = cursor.getTime() <= targetHourStart.getTime();
    console.log(
      `[HourlyBackfill] Done. hours=${processedHours} assets=${totalAssets} next=${cursor.toISOString()} remaining=${backlogRemaining}`,
    );
  } finally {
    await closeAllPools();
  }
}

main().catch((err) => {
  console.error("[HourlyBackfill] Fatal error:", err);
  process.exitCode = 1;
});
