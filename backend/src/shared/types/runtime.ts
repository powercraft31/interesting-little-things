// ─────────────────────────────────────────────────────────────────────────────
// Runtime Governance — canonical types (v6.10 M9 shared-layer extension)
//
// This module is the single source of truth for runtime event, issue,
// self-check, and health snapshot shapes. Modules emitting runtime facts
// MUST use these types rather than inventing parallel semantics.
//
// Key design constraints (see design/backend_architecture/09_SHARED_LAYER_v6.10.md
// and design/backend_architecture/10_DATABASE_SCHEMA_v6.10.md):
//   - single mutable runtime_issues row per fingerprint
//   - suppressed ≠ closed
//   - 'disabled' is an API-only overall posture, never persisted
// ─────────────────────────────────────────────────────────────────────────────

export type RuntimeSeverity =
  | "info"
  | "notice"
  | "warning"
  | "degraded"
  | "critical";

export const RUNTIME_SEVERITIES: readonly RuntimeSeverity[] = Object.freeze([
  "info",
  "notice",
  "warning",
  "degraded",
  "critical",
] as const);

export type RuntimeIssueState =
  | "detected"
  | "ongoing"
  | "recovered"
  | "closed"
  | "suppressed";

export const RUNTIME_ISSUE_STATES: readonly RuntimeIssueState[] = Object.freeze([
  "detected",
  "ongoing",
  "recovered",
  "closed",
  "suppressed",
] as const);

export type RuntimeLifecycleHint =
  | "detect"
  | "ongoing"
  | "recover"
  | "close"
  | "suppress";

export const RUNTIME_LIFECYCLE_HINTS: readonly RuntimeLifecycleHint[] =
  Object.freeze(["detect", "ongoing", "recover", "close", "suppress"] as const);

export type RuntimeSelfCheckStatus = "pass" | "fail" | "stale" | "unknown";

export const RUNTIME_SELF_CHECK_STATUSES: readonly RuntimeSelfCheckStatus[] =
  Object.freeze(["pass", "fail", "stale", "unknown"] as const);

export type RuntimePersistedOverall = "ok" | "warning" | "degraded" | "critical";

export const RUNTIME_PERSISTED_OVERALLS: readonly RuntimePersistedOverall[] =
  Object.freeze(["ok", "warning", "degraded", "critical"] as const);

export type RuntimeApiOverall = RuntimePersistedOverall | "disabled";

export type RuntimeSource = string;

export type RuntimeDetailPayload = Record<string, unknown>;

export interface RuntimeEvent {
  readonly event_id: string;
  readonly event_code: string;
  readonly source: RuntimeSource;
  readonly severity: RuntimeSeverity;
  readonly lifecycle_hint: RuntimeLifecycleHint | null;
  readonly occurred_at: string;
  readonly observed_at: string;
  readonly fingerprint: string;
  readonly correlation_id: string | null;
  readonly tenant_scope: string | null;
  readonly summary: string | null;
  readonly detail: RuntimeDetailPayload | null;
}

export interface RuntimeEventInput {
  readonly event_code: string;
  readonly source: RuntimeSource;
  readonly lifecycle_hint?: RuntimeLifecycleHint | null;
  readonly severity?: RuntimeSeverity;
  readonly occurred_at?: string;
  readonly observed_at?: string;
  readonly event_id?: string;
  readonly fingerprint?: string;
  readonly correlation_id?: string | null;
  readonly tenant_scope?: string | null;
  readonly summary?: string | null;
  readonly detail?: RuntimeDetailPayload | null;
  readonly dedup_keys?: Readonly<Record<string, string | number | null | undefined>>;
}

export interface RuntimeIssue {
  readonly fingerprint: string;
  readonly event_code: string;
  readonly source: RuntimeSource;
  readonly tenant_scope: string | null;
  readonly cycle_count: number;
  readonly current_cycle_started_at: string;
  readonly first_detected_at: string;
  readonly last_observed_at: string;
  readonly recovered_at: string | null;
  readonly closed_at: string | null;
  readonly suppressed_until: string | null;
  readonly state: RuntimeIssueState;
  readonly current_severity: RuntimeSeverity;
  readonly observation_count: number;
  readonly summary: string | null;
  readonly latest_detail: RuntimeDetailPayload | null;
  readonly operator_note: string | null;
  readonly operator_actor: string | null;
  readonly updated_at: string;
}

export interface RuntimeSelfCheckRow {
  readonly check_id: string;
  readonly source: RuntimeSource;
  readonly run_host: string | null;
  readonly cadence_seconds: number;
  readonly last_status: RuntimeSelfCheckStatus;
  readonly last_run_at: string | null;
  readonly last_pass_at: string | null;
  readonly last_duration_ms: number | null;
  readonly consecutive_failures: number;
  readonly latest_detail: RuntimeDetailPayload | null;
  readonly updated_at: string;
}

export interface RuntimeHealthSnapshot {
  readonly id: number;
  readonly captured_at: string;
  readonly overall: RuntimePersistedOverall;
  readonly component_states: Readonly<Record<string, RuntimePersistedOverall>>;
  readonly critical_open_count: number;
  readonly self_check_all_pass: boolean;
  readonly snapshot_source: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase-1 mandatory self-check registry IDs — see 09_SHARED_LAYER_v6.10.md §5.3
// ─────────────────────────────────────────────────────────────────────────────

export const PHASE1_SELF_CHECK_IDS = Object.freeze([
  "db.app_pool.reachable",
  "db.service_pool.reachable",
  "db.critical_query",
  "ingest.freshness",
  "dispatch.loop.alive",
  "scheduler.jobs.alive",
  "bff.listen",
] as const);

export type Phase1SelfCheckId = (typeof PHASE1_SELF_CHECK_IDS)[number];

export function isPhase1SelfCheckId(value: string): value is Phase1SelfCheckId {
  return (PHASE1_SELF_CHECK_IDS as readonly string[]).includes(value);
}

// ─────────────────────────────────────────────────────────────────────────────
// Type guards
// ─────────────────────────────────────────────────────────────────────────────

export function isRuntimeSeverity(value: unknown): value is RuntimeSeverity {
  return (
    typeof value === "string" &&
    (RUNTIME_SEVERITIES as readonly string[]).includes(value)
  );
}

export function isRuntimeIssueState(value: unknown): value is RuntimeIssueState {
  return (
    typeof value === "string" &&
    (RUNTIME_ISSUE_STATES as readonly string[]).includes(value)
  );
}

export function isRuntimeLifecycleHint(
  value: unknown,
): value is RuntimeLifecycleHint {
  return (
    typeof value === "string" &&
    (RUNTIME_LIFECYCLE_HINTS as readonly string[]).includes(value)
  );
}

export function isRuntimePersistedOverall(
  value: unknown,
): value is RuntimePersistedOverall {
  return (
    typeof value === "string" &&
    (RUNTIME_PERSISTED_OVERALLS as readonly string[]).includes(value)
  );
}
