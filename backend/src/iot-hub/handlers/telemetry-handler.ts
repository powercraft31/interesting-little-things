import { Pool } from "pg";
import type { SolfacilMessage } from "../../shared/types/solfacil-protocol";
import { FragmentAssembler } from "../services/fragment-assembler";
import { parseProtocolTimestamp } from "../../shared/protocol-time";
import { parseRuntimeFlags } from "../../shared/runtime/flags";
import {
  emitIngestTelemetryStale,
  maybeEmitIngestTelemetryRecovered,
  recordIngestFreshness,
} from "../../shared/runtime/ingest-emitters";

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
 * v6.10 WS5: The same gap boundary also emits `ingest.telemetry.stale`
 * (best-effort) and every successfully parsed telemetry cadence ticks the
 * `ingest.freshness` self-check. Runtime governance is strictly observational
 * and never gates the existing backfill/telemetry flow.
 *
 * TimeStamp Rule: `recorded_at` comes from `payload.timeStamp`.
 * Server-side NOW() is FORBIDDEN for telemetry writes.
 */

const BACKFILL_GAP_THRESHOLD_MS = 300_000; // 5 minutes

/** Per-pool FragmentAssembler singleton. */
const assemblerMap = new WeakMap<Pool, FragmentAssembler>();

/** Per-pool last-telemetry-timestamp cache per gateway. */
const lastTelemetryMap = new WeakMap<Pool, Map<string, Date>>();

function getAssembler(pool: Pool): FragmentAssembler {
  let assembler = assemblerMap.get(pool);
  if (!assembler) {
    assembler = new FragmentAssembler(pool);
    assemblerMap.set(pool, assembler);
  }
  return assembler;
}

function getLastTelemetryCache(pool: Pool): Map<string, Date> {
  let cache = lastTelemetryMap.get(pool);
  if (!cache) {
    cache = new Map();
    lastTelemetryMap.set(pool, cache);
  }
  return cache;
}

interface GapCheckResult {
  readonly previousDate: Date | null;
  readonly gapMs: number | null;
  readonly gapDetected: boolean;
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
  // v6.1: Gateway-level telemetry gap detection for backfill trigger.
  // v6.10 WS5 / I3 fix: same boundary drives runtime governance —
  // stale + recovery lifecycle + ingest.freshness self-check state.
  let currentDate: Date;
  let gap: GapCheckResult | null = null;
  try {
    currentDate = parseProtocolTimestamp(payload.timeStamp);
    gap = await checkTelemetryGap(pool, gatewayId, currentDate);
  } catch {
    // Invalid timestamp - skip gap check + runtime governance, still pass to assembler
    const assembler = getAssembler(pool);
    assembler.receive(payload.clientId, payload);
    return;
  }

  emitRuntimeGovernance(gatewayId, currentDate, gap);

  const assembler = getAssembler(pool);
  assembler.receive(payload.clientId, payload);
}

/**
 * v6.1: Check for telemetry gap > 5 min on gateway primary stream.
 * If gap detected, insert backfill_request with status='pending'.
 * Domain-level only — runtime governance emission is handled separately
 * at the same boundary by emitRuntimeGovernance().
 */
async function checkTelemetryGap(
  pool: Pool,
  gatewayId: string,
  currentDate: Date,
): Promise<GapCheckResult> {
  const cache = getLastTelemetryCache(pool);
  const previousDate = cache.get(gatewayId) ?? null;

  cache.set(gatewayId, currentDate);

  if (previousDate === null) {
    return { previousDate: null, gapMs: null, gapDetected: false };
  }

  const gapMs = currentDate.getTime() - previousDate.getTime();

  if (gapMs < 0) {
    console.warn(`[TelemetryHandler] Clock rollback detected for ${gatewayId}: ${gapMs}ms, skipping gap check`);
    return { previousDate, gapMs, gapDetected: false };
  }

  if (gapMs > BACKFILL_GAP_THRESHOLD_MS) {
    await pool.query(
      `INSERT INTO backfill_requests (gateway_id, gap_start, gap_end, status)
       VALUES ($1, $2::timestamptz, $3::timestamptz, 'pending')`,
      [gatewayId, previousDate.toISOString(), currentDate.toISOString()],
    );
    console.log(
      `[TelemetryHandler] Backfill trigger: ${gatewayId}, gap=${Math.round(gapMs / 60000)}min`,
    );
    return { previousDate, gapMs, gapDetected: true };
  }

  return { previousDate, gapMs, gapDetected: false };
}

/**
 * v6.10 WS5 / I3 fix: drive M1 runtime governance at the telemetry boundary.
 *
 *  - On gap boundary: emit `ingest.telemetry.stale` (detect) AND flip the
 *    ingest.freshness self-check to last_status='stale'.
 *  - On fresh arrival (no gap): call the canonical-authority recovery helper.
 *    Recovery is driven by the runtime_issues row itself (same fingerprint),
 *    not by process-local state, so a restart between detect and recovery
 *    cannot lose authority. Then record freshness 'pass'. No new event codes.
 *
 * All runtime emission is fire-and-forget; emitters themselves enforce the
 * disabled / best-effort / no-active-issue contracts so the ingest hot path
 * stays silent.
 */
function emitRuntimeGovernance(
  gatewayId: string,
  currentDate: Date,
  gap: GapCheckResult,
): void {
  const flags = parseRuntimeFlags(process.env);
  const tenantScope = `gateway:${gatewayId}`;

  if (gap.gapDetected && gap.previousDate !== null && gap.gapMs !== null) {
    void emitIngestTelemetryStale(
      { flags },
      {
        tenantScope,
        gatewayId,
        lastObservedAt: gap.previousDate,
        observedAt: currentDate,
        staleForMs: gap.gapMs,
        thresholdMs: BACKFILL_GAP_THRESHOLD_MS,
      },
    ).catch(() => {
      /* best-effort — runtime emission never blocks backfill flow */
    });

    void recordIngestFreshness(
      { flags },
      {
        status: "stale",
        observedAt: gap.previousDate,
        detail: {
          gateway_id: gatewayId,
          last_observed_at: gap.previousDate.toISOString(),
          observed_at: currentDate.toISOString(),
          stale_for_ms: gap.gapMs,
          threshold_ms: BACKFILL_GAP_THRESHOLD_MS,
        },
      },
    ).catch(() => {
      /* best-effort — emitter already logs its own fallback */
    });

    return;
  }

  // Fresh arrival: canonical recovery. Authority is the runtime_issues row —
  // the helper is a no-op when there's no active detected/ongoing issue, so
  // normal cadence does not synthesize recovered rows.
  if (gap.previousDate !== null) {
    const recoveryGapMs = currentDate.getTime() - gap.previousDate.getTime();
    void maybeEmitIngestTelemetryRecovered(
      { flags },
      {
        tenantScope,
        gatewayId,
        lastObservedAt: gap.previousDate,
        observedAt: currentDate,
        gapMs: recoveryGapMs,
      },
    ).catch(() => {
      /* best-effort */
    });
  }

  void recordIngestFreshness(
    { flags },
    {
      status: "pass",
      observedAt: currentDate,
      detail: { gateway_id: gatewayId, observed_at: currentDate.toISOString() },
    },
  ).catch(() => {
    /* best-effort — emitter already logs its own fallback */
  });
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
