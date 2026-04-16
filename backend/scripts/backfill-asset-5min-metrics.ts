import { getServicePool, closeAllPools } from "../src/shared/db";
import { runFiveMinAggregationWindow } from "../src/iot-hub/services/telemetry-5min-aggregator";

const FIVE_MINUTES_MS = 5 * 60 * 1000;

type Args = {
  from?: Date;
  to?: Date;
  maxWindows?: number;
};

function floorToFiveMinuteBoundary(date: Date): Date {
  const floored = new Date(date);
  floored.setUTCSeconds(0, 0);
  floored.setUTCMinutes(floored.getUTCMinutes() - (floored.getUTCMinutes() % 5));
  return floored;
}

function getPreviousCompleteWindowStart(now: Date): Date {
  return new Date(floorToFiveMinuteBoundary(now).getTime() - FIVE_MINUTES_MS);
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--from" && next) {
      args.from = floorToFiveMinuteBoundary(new Date(next));
      i += 1;
    } else if (arg === "--to" && next) {
      args.to = floorToFiveMinuteBoundary(new Date(next));
      i += 1;
    } else if (arg === "--max-windows" && next) {
      args.maxWindows = parseInt(next, 10);
      i += 1;
    }
  }
  return args;
}

async function detectBackfillStart(pool: ReturnType<typeof getServicePool>): Promise<Date | null> {
  const latest = await pool.query<{ max_window_start: string | null }>(
    "SELECT MAX(window_start) AS max_window_start FROM asset_5min_metrics",
  );
  const latestWindowStart = latest.rows[0]?.max_window_start;
  if (latestWindowStart) {
    return new Date(new Date(latestWindowStart).getTime() + FIVE_MINUTES_MS);
  }

  const earliest = await pool.query<{ min_recorded_at: string | null }>(
    "SELECT MIN(recorded_at) AS min_recorded_at FROM telemetry_history",
  );
  const minRecordedAt = earliest.rows[0]?.min_recorded_at;
  return minRecordedAt ? floorToFiveMinuteBoundary(new Date(minRecordedAt)) : null;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const pool = getServicePool();

  try {
    const from = args.from ?? (await detectBackfillStart(pool));
    const targetWindowStart = args.to ?? getPreviousCompleteWindowStart(new Date());
    const maxWindows = args.maxWindows ?? Number.POSITIVE_INFINITY;

    if (!from) {
      console.log("[5MinBackfill] No telemetry_history rows found; nothing to backfill.");
      return;
    }

    if (Number.isNaN(from.getTime()) || Number.isNaN(targetWindowStart.getTime())) {
      throw new Error("Invalid --from/--to timestamp");
    }

    if (from.getTime() > targetWindowStart.getTime()) {
      console.log(
        `[5MinBackfill] No backlog detected. from=${from.toISOString()} target=${targetWindowStart.toISOString()}`,
      );
      return;
    }

    console.log(
      `[5MinBackfill] Starting backfill from ${from.toISOString()} to ${targetWindowStart.toISOString()} (maxWindows=${Number.isFinite(maxWindows) ? maxWindows : "unbounded"})`,
    );

    let processedWindows = 0;
    let totalAssets = 0;
    let cursor = new Date(from);

    while (cursor.getTime() <= targetWindowStart.getTime() && processedWindows < maxWindows) {
      const windowEnd = new Date(cursor.getTime() + FIVE_MINUTES_MS);
      const assetCount = await runFiveMinAggregationWindow(pool, cursor, windowEnd);
      totalAssets += assetCount;
      processedWindows += 1;

      if (processedWindows % 100 === 0) {
        console.log(
          `[5MinBackfill] Progress: ${processedWindows} windows processed; current=${cursor.toISOString()}`,
        );
      }

      cursor = windowEnd;
    }

    const backlogRemaining = cursor.getTime() <= targetWindowStart.getTime();
    console.log(
      `[5MinBackfill] Done. windows=${processedWindows} assets=${totalAssets} next=${cursor.toISOString()} remaining=${backlogRemaining}`,
    );
  } finally {
    await closeAllPools();
  }
}

main().catch((err) => {
  console.error("[5MinBackfill] Fatal error:", err);
  process.exitCode = 1;
});
