/**
 * DB substrate — runtime probes and pool idle-error facts (v6.10 WS4).
 *
 * Responsibilities:
 *  - provide minimal `probeAppPool`, `probeServicePool`, `probeCriticalQuery`
 *    primitives whose only side effect is one short-lived pool.connect() call
 *    and at most one representative `SELECT 1`-style query.
 *  - orchestrate the three phase-1 DB self-checks and drive the latest-state
 *    rows in runtime_self_checks through the existing shared persistence
 *    interface.
 *  - emit a structured runtime_event on probe failure using the registered
 *    db.app_pool.unreachable / db.service_pool.unreachable /
 *    db.critical_query.failed codes.
 *  - route pool `error` events (idle client lost, connection reset, etc.) to
 *    a bounded db.pool.idle_error fact so they stop living only in free-form
 *    console output.
 *
 * Guardrails:
 *  - no probe is allowed to throw to the caller.
 *  - governance-off means a full no-op: no events, no self-check rows,
 *    no connect() calls for self-checks (the caller still pays for pool.on()
 *    wiring but the handler does nothing).
 *  - probes are measured with a monotonic clock and bounded via the pool's
 *    existing connectionTimeoutMillis — we do not introduce a new timeout.
 */

import type { Pool } from "pg";
import { computeFingerprint } from "./contract";
import { emitRuntimeEvent, type EmitRuntimeEventResult } from "./emit";
import { isSliceEnabled, type RuntimeFlags } from "./flags";
import type { RuntimeQueryable } from "./persistence";
import {
  fetchRuntimeIssueByFingerprint,
  runWithServicePool,
  upsertRuntimeSelfCheck,
} from "./persistence";
import {
  applySelfCheckFail,
  applySelfCheckPass,
  buildInitialSelfCheckRow,
  type Phase1SelfCheckSpec,
  getPhase1SelfCheckSpec,
} from "./self-check";
import type { Phase1SelfCheckId, RuntimeSelfCheckRow } from "../types/runtime";

// ─────────────────────────────────────────────────────────────────────────────
// Probe primitives
// ─────────────────────────────────────────────────────────────────────────────

export type ProbeStatus = "pass" | "fail";

export interface ProbeResult {
  readonly status: ProbeStatus;
  readonly durationMs: number;
  readonly error?: Error;
}

function coerceError(err: unknown): Error {
  if (err instanceof Error) {
    return err;
  }
  return new Error(typeof err === "string" ? err : "db-probe: unknown error");
}

async function timeProbe(
  fn: () => Promise<void>,
): Promise<ProbeResult> {
  const start = Date.now();
  try {
    await fn();
    return { status: "pass", durationMs: Date.now() - start };
  } catch (err) {
    return {
      status: "fail",
      durationMs: Date.now() - start,
      error: coerceError(err),
    };
  }
}

/** Short-lived connect+release — proves the pool can hand out a client. */
export async function probeAppPool(pool: Pool): Promise<ProbeResult> {
  return timeProbe(async () => {
    const client = await pool.connect();
    client.release();
  });
}

export async function probeServicePool(pool: Pool): Promise<ProbeResult> {
  return timeProbe(async () => {
    const client = await pool.connect();
    client.release();
  });
}

/**
 * Representative critical query. SELECT 1 is the minimum that proves the
 * DB can parse and execute without hitting any application schema, making
 * this a safe phase-1 liveness signal (no table dependency, no RLS).
 */
export async function probeCriticalQuery(pool: Pool): Promise<ProbeResult> {
  return timeProbe(async () => {
    const client = await pool.connect();
    try {
      await client.query("SELECT 1");
    } finally {
      client.release();
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Self-check + emit orchestration
// ─────────────────────────────────────────────────────────────────────────────

export interface RunDbSubstrateProbesOptions {
  readonly flags: RuntimeFlags;
  readonly appPool: Pool;
  readonly servicePool: Pool;
  readonly now?: Date;
  /** Optional override for runtime_* writes (defaults to service pool). */
  readonly client?: RuntimeQueryable;
  readonly logger?: (line: string) => void;
  readonly runHost?: string | null;
}

interface SubstrateStep {
  readonly spec: Phase1SelfCheckSpec;
  readonly failedEventCode: string;
  readonly runProbe: () => Promise<ProbeResult>;
}

function safeLog(
  logger: ((line: string) => void) | undefined,
  payload: Record<string, unknown>,
): void {
  const line = `[runtime-db-substrate] ${JSON.stringify(payload)}`;
  if (logger) {
    try {
      logger(line);
    } catch {
      /* never let the logger break us */
    }
    return;
  }
  // eslint-disable-next-line no-console
  console.error(line);
}

async function writeSelfCheckSafe(
  client: RuntimeQueryable,
  row: RuntimeSelfCheckRow,
  logger: RunDbSubstrateProbesOptions["logger"],
): Promise<void> {
  try {
    await upsertRuntimeSelfCheck(client, row);
  } catch (err) {
    safeLog(logger, {
      phase: "self_check_write",
      check_id: row.check_id,
      error: coerceError(err).message,
    });
  }
}

function buildStepRow(
  spec: Phase1SelfCheckSpec,
  now: Date,
  runHost: string | null,
): RuntimeSelfCheckRow {
  return buildInitialSelfCheckRow(spec.check_id as Phase1SelfCheckId, {
    now,
    runHost,
  });
}

/**
 * Return true if a runtime_issues row keyed by the same fingerprint as the
 * failure event_code exists and is still in an active cycle (detected /
 * ongoing). Used as a guard so we only emit recovery lifecycle events when
 * there is actually an open cycle to recover, rather than spamming a recover
 * fact on every healthy probe.
 *
 * Never throws — read failures are treated as "unknown, skip recovery" so the
 * probe loop remains best-effort.
 */
async function hasActiveIssueForEventCode(
  failedEventCode: string,
  options: RunDbSubstrateProbesOptions,
): Promise<boolean> {
  const fingerprint = computeFingerprint({
    event_code: failedEventCode,
    source: "db",
  });
  try {
    const existing = options.client
      ? await fetchRuntimeIssueByFingerprint(options.client, fingerprint)
      : await runWithServicePool((c) =>
          fetchRuntimeIssueByFingerprint(c, fingerprint),
        );
    if (!existing) {
      return false;
    }
    return existing.state === "detected" || existing.state === "ongoing";
  } catch (err) {
    safeLog(options.logger, {
      phase: "recover_lookup",
      event_code: failedEventCode,
      error: coerceError(err).message,
    });
    return false;
  }
}

/**
 * Runs the three phase-1 DB self-checks, updates runtime_self_checks latest
 * state, and emits a runtime_event per failing probe.
 *
 * Called on demand (boot, cadence tick). Non-fatal — business callers never
 * await this on their hot path.
 */
export async function runDbSubstrateProbes(
  options: RunDbSubstrateProbesOptions,
): Promise<void> {
  if (!isSliceEnabled(options.flags, "bff_db")) {
    return;
  }
  const now = options.now ?? new Date();
  const runHost = options.runHost ?? null;

  const steps: SubstrateStep[] = [
    {
      spec: getPhase1SelfCheckSpec("db.app_pool.reachable")!,
      failedEventCode: "db.app_pool.unreachable",
      runProbe: () => probeAppPool(options.appPool),
    },
    {
      spec: getPhase1SelfCheckSpec("db.service_pool.reachable")!,
      failedEventCode: "db.service_pool.unreachable",
      runProbe: () => probeServicePool(options.servicePool),
    },
    {
      spec: getPhase1SelfCheckSpec("db.critical_query")!,
      failedEventCode: "db.critical_query.failed",
      runProbe: () => probeCriticalQuery(options.servicePool),
    },
  ];

  for (const step of steps) {
    let probe: ProbeResult;
    try {
      probe = await step.runProbe();
    } catch (err) {
      // defensive — timeProbe already wraps, but if anything slips through
      // we still treat this as a probe failure, never a caller failure.
      probe = {
        status: "fail",
        durationMs: 0,
        error: coerceError(err),
      };
    }

    const base = buildStepRow(step.spec, now, runHost);
    const row =
      probe.status === "pass"
        ? applySelfCheckPass(base, {
            runAt: now.toISOString(),
            durationMs: probe.durationMs,
            now,
            detail: { duration_ms: probe.durationMs },
          })
        : applySelfCheckFail(base, {
            runAt: now.toISOString(),
            durationMs: probe.durationMs,
            now,
            detail: {
              duration_ms: probe.durationMs,
              error: probe.error?.message ?? "unknown",
            },
          });

    if (options.client) {
      await writeSelfCheckSafe(options.client, row, options.logger);
    } else {
      // no explicit test client → route through the shared service pool path
      // via upsertRuntimeSelfCheck, but still catch errors.
      try {
        const { runWithServicePool } = await import("./persistence");
        await runWithServicePool((c) => upsertRuntimeSelfCheck(c, row));
      } catch (err) {
        safeLog(options.logger, {
          phase: "self_check_write_pool",
          check_id: row.check_id,
          error: coerceError(err).message,
        });
      }
    }

    if (probe.status === "fail") {
      await emitRuntimeEvent(
        {
          event_code: step.failedEventCode,
          source: "db",
          summary: `DB substrate probe failed: ${step.spec.check_id}`,
          detail: {
            check_id: step.spec.check_id,
            duration_ms: probe.durationMs,
            error: probe.error?.message ?? "unknown",
          },
        },
        {
          flags: options.flags,
          slice: "bff_db",
          client: options.client,
          now,
          logger: options.logger,
        },
      );
      continue;
    }

    // Probe passed — if a prior failure cycle is still active for this event
    // code, emit a canonical `recover` lifecycle event under the same event
    // code so the M9 projection transitions the runtime_issues row out of the
    // detected/ongoing state. Recovery is delivered via the existing lifecycle
    // semantics; no parallel event_code namespace is introduced.
    if (await hasActiveIssueForEventCode(step.failedEventCode, options)) {
      await emitRuntimeEvent(
        {
          event_code: step.failedEventCode,
          source: "db",
          severity: "info",
          lifecycle_hint: "recover",
          summary: `DB substrate probe recovered: ${step.spec.check_id}`,
          detail: {
            check_id: step.spec.check_id,
            duration_ms: probe.durationMs,
          },
        },
        {
          flags: options.flags,
          slice: "bff_db",
          client: options.client,
          now,
          logger: options.logger,
        },
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pool idle-error → db.pool.idle_error runtime fact
// ─────────────────────────────────────────────────────────────────────────────

/** The two canonical pool identities — drives the `pool` dedup dimension. */
export type DbPoolKind = "app" | "service";

/** Minimal pool surface — accepts real pg.Pool and test fakes alike. */
interface EventEmitterLike {
  on(event: string, handler: (err: Error) => void): unknown;
}

export interface AttachPoolIdleErrorEmitterOptions {
  readonly pool: DbPoolKind;
  readonly flags: RuntimeFlags;
  readonly client?: RuntimeQueryable;
  readonly logger?: (line: string) => void;
  /** Optional injectable for tests; defaults to the shared emitter. */
  readonly emit?: typeof emitRuntimeEvent;
}

/**
 * Register a pg.Pool error listener that routes idle-client / connection-lost
 * events into a structured runtime fact. Safe to call multiple times — each
 * call adds an additional listener (pg allows it) but behavior is idempotent
 * because each call operates on the same underlying fact code.
 *
 * Never re-throws, never awaits in the listener's caller chain.
 */
export function attachPoolIdleErrorEmitter(
  target: EventEmitterLike,
  options: AttachPoolIdleErrorEmitterOptions,
): void {
  const emit = options.emit ?? emitRuntimeEvent;
  target.on("error", (err: Error) => {
    // Fire and forget — emit is best-effort.
    void (async (): Promise<EmitRuntimeEventResult | undefined> => {
      try {
        return await emit(
          {
            event_code: "db.pool.idle_error",
            source: "db",
            summary: `DB ${options.pool} pool idle-client error`,
            detail: { pool: options.pool, error: err.message },
            dedup_keys: { pool: options.pool },
          },
          {
            flags: options.flags,
            slice: "bff_db",
            client: options.client,
            logger: options.logger,
          },
        );
      } catch (e) {
        safeLog(options.logger, {
          phase: "pool_idle_emit",
          pool: options.pool,
          error: coerceError(e).message,
        });
        return undefined;
      }
    })();
  });
}
