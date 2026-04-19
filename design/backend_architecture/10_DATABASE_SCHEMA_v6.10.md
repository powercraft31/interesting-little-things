# Database Schema — v6.10 Runtime Governance Extension

> **Version**: v6.10
> **Parent**: [00_MASTER_ARCHITECTURE_v6.10.md](./00_MASTER_ARCHITECTURE_v6.10.md)
> **Baseline**: [10_DATABASE_SCHEMA_v6.9.md](./10_DATABASE_SCHEMA_v6.9.md)
> **Date**: 2026-04-18
> **Scope**: Additive schema extension for runtime-governance spine

---

## 1. Design Judgment

v6.10 schema work must be additive.

Why:
- runtime governance is a new platform concern
- it should not destabilize existing domain tables
- rollback must reduce to feature disablement, not data surgery

Therefore the schema design uses new `runtime_*` tables and no mutation of existing domain storage.

---

## 2. New Tables

Phase-1 adds four tables:

| Table | Role |
|-------|------|
| `runtime_events` | append-only retained event history |
| `runtime_issues` | mutable active/recovered issue projection |
| `runtime_self_checks` | latest-state self-check read model |
| `runtime_health_snapshots` | periodic derived platform posture |

---

## 3. `runtime_events`

### 3.1 Purpose
Retained raw runtime-fact history for forensic review and cycle history.

### 3.2 Key design points
- append-only
- partitioned by `observed_at` monthly RANGE
- retention target: 90 days
- partition model mirrors existing telemetry partition discipline

### 3.3 Core columns
- `event_id`
- `event_code`
- `source`
- `severity`
- `lifecycle_hint`
- `occurred_at`
- `observed_at`
- `fingerprint`
- `correlation_id`
- `tenant_scope`
- `summary`
- `detail`

### 3.4 Index posture
- `(observed_at DESC)`
- `(fingerprint, observed_at DESC)`
- `(source, observed_at DESC)`
- `(severity, observed_at DESC)`

---

## 4. `runtime_issues`

### 4.1 Identity model
Phase-1 selects **single mutable row per fingerprint**.

This is the critical schema rule.

Implications:
- `fingerprint` is the PK
- reopen updates the same row
- `cycle_count` distinguishes cycles
- cycle history lives in `runtime_events`

### 4.2 Core columns
- `fingerprint` (**PK**)
- `event_code`
- `source`
- `tenant_scope`
- `cycle_count`
- `current_cycle_started_at`
- `first_detected_at`
- `last_observed_at`
- `recovered_at`
- `closed_at`
- `suppressed_until`
- `state`
- `current_severity`
- `observation_count`
- `summary`
- `latest_detail`
- `operator_note`
- `operator_actor`
- `updated_at`

### 4.3 Query posture
Primary hot path is active-query against:
- `state IN ('detected','ongoing','recovered')`
- optional filter by `source`
- optional filter by `tenant_scope`

Recommended indexes:
- `(state, last_observed_at DESC)`
- `(source, state)`
- `(tenant_scope, state)`
- partial active index on active/recent states

---

## 5. `runtime_self_checks`

### 5.1 Purpose
Explicit latest-state read model for self-check status.

This exists because health summary and `/api/runtime/self-checks` should not depend on replaying event history for basic current-state answers.

### 5.2 Core columns
- `check_id` (**PK**)
- `source`
- `run_host`
- `cadence_seconds`
- `last_status`
- `last_run_at`
- `last_pass_at`
- `last_duration_ms`
- `consecutive_failures`
- `latest_detail`
- `updated_at`

### 5.3 Model rule
- one mutable row per check id
- latest-state only
- history belongs in `runtime_events` + `runtime_health_snapshots`, not a second growing per-run table in phase-1

---

## 6. `runtime_health_snapshots`

### 6.1 Purpose
Periodic derived posture history.

### 6.2 Core columns
- `id`
- `captured_at`
- `overall`
- `component_states`
- `critical_open_count`
- `self_check_all_pass`
- `snapshot_source`

### 6.3 Important semantic rule
Persisted `overall` values are limited to:
- `ok`
- `warning`
- `degraded`
- `critical`

`disabled` is **not persisted**. It is API-only when feature flag is off.

---

## 7. RLS and Pooling Posture

Runtime-governance tables are platform-scoped operational tables.

Therefore:
- no RLS policies in phase-1
- service pool is the authoritative access path
- `tenant_scope` is informational, not a security boundary

This is a deliberate exception to domain-table RLS posture and is correct for platform-wide operational truth.

---

## 8. Migration Posture

One idempotent migration file:
- `backend/src/shared/migrations/002_runtime_governance.sql`

Required characteristics:
- `CREATE TABLE IF NOT EXISTS`
- `CREATE INDEX IF NOT EXISTS`
- partition bootstrap for current + near-future event partitions
- safe to apply before feature enablement
- no mutation of existing business tables

---

## 9. Retention and Closure Rules

Phase-1 defaults:
- raw events retention: 90 days
- recovered issue auto-close TTL: 24h
- stale/no-new-observation auto-close: 72h
- health snapshot retention: 30 days

These remain configuration defaults, not business-domain semantics.
