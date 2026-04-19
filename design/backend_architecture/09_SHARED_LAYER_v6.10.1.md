# 09 Shared Layer Architecture — v6.10.1 Storage-Retention Hardening

> **Version**: v6.10.1
> **Parent**: [00_MASTER_ARCHITECTURE_v6.10.1.md](./00_MASTER_ARCHITECTURE_v6.10.1.md)
> **Baseline**: [09_SHARED_LAYER_v6.10.md](./09_SHARED_LAYER_v6.10.md)
> **Date**: 2026-04-19
> **Scope**: Central storage-governance contract, executor orchestration, and budgeting model

---

## 1. Core Judgment

v6.10 made M9 the runtime-governance spine.
v6.10.1 extends that shared-layer responsibility one level outward:

> M9 becomes the place where storage lifecycle meaning is normalized for non-business operational history.

This does **not** mean M9 owns all data.
It means M9 owns the cross-cutting policy model and execution contract for bounded-growth operational storage.

---

## 2. Storage Governance Registry

### 2.1 New shared-layer concept
v6.10.1 introduces a shared storage-governance registry implemented as a **checked-in TypeScript policy constant under M9/shared runtime**, mirrored into docs for review. It describes each governed surface with at least:
- storage class
- owning module
- hot-storage posture
- archive posture
- retention cutoff rule
- executor path
- rollback behavior

### 2.2 Canonical classes
The registry must distinguish at minimum:
- `volatile_runtime_log`
- `runtime_governance_history`
- `runtime_governance_projection`
- `operational_history`
- `queue_residue`
- `business_history`
- `audit_archive`

This classification is the center of the design. Without it, cleanup code degenerates into scattered table-specific folklore.

---

## 3. Enforcement Model

### 3.1 Executor split
v6.10.1 uses two enforcement lanes:

1. **Container runtime lane**
   - hard-cap volatile Docker logs through compose/runtime config
   - not executed by SQL job

2. **Database lifecycle lane**
   - one **hourly shared storage-retention executor** implemented by extending the existing v6.10 runtime-retention job under M9/shared runtime
   - runtime phases remain first-class and unchanged; v6.10.1 adds operational archive/delete phases after them
   - phase order is: runtime retention → runtime issue closed-row cleanup → device command archive → gateway alarm archive → backfill terminal cleanup

### 3.2 Shared-layer rule
M9 owns the orchestration contract for database lifecycle execution even when the actual rows belong to M1/M5/M4 surfaces.

That keeps lifecycle logic centralized while preserving table ownership semantics.

### 3.3 Failure handling rule
- each executor phase commits independently and reports its own counts/errors
- a failure in one phase does not block later phases in the same run
- archive-first phases must insert into archive before deleting from the hot table
- partial failure after archive insert but before hot delete is tolerated as duplicate-preserving, never destructive; reruns must be idempotent on archive identity keys
- executor failure must emit a runtime-governance issue/event (for example `storage.retention.executor.failed`) so the governance spine reports its own housekeeping failure honestly

---

## 4. Runtime-Governance Extension Rule

v6.10 runtime-governance retention remains intact:
- `runtime_events` 90 days
- `runtime_health_snapshots` 30 days
- `runtime_self_checks` latest-state

v6.10.1 adds one missing honesty rule:
- `runtime_issues` must no longer be described as bounded merely because rows auto-close

Committed rule:
- closed `runtime_issues` rows are **direct-deleted 30 days after `closed_at`**
- active, ongoing, recovered, and suppressed rows remain in the hot projection table
- no archive table is introduced for `runtime_issues` in v6.10.1 because cycle/event truth remains in `runtime_events`

---

## 5. Capacity Budgeting Model

### 5.1 Shared-layer output requirement
M9 defines one budgeting model per governed surface containing:
- current size
- estimated growth unit (`rows/day` or `MB/day`)
- retained hot-window rule
- archive rule if any
- resulting steady-state hot footprint estimate

### 5.2 Canonical policy and budgeting matrix

| Surface | Storage class | Live size | Growth driver | Hot-window rule | Post-window path | Executor |
|---|---|---:|---|---|---|---|
| Docker container logs (`solfacil-bff`, `solfacil-db`, `solfacil-m1`, `solfacil-redis`) | `volatile_runtime_log` | bounded by config, not DB | stdout/stderr volume | immediate cap via `10m × 5 files × 4 containers ≈ 200 MB` upper bound | rotate in place | compose/runtime config |
| `runtime_events` | `runtime_governance_history` | live-volume dependent | runtime event rate | 90 days | direct delete | shared storage-retention executor / runtime phase |
| `runtime_health_snapshots` | `runtime_governance_history` | live-volume dependent | snapshot cadence | 30 days | direct delete | shared storage-retention executor / runtime phase |
| `runtime_issues` (closed rows only) | `runtime_governance_projection` | 128 KB current table size at zero live rows | distinct fingerprint cycles | 30 days after `closed_at` | direct delete | shared storage-retention executor / runtime issue cleanup phase |
| `device_command_logs` | `operational_history` | 4.23 MB | command issuance/reply volume | 90 days hot | archive to `device_command_logs_archive`, then delete hot row | shared storage-retention executor / device-command phase |
| `gateway_alarm_events` | `operational_history` | 272 KB | device/gateway alarm event volume | 180 days hot | archive to `gateway_alarm_events_archive`, then delete hot row | shared storage-retention executor / gateway-alarm phase |
| `backfill_requests` terminal rows | `queue_residue` | 48 KB | gap-recovery queue churn | 14 days after terminal timestamp | direct delete | shared storage-retention executor / backfill phase |
| `revenue_daily` | `business_history` | 56 KB | asset-days billed | no TTL in v6.10.1 | preserve in hot storage | none in this release |

### 5.3 Why this belongs in M9
Without a shared budgeting model:
- M1, M5, and M4 will each describe retention differently
- operators cannot explain the storage ceiling coherently
- PLAN cannot produce a meaningful acceptance matrix

---

## 6. Archive vs Delete Decision Rule

v6.10.1 uses a committed shared rule:
- **delete** short-lived queue/control residue when its long-term value is negligible (`backfill_requests`, closed `runtime_issues`)
- **archive** operational history when older rows may still matter for audit or forensic review (`device_command_logs`, `gateway_alarm_events`)
- **preserve** business history unless an explicit archival design is approved (`revenue_daily`)

This rule is not philosophical fluff; it is what prevents category mistakes like deleting finance history under the same policy as timeout residue.

---

## 7. Rollback Discipline

Rollback must remain behavioral and reversible:
- stopping new lifecycle execution must be possible without table drops
- existing data must not be silently destroyed merely because enforcement is disabled
- archive tables/lanes, if introduced, must be additive and readable
- container log rotation rollback should be configuration-only, not code-coupled

---

## 8. Non-Goals

v6.10.1 shared-layer hardening does **not**:
- turn M9 into a warehouse platform
- centralize business semantics away from module owners
- introduce a universal one-number TTL policy
- require new frontend surfaces to justify backend policy correctness
