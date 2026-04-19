-- ============================================================
-- Runtime Governance (v6.10) — Migration 002
-- Scope: additive runtime-governance spine for M9 shared layer
-- Tables: runtime_events, runtime_issues, runtime_self_checks,
--         runtime_health_snapshots
-- Idempotent: safe to re-run (CREATE TABLE/INDEX IF NOT EXISTS)
-- Additive: no mutation of existing business/domain tables
-- Feature-flag-safe: apply before enabling RUNTIME_GOVERNANCE_ENABLED
-- Retention defaults (enforced by M9 retention executor, not this DDL):
--   runtime_events            = 90 days
--   recovered auto-close TTL  = 24 hours
--   stale auto-close TTL      = 72 hours
--   runtime_health_snapshots  = 30 days
-- ============================================================

-- ── 1. runtime_events ─────────────────────────────────────────
-- Append-only retained runtime-fact history.
-- Partitioned by RANGE(observed_at) to mirror telemetry partition discipline.
-- PRIMARY KEY must include the partition key (observed_at) to satisfy PG.

CREATE TABLE IF NOT EXISTS runtime_events (
  event_id         UUID        NOT NULL,
  event_code       TEXT        NOT NULL,
  source           TEXT        NOT NULL,
  severity         TEXT        NOT NULL
                     CHECK (severity IN ('info','notice','warning','degraded','critical')),
  lifecycle_hint   TEXT        NULL,
  occurred_at      TIMESTAMPTZ NOT NULL,
  observed_at      TIMESTAMPTZ NOT NULL,
  fingerprint      TEXT        NOT NULL,
  correlation_id   TEXT        NULL,
  tenant_scope     TEXT        NULL,
  summary          TEXT        NULL,
  detail           JSONB       NULL,
  PRIMARY KEY (event_id, observed_at)
) PARTITION BY RANGE (observed_at);

CREATE INDEX IF NOT EXISTS idx_runtime_events_observed_at
  ON runtime_events (observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_runtime_events_fingerprint_observed
  ON runtime_events (fingerprint, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_runtime_events_source_observed
  ON runtime_events (source, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_runtime_events_severity_observed
  ON runtime_events (severity, observed_at DESC);

-- ── 1a. runtime_events partition bootstrap ───────────────────
-- Bootstraps current + next 3 monthly partitions plus a DEFAULT partition.
-- DETACH the default (if present) before adding new ranges to avoid overlap.

DO $runtime_events_partitions$
DECLARE
  month_start    TIMESTAMPTZ := date_trunc('month', CURRENT_DATE);
  range_start    TIMESTAMPTZ;
  range_end      TIMESTAMPTZ;
  partition_name TEXT;
  has_default    BOOLEAN;
  i              INTEGER;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_inherits inh
    JOIN pg_class child  ON child.oid  = inh.inhrelid
    JOIN pg_class parent ON parent.oid = inh.inhparent
    WHERE parent.relname = 'runtime_events'
      AND child.relname  = 'runtime_events_default'
  ) INTO has_default;

  IF has_default THEN
    EXECUTE 'ALTER TABLE runtime_events DETACH PARTITION runtime_events_default';
  END IF;

  FOR i IN 0..3 LOOP
    range_start    := month_start + (i       * INTERVAL '1 month');
    range_end      := month_start + ((i + 1) * INTERVAL '1 month');
    partition_name := format('runtime_events_%s', to_char(range_start, 'YYYYMM'));
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF runtime_events FOR VALUES FROM (%L) TO (%L)',
      partition_name,
      range_start,
      range_end
    );
  END LOOP;

  IF has_default THEN
    EXECUTE 'ALTER TABLE runtime_events ATTACH PARTITION runtime_events_default DEFAULT';
  ELSE
    EXECUTE 'CREATE TABLE IF NOT EXISTS runtime_events_default PARTITION OF runtime_events DEFAULT';
  END IF;
END
$runtime_events_partitions$;


-- ── 2. runtime_issues ────────────────────────────────────────
-- Single mutable row per fingerprint. Reopen increments cycle_count.
-- suppressed ≠ closed: suppressed mutes active-summary but cycle persists.

CREATE TABLE IF NOT EXISTS runtime_issues (
  fingerprint              TEXT        PRIMARY KEY,
  event_code               TEXT        NOT NULL,
  source                   TEXT        NOT NULL,
  tenant_scope             TEXT        NULL,
  cycle_count              INTEGER     NOT NULL DEFAULT 1,
  current_cycle_started_at TIMESTAMPTZ NOT NULL,
  first_detected_at        TIMESTAMPTZ NOT NULL,
  last_observed_at         TIMESTAMPTZ NOT NULL,
  recovered_at             TIMESTAMPTZ NULL,
  closed_at                TIMESTAMPTZ NULL,
  suppressed_until         TIMESTAMPTZ NULL,
  state                    TEXT        NOT NULL
                             CHECK (state IN ('detected','ongoing','recovered','closed','suppressed')),
  current_severity         TEXT        NOT NULL
                             CHECK (current_severity IN ('info','notice','warning','degraded','critical')),
  observation_count        BIGINT      NOT NULL DEFAULT 1,
  summary                  TEXT        NULL,
  latest_detail            JSONB       NULL,
  operator_note            TEXT        NULL,
  operator_actor           TEXT        NULL,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_runtime_issues_state_last_observed
  ON runtime_issues (state, last_observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_runtime_issues_source_state
  ON runtime_issues (source, state);

CREATE INDEX IF NOT EXISTS idx_runtime_issues_tenant_scope_state
  ON runtime_issues (tenant_scope, state);

CREATE INDEX IF NOT EXISTS idx_runtime_issues_active
  ON runtime_issues (last_observed_at DESC)
  WHERE state IN ('detected','ongoing','recovered');


-- ── 3. runtime_self_checks ───────────────────────────────────
-- Latest-state read model only. History lives in runtime_events.

CREATE TABLE IF NOT EXISTS runtime_self_checks (
  check_id             TEXT        PRIMARY KEY,
  source               TEXT        NOT NULL,
  run_host             TEXT        NULL,
  cadence_seconds      INTEGER     NOT NULL,
  last_status          TEXT        NOT NULL
                         CHECK (last_status IN ('pass','fail','stale','unknown')),
  last_run_at          TIMESTAMPTZ NULL,
  last_pass_at         TIMESTAMPTZ NULL,
  last_duration_ms     INTEGER     NULL,
  consecutive_failures INTEGER     NOT NULL DEFAULT 0,
  latest_detail        JSONB       NULL,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ── 4. runtime_health_snapshots ──────────────────────────────
-- Periodic derived posture. 'disabled' is API-only and is NOT persisted.

CREATE TABLE IF NOT EXISTS runtime_health_snapshots (
  id                  BIGSERIAL   PRIMARY KEY,
  captured_at         TIMESTAMPTZ NOT NULL,
  overall             TEXT        NOT NULL
                        CHECK (overall IN ('ok','warning','degraded','critical')),
  component_states    JSONB       NOT NULL,
  critical_open_count INTEGER     NOT NULL DEFAULT 0,
  self_check_all_pass BOOLEAN     NOT NULL DEFAULT false,
  snapshot_source     TEXT        NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_runtime_health_snapshots_captured_at
  ON runtime_health_snapshots (captured_at DESC);


-- ── 5. Pooling posture notes (no RLS in phase-1) ─────────────
-- Runtime-governance tables are platform-scoped operational tables.
-- Service pool is the authoritative access path. No RLS policies defined.
-- tenant_scope columns are informational, NOT security boundaries.
