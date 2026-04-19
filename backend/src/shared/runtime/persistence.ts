import { getServicePool } from "../db";
import type { NormalizedRuntimeEvent } from "./contract";
import type {
  RuntimeEvent,
  RuntimeHealthSnapshot,
  RuntimeIssue,
  RuntimeIssueState,
  RuntimeLifecycleHint,
  RuntimeSelfCheckRow,
  RuntimeSelfCheckStatus,
  RuntimeSeverity,
} from "../types/runtime";

// ─────────────────────────────────────────────────────────────────────────────
// Persistence layer for runtime_* tables.
//
// Routing rule (see 10_DATABASE_SCHEMA_v6.10.md §7): runtime_* tables are
// platform-scoped. All reads and writes go through the service pool.
//
// For testability we accept a RuntimeQueryable (pg.Pool, pg.PoolClient, or a
// stub). runWithServicePool() is the default execution surface for modules.
// ─────────────────────────────────────────────────────────────────────────────

export interface QueryResult<R> {
  readonly rows: readonly R[];
}

export interface RuntimeQueryable {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<R>>;
}

export async function runWithServicePool<T>(
  fn: (client: RuntimeQueryable) => Promise<T>,
): Promise<T> {
  const pool = getServicePool();
  return fn(pool as unknown as RuntimeQueryable);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function toIsoOrNull(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}

function toIso(value: unknown): string {
  const iso = toIsoOrNull(value);
  if (iso === null) {
    throw new Error("runtime-persistence: expected timestamp, got null");
  }
  return iso;
}

function toJsonbParam(value: Record<string, unknown> | null): string | null {
  return value === null ? null : JSON.stringify(value);
}

function asNumber(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}

// ─────────────────────────────────────────────────────────────────────────────
// runtime_events — append-only
// ─────────────────────────────────────────────────────────────────────────────

const INSERT_RUNTIME_EVENT_SQL = `
  INSERT INTO runtime_events (
    event_id, event_code, source, severity, lifecycle_hint,
    occurred_at, observed_at, fingerprint, correlation_id,
    tenant_scope, summary, detail
  )
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
`;

export async function insertRuntimeEvent(
  client: RuntimeQueryable,
  event: NormalizedRuntimeEvent,
): Promise<void> {
  await client.query(INSERT_RUNTIME_EVENT_SQL, [
    event.event_id,
    event.event_code,
    event.source,
    event.severity,
    event.lifecycle_hint,
    event.occurred_at,
    event.observed_at,
    event.fingerprint,
    event.correlation_id,
    event.tenant_scope,
    event.summary,
    toJsonbParam(event.detail),
  ]);
}

const SELECT_RUNTIME_EVENT_COLUMNS = `
  event_id, event_code, source, severity, lifecycle_hint,
  occurred_at, observed_at, fingerprint, correlation_id,
  tenant_scope, summary, detail
`;

function mapRuntimeEventRow(row: Record<string, unknown>): RuntimeEvent {
  return {
    event_id: String(row.event_id),
    event_code: String(row.event_code),
    source: String(row.source),
    severity: row.severity as RuntimeSeverity,
    lifecycle_hint:
      row.lifecycle_hint === null || row.lifecycle_hint === undefined
        ? null
        : (row.lifecycle_hint as RuntimeLifecycleHint),
    occurred_at: toIso(row.occurred_at),
    observed_at: toIso(row.observed_at),
    fingerprint: String(row.fingerprint),
    correlation_id:
      row.correlation_id === null ? null : String(row.correlation_id),
    tenant_scope:
      row.tenant_scope === null ? null : String(row.tenant_scope),
    summary: row.summary === null ? null : String(row.summary),
    detail: (row.detail as Record<string, unknown> | null) ?? null,
  };
}

export async function fetchRecentRuntimeEvents(
  client: RuntimeQueryable,
  limit: number,
): Promise<readonly RuntimeEvent[]> {
  const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
  const { rows } = await client.query(
    `SELECT ${SELECT_RUNTIME_EVENT_COLUMNS}
     FROM runtime_events
     ORDER BY observed_at DESC, event_id DESC
     LIMIT $1`,
    [safeLimit],
  );
  return rows.map((r) => mapRuntimeEventRow(r as Record<string, unknown>));
}

export async function fetchRecentRuntimeEventsByFingerprint(
  client: RuntimeQueryable,
  fingerprint: string,
  limit: number,
): Promise<readonly RuntimeEvent[]> {
  const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
  const { rows } = await client.query(
    `SELECT ${SELECT_RUNTIME_EVENT_COLUMNS}
     FROM runtime_events
     WHERE fingerprint = $1
     ORDER BY observed_at DESC, event_id DESC
     LIMIT $2`,
    [fingerprint, safeLimit],
  );
  return rows.map((r) => mapRuntimeEventRow(r as Record<string, unknown>));
}

// ─────────────────────────────────────────────────────────────────────────────
// runtime_issues — single mutable row per fingerprint
// ─────────────────────────────────────────────────────────────────────────────

const UPSERT_RUNTIME_ISSUE_SQL = `
  INSERT INTO runtime_issues (
    fingerprint, event_code, source, tenant_scope,
    cycle_count, current_cycle_started_at, first_detected_at,
    last_observed_at, recovered_at, closed_at, suppressed_until,
    state, current_severity, observation_count,
    summary, latest_detail, operator_note, operator_actor, updated_at
  )
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
  ON CONFLICT (fingerprint) DO UPDATE SET
    cycle_count              = EXCLUDED.cycle_count,
    current_cycle_started_at = EXCLUDED.current_cycle_started_at,
    last_observed_at         = EXCLUDED.last_observed_at,
    recovered_at             = EXCLUDED.recovered_at,
    closed_at                = EXCLUDED.closed_at,
    suppressed_until         = EXCLUDED.suppressed_until,
    state                    = EXCLUDED.state,
    current_severity         = EXCLUDED.current_severity,
    observation_count        = EXCLUDED.observation_count,
    summary                  = EXCLUDED.summary,
    latest_detail            = EXCLUDED.latest_detail,
    operator_note            = EXCLUDED.operator_note,
    operator_actor           = EXCLUDED.operator_actor,
    updated_at               = EXCLUDED.updated_at
`;

export async function upsertRuntimeIssue(
  client: RuntimeQueryable,
  issue: RuntimeIssue,
): Promise<void> {
  await client.query(UPSERT_RUNTIME_ISSUE_SQL, [
    issue.fingerprint,
    issue.event_code,
    issue.source,
    issue.tenant_scope,
    issue.cycle_count,
    issue.current_cycle_started_at,
    issue.first_detected_at,
    issue.last_observed_at,
    issue.recovered_at,
    issue.closed_at,
    issue.suppressed_until,
    issue.state,
    issue.current_severity,
    issue.observation_count,
    issue.summary,
    toJsonbParam(issue.latest_detail),
    issue.operator_note,
    issue.operator_actor,
    issue.updated_at,
  ]);
}

const SELECT_RUNTIME_ISSUE_COLUMNS = `
  fingerprint, event_code, source, tenant_scope,
  cycle_count, current_cycle_started_at, first_detected_at,
  last_observed_at, recovered_at, closed_at, suppressed_until,
  state, current_severity, observation_count,
  summary, latest_detail, operator_note, operator_actor, updated_at
`;

function mapRuntimeIssueRow(row: Record<string, unknown>): RuntimeIssue {
  return {
    fingerprint: String(row.fingerprint),
    event_code: String(row.event_code),
    source: String(row.source),
    tenant_scope: row.tenant_scope === null ? null : String(row.tenant_scope),
    cycle_count: asNumber(row.cycle_count),
    current_cycle_started_at: toIso(row.current_cycle_started_at),
    first_detected_at: toIso(row.first_detected_at),
    last_observed_at: toIso(row.last_observed_at),
    recovered_at: toIsoOrNull(row.recovered_at),
    closed_at: toIsoOrNull(row.closed_at),
    suppressed_until: toIsoOrNull(row.suppressed_until),
    state: row.state as RuntimeIssueState,
    current_severity: row.current_severity as RuntimeSeverity,
    observation_count: asNumber(row.observation_count),
    summary: row.summary === null ? null : String(row.summary),
    latest_detail: (row.latest_detail as Record<string, unknown> | null) ?? null,
    operator_note: row.operator_note === null ? null : String(row.operator_note),
    operator_actor:
      row.operator_actor === null ? null : String(row.operator_actor),
    updated_at: toIso(row.updated_at),
  };
}

export async function fetchRuntimeIssueByFingerprint(
  client: RuntimeQueryable,
  fingerprint: string,
): Promise<RuntimeIssue | null> {
  const { rows } = await client.query(
    `SELECT ${SELECT_RUNTIME_ISSUE_COLUMNS} FROM runtime_issues WHERE fingerprint = $1 LIMIT 1`,
    [fingerprint],
  );
  if (rows.length === 0) {
    return null;
  }
  return mapRuntimeIssueRow(rows[0] as Record<string, unknown>);
}

export async function fetchActiveRuntimeIssues(
  client: RuntimeQueryable,
): Promise<readonly RuntimeIssue[]> {
  const { rows } = await client.query(
    `SELECT ${SELECT_RUNTIME_ISSUE_COLUMNS}
     FROM runtime_issues
     WHERE state IN ('detected','ongoing','recovered')
     ORDER BY last_observed_at DESC`,
  );
  return rows.map((r) => mapRuntimeIssueRow(r as Record<string, unknown>));
}

// ─────────────────────────────────────────────────────────────────────────────
// runtime_self_checks — latest-state read model
// ─────────────────────────────────────────────────────────────────────────────

const UPSERT_SELF_CHECK_SQL = `
  INSERT INTO runtime_self_checks (
    check_id, source, run_host, cadence_seconds,
    last_status, last_run_at, last_pass_at, last_duration_ms,
    consecutive_failures, latest_detail, updated_at
  )
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
  ON CONFLICT (check_id) DO UPDATE SET
    source               = EXCLUDED.source,
    run_host             = EXCLUDED.run_host,
    cadence_seconds      = EXCLUDED.cadence_seconds,
    last_status          = EXCLUDED.last_status,
    last_run_at          = EXCLUDED.last_run_at,
    last_pass_at         = EXCLUDED.last_pass_at,
    last_duration_ms     = EXCLUDED.last_duration_ms,
    consecutive_failures = EXCLUDED.consecutive_failures,
    latest_detail        = EXCLUDED.latest_detail,
    updated_at           = EXCLUDED.updated_at
`;

export async function upsertRuntimeSelfCheck(
  client: RuntimeQueryable,
  row: RuntimeSelfCheckRow,
): Promise<void> {
  await client.query(UPSERT_SELF_CHECK_SQL, [
    row.check_id,
    row.source,
    row.run_host,
    row.cadence_seconds,
    row.last_status,
    row.last_run_at,
    row.last_pass_at,
    row.last_duration_ms,
    row.consecutive_failures,
    toJsonbParam(row.latest_detail),
    row.updated_at,
  ]);
}

function mapSelfCheckRow(row: Record<string, unknown>): RuntimeSelfCheckRow {
  return {
    check_id: String(row.check_id),
    source: String(row.source),
    run_host: row.run_host === null ? null : String(row.run_host),
    cadence_seconds: asNumber(row.cadence_seconds),
    last_status: row.last_status as RuntimeSelfCheckStatus,
    last_run_at: toIsoOrNull(row.last_run_at),
    last_pass_at: toIsoOrNull(row.last_pass_at),
    last_duration_ms:
      row.last_duration_ms === null || row.last_duration_ms === undefined
        ? null
        : asNumber(row.last_duration_ms),
    consecutive_failures: asNumber(row.consecutive_failures),
    latest_detail: (row.latest_detail as Record<string, unknown> | null) ?? null,
    updated_at: toIso(row.updated_at),
  };
}

export async function fetchLatestSelfChecks(
  client: RuntimeQueryable,
): Promise<readonly RuntimeSelfCheckRow[]> {
  const { rows } = await client.query(
    `SELECT check_id, source, run_host, cadence_seconds,
            last_status, last_run_at, last_pass_at, last_duration_ms,
            consecutive_failures, latest_detail, updated_at
     FROM runtime_self_checks
     ORDER BY check_id ASC`,
  );
  return rows.map((r) => mapSelfCheckRow(r as Record<string, unknown>));
}

// ─────────────────────────────────────────────────────────────────────────────
// runtime_health_snapshots — 'disabled' is never persisted (enforced by type)
// ─────────────────────────────────────────────────────────────────────────────

const INSERT_HEALTH_SNAPSHOT_SQL = `
  INSERT INTO runtime_health_snapshots (
    captured_at, overall, component_states,
    critical_open_count, self_check_all_pass, snapshot_source
  )
  VALUES ($1, $2, $3::jsonb, $4, $5, $6)
  RETURNING id
`;

export async function insertRuntimeHealthSnapshot(
  client: RuntimeQueryable,
  input: Omit<RuntimeHealthSnapshot, "id">,
): Promise<number> {
  const { rows } = await client.query<{ id: number | string }>(
    INSERT_HEALTH_SNAPSHOT_SQL,
    [
      input.captured_at,
      input.overall,
      JSON.stringify(input.component_states),
      input.critical_open_count,
      input.self_check_all_pass,
      input.snapshot_source,
    ],
  );
  if (rows.length === 0) {
    throw new Error("runtime-persistence: INSERT ... RETURNING id returned no rows");
  }
  return asNumber(rows[0].id);
}
