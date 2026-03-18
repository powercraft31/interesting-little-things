import { Pool } from "pg";
import type { SolfacilMessage } from "../../shared/types/solfacil-protocol";
import { FragmentAssembler } from "../services/fragment-assembler";

/**
 * PR3 / v6.1: TelemetryHandler
 *
 * Processes `device/ems/{clientId}/data` messages (MSG#1-5).
 * Routes ALL messages to FragmentAssembler for accumulation and merge.
 *
 * v6.1: Added Gateway-level backfill trigger.
 * When a gap > 5 min is detected on the Gateway primary telemetry stream,
 * inserts a backfill_request. This is the sole backfill trigger path
 * (heartbeat-handler no longer triggers backfill).
 *
 * TimeStamp Rule: `recorded_at` comes from `payload.timeStamp`.
 * Server-side NOW() is FORBIDDEN for telemetry writes.
 */

const BACKFILL_GAP_THRESHOLD_MS = 300_000; // 5 minutes

/** Per-pool FragmentAssembler singleton. */
const assemblerMap = new WeakMap<Pool, FragmentAssembler>();

/** Per-pool last-telemetry-timestamp cache per gateway. */
const lastTelemetryMap = new WeakMap<Pool, Map<string, number>>();

function getAssembler(pool: Pool): FragmentAssembler {
  let assembler = assemblerMap.get(pool);
  if (!assembler) {
    assembler = new FragmentAssembler(pool);
    assemblerMap.set(pool, assembler);
  }
  return assembler;
}

function getLastTelemetryCache(pool: Pool): Map<string, number> {
  let cache = lastTelemetryMap.get(pool);
  if (!cache) {
    cache = new Map();
    lastTelemetryMap.set(pool, cache);
  }
  return cache;
}

/**
 * Handle telemetry data message from a gateway.
 * Delegates to FragmentAssembler for fragment accumulation and merge.
 * v6.1: Detects gateway-level telemetry gaps > 5 min for backfill trigger.
 */
export async function handleTelemetry(
  pool: Pool,
  gatewayId: string,
  _clientId: string,
  payload: SolfacilMessage,
): Promise<void> {
  // v6.1: Gateway-level telemetry gap detection for backfill trigger
  const currentTs = parseInt(payload.timeStamp, 10);
  if (Number.isFinite(currentTs) && currentTs > 0) {
    await checkTelemetryGap(pool, gatewayId, currentTs);
  }

  const assembler = getAssembler(pool);
  assembler.receive(payload.clientId, payload);
}

/**
 * v6.1: Check for telemetry gap > 5 min on gateway primary stream.
 * If gap detected, insert backfill_request with status='pending'.
 */
async function checkTelemetryGap(
  pool: Pool,
  gatewayId: string,
  currentTs: number,
): Promise<void> {
  const cache = getLastTelemetryCache(pool);
  const previousTs = cache.get(gatewayId);

  // Update cache with current timestamp
  cache.set(gatewayId, currentTs);

  // No previous timestamp — first message for this gateway since startup
  if (previousTs === undefined) return;

  const gapMs = currentTs - previousTs;

  if (gapMs > BACKFILL_GAP_THRESHOLD_MS) {
    await pool.query(
      `INSERT INTO backfill_requests (gateway_id, gap_start, gap_end, status)
       VALUES ($1, to_timestamp($2::bigint / 1000.0), to_timestamp($3::bigint / 1000.0), 'pending')`,
      [gatewayId, previousTs, currentTs],
    );
    console.log(
      `[TelemetryHandler] Backfill trigger: ${gatewayId}, gap=${Math.round(gapMs / 60000)}min`,
    );
  }
}

/** For testing: destroy the cached assembler for a pool. */
export function _destroyAssembler(pool: Pool): void {
  const assembler = assemblerMap.get(pool);
  if (assembler) {
    assembler.destroy();
    assemblerMap.delete(pool);
  }
}

/** For testing: clear the last-telemetry cache for a pool. */
export function _clearTelemetryCache(pool: Pool): void {
  lastTelemetryMap.delete(pool);
}

/** Safe parseFloat: returns 0 for undefined/null/empty/NaN/Infinity values. */
export function safeFloat(val: string | undefined): number {
  if (val === undefined || val === null || val === "") return 0;
  const n = parseFloat(val);
  return Number.isFinite(n) ? n : 0;
}
