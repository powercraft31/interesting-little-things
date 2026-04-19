import {
  PHASE1_SELF_CHECK_IDS,
  type Phase1SelfCheckId,
  type RuntimeDetailPayload,
  type RuntimeSelfCheckRow,
} from "../types/runtime";

// ─────────────────────────────────────────────────────────────────────────────
// Phase-1 self-check registry (v6.10 M9 shared-layer spine)
//
// Binds the mandatory phase-1 check ids (defined in types/runtime.ts) to their
// authoritative source family and default cadence. Callers that maintain the
// runtime_self_checks latest-state read model MUST only write rows for ids
// present here; new checks are a registry change, not an ad-hoc insert.
// ─────────────────────────────────────────────────────────────────────────────

export interface Phase1SelfCheckSpec {
  readonly check_id: Phase1SelfCheckId;
  readonly source: string;
  readonly defaultCadenceSeconds: number;
}

function spec(s: Phase1SelfCheckSpec): Phase1SelfCheckSpec {
  return Object.freeze({ ...s });
}

export const PHASE1_SELF_CHECK_REGISTRY: readonly Phase1SelfCheckSpec[] = Object.freeze([
  spec({ check_id: "db.app_pool.reachable", source: "db", defaultCadenceSeconds: 30 }),
  spec({ check_id: "db.service_pool.reachable", source: "db", defaultCadenceSeconds: 30 }),
  spec({ check_id: "db.critical_query", source: "db", defaultCadenceSeconds: 60 }),
  spec({ check_id: "ingest.freshness", source: "m1.ingest", defaultCadenceSeconds: 60 }),
  spec({ check_id: "dispatch.loop.alive", source: "m3.dispatch", defaultCadenceSeconds: 30 }),
  spec({ check_id: "scheduler.jobs.alive", source: "m2.scheduler", defaultCadenceSeconds: 60 }),
  spec({ check_id: "bff.listen", source: "bff", defaultCadenceSeconds: 30 }),
]);

const REGISTRY_INDEX: ReadonlyMap<string, Phase1SelfCheckSpec> = new Map(
  PHASE1_SELF_CHECK_REGISTRY.map((s) => [s.check_id, s]),
);

export function getPhase1SelfCheckSpec(
  check_id: string,
): Phase1SelfCheckSpec | undefined {
  return REGISTRY_INDEX.get(check_id);
}

export function isPhase1RegistryComplete(
  registry: readonly Phase1SelfCheckSpec[],
): boolean {
  const seen = new Set(registry.map((s) => s.check_id));
  for (const id of PHASE1_SELF_CHECK_IDS) {
    if (!seen.has(id)) {
      return false;
    }
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Latest-state helpers — pass / fail / stale
//
// The runtime_self_checks table stores one row per check_id. Pass/fail updates
// keep cycle identity on that row; `stale` flips status without recording a
// new run (the cadence watchdog, not the check itself, decides staleness).
// ─────────────────────────────────────────────────────────────────────────────

export interface BuildInitialSelfCheckRowOptions {
  readonly now: Date;
  readonly runHost?: string | null;
  readonly cadenceSeconds?: number;
}

export function buildInitialSelfCheckRow(
  check_id: Phase1SelfCheckId,
  options: BuildInitialSelfCheckRowOptions,
): RuntimeSelfCheckRow {
  const registered = REGISTRY_INDEX.get(check_id);
  if (!registered) {
    throw new Error(
      `runtime-self-check: unknown check_id "${check_id}". Register it in PHASE1_SELF_CHECK_REGISTRY before building a row.`,
    );
  }
  const updated_at = options.now.toISOString();
  return {
    check_id: registered.check_id,
    source: registered.source,
    run_host: options.runHost ?? null,
    cadence_seconds: options.cadenceSeconds ?? registered.defaultCadenceSeconds,
    last_status: "unknown",
    last_run_at: null,
    last_pass_at: null,
    last_duration_ms: null,
    consecutive_failures: 0,
    latest_detail: null,
    updated_at,
  };
}

export interface SelfCheckRunInput {
  readonly runAt: string;
  readonly durationMs: number;
  readonly now: Date;
  readonly detail?: RuntimeDetailPayload | null;
}

export function applySelfCheckPass(
  existing: RuntimeSelfCheckRow,
  input: SelfCheckRunInput,
): RuntimeSelfCheckRow {
  return {
    ...existing,
    last_status: "pass",
    last_run_at: input.runAt,
    last_pass_at: input.runAt,
    last_duration_ms: input.durationMs,
    consecutive_failures: 0,
    latest_detail: input.detail ?? null,
    updated_at: input.now.toISOString(),
  };
}

export function applySelfCheckFail(
  existing: RuntimeSelfCheckRow,
  input: SelfCheckRunInput,
): RuntimeSelfCheckRow {
  return {
    ...existing,
    last_status: "fail",
    last_run_at: input.runAt,
    // last_pass_at is preserved — a failure does not erase the last good time.
    last_duration_ms: input.durationMs,
    consecutive_failures: existing.consecutive_failures + 1,
    latest_detail: input.detail ?? null,
    updated_at: input.now.toISOString(),
  };
}

export interface SelfCheckStaleInput {
  readonly now: Date;
  readonly detail?: RuntimeDetailPayload | null;
}

export function applySelfCheckStale(
  existing: RuntimeSelfCheckRow,
  input: SelfCheckStaleInput,
): RuntimeSelfCheckRow {
  // Stale means the cadence watchdog noticed a missing run.
  // We do NOT synthesize a new run_at; we only flip status and updated_at,
  // and surface detail for operator visibility.
  return {
    ...existing,
    last_status: "stale",
    latest_detail: input.detail ?? existing.latest_detail,
    updated_at: input.now.toISOString(),
  };
}
