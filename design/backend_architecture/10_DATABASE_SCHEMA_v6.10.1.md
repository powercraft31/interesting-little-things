# Database Schema — v6.10.1 Storage-Retention Hardening

> **Version**: v6.10.1
> **Parent**: [00_MASTER_ARCHITECTURE_v6.10.1.md](./00_MASTER_ARCHITECTURE_v6.10.1.md)
> **Baseline**: [10_DATABASE_SCHEMA_v6.10.md](./10_DATABASE_SCHEMA_v6.10.md)
> **Date**: 2026-04-19
> **Scope**: Additive schema/lifecycle support for bounded operational storage

---

## 1. Design Judgment

v6.10.1 schema work stays additive for the same reason v6.10 did:
- hardening must not destabilize business paths
- rollback must not require data surgery
- existing v6.10 runtime-governance tables remain valid

Therefore the schema strategy is:
- keep current tables authoritative
- add lifecycle/archive support where needed
- avoid destructive mutation of business-history schema by default

---

## 2. Surface Classification Table

From a schema point of view, the relevant posture is:

| Surface | Current type | v6.10.1 target posture |
|---|---|---|
| `runtime_events` | append-only history | keep time-window-bounded |
| `runtime_health_snapshots` | append-only posture history | keep time-window-bounded |
| `runtime_self_checks` | latest-state | keep mutable/latest-state |
| `runtime_issues` | mutable projection | direct-delete closed rows after secondary window |
| `device_command_logs` | append-heavy operational history | 90-day hot window, then archive |
| `gateway_alarm_events` | append-only operational/domain history | 180-day hot window, then archive |
| `backfill_requests` | queue/state residue | delete terminal rows after 14 days |
| `revenue_daily` | business history | preserve; optional future archive only |

---

## 3. Required Additive Schema Support

### 3.1 No rewrite of v6.10 runtime tables
`runtime_events`, `runtime_health_snapshots`, and `runtime_self_checks` keep their current model.

### 3.2 `runtime_issues` lifecycle support
Committed rule in v6.10.1:
- closed rows are deleted from `runtime_issues` 30 days after `closed_at`
- no archive table is introduced for `runtime_issues`
- event and cycle truth remains authoritative in `runtime_events`
- hot projection usefulness wins over indefinite projection retention

### 3.3 Operational history archive support
v6.10.1 introduces two additive archive tables:
- `device_command_logs_archive`
- `gateway_alarm_events_archive`

Archive-table convention:
- same `public` schema as the hot tables for operator simplicity in phase-1
- archive table columns mirror the hot table columns plus:
  - `archived_at TIMESTAMPTZ NOT NULL`
  - `archive_reason TEXT NOT NULL`
- each archive table keeps the original hot-table primary key value as a preserved source identifier, not a regenerated surrogate-only identity
- write path remains in current hot tables; archive movement happens asynchronously via executor
- archive insert must be idempotent on preserved source identifier

`backfill_requests` does not get an archive table in v6.10.1.

---

## 4. Index / Query Posture

### 4.1 Hot-table priority
Indexes must continue to optimize recent-row queries, not deep historical scans.
That is the entire point of hot-window retention.

### 4.2 Archive-table priority
If archive tables are introduced, they optimize preservation and offline audit readability, not hot-path UI/API latency.

---

## 5. Partitioning Rule

v6.10.1 does **not** require a blanket repartitioning program.

Recommended rule:
- keep existing partitioned `runtime_events` model as-is
- do not force immediate repartitioning of `device_command_logs`, `gateway_alarm_events`, or `backfill_requests` unless sizing evidence later justifies it
- prefer executor-driven retention/archive first because it is narrower and lower-risk

---

## 6. Migration Posture

Expected migration characteristics:
- idempotent
- additive
- safe before feature/executor enablement
- no drops of current business tables
- no destructive data rewrite during migration application

Required migration additions in v6.10.1:
- create `device_command_logs_archive`
- create `gateway_alarm_events_archive`
- add archive indexes on preserved source identifier and `archived_at DESC`
- create any helper indexes needed for executor hot-table eligibility scans

Archive tables must be created before any executor phase that moves rows is enabled.

---

## 7. Explicit Non-Changes

v6.10.1 schema design does **not** by default:
- add TTL directly into PostgreSQL table definitions as magical behavior
- delete `revenue_daily`
- replace current domain tables with runtime-governance tables
- rebuild the broader schema around warehousing patterns

The point is disciplined boundedness, not architectural vanity.
