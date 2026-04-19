# SOLFACIL VPP — Master Architecture Blueprint

> **Version**: v6.10.1
> **Baseline**: v6.10 runtime-governance matrix
> **Date**: 2026-04-19
> **Description**: System master blueprint — storage-retention hardening inserted into the existing v6.10 runtime-governance matrix
> **Core Theme**: storage governance, bounded growth, rollback-safe hardening

---

## 0. Matrix Document Set

| # | Document | Path | Description |
|---|----------|------|-------------|
| 00 | **MASTER_ARCHITECTURE** | `00_MASTER_ARCHITECTURE_v6.10.1.md` | System-level impact map and v6.10.1 hardening deltas |
| M1 | **IOT_HUB_MODULE** | `01_IOT_HUB_MODULE_v6.10.1.md` | `gateway_alarm_events` / `backfill_requests` storage-governance boundary |
| M2 | OPTIMIZATION_ENGINE_MODULE | `02_OPTIMIZATION_ENGINE_MODULE_v6.10.1.md` | No v6.10.1 delta; canonical carry-forward of v6.10 optimization-engine design |
| M3 | DR_DISPATCHER_MODULE | `03_DR_DISPATCHER_MODULE_v6.10.1.md` | No v6.10.1 delta; canonical carry-forward of v6.10 DR dispatcher design |
| M4 | **MARKET_BILLING_MODULE** | `04_MARKET_BILLING_MODULE_v6.10.1.md` | `revenue_daily` storage classification and archival posture |
| M5 | **BFF_MODULE** | `05_BFF_MODULE_v6.10.1.md` | Docker log-cap posture and `device_command_logs` lifecycle boundary |
| M6 | IDENTITY_MODULE | `06_IDENTITY_MODULE_v6.10.1.md` | No v6.10.1 delta; canonical carry-forward of accepted identity/auth contract |
| M7 | OPEN_API_MODULE | `07_OPEN_API_MODULE_v6.10.1.md` | No v6.10.1 delta; canonical carry-forward of external integration surface |
| M8 | ADMIN_CONTROL_MODULE | `08_ADMIN_CONTROL_MODULE_v6.10.1.md` | No v6.10.1 delta; canonical carry-forward of admin/control-plane posture |
| M9 | **SHARED_LAYER** | `09_SHARED_LAYER_v6.10.1.md` | Central storage-governance contract, executors, budgeting model |
| 10 | **DATABASE_SCHEMA** | `10_DATABASE_SCHEMA_v6.10.1.md` | Retention/archive schema additions and storage-policy posture |
| FE | **FRONTEND_ARCHITECTURE** | `../../docs/FRONTEND_ARCHITECTURE_v6.10.1.md` | Explicit no-new-page posture; frontend remains non-center |

Canonical rule for v6.10.1:
- **matrix-aligned design truth lives in the split docs above**
- this is a hardening extension on top of v6.10, not a fresh feature essay

---

## 1. Executive Judgment

v6.10.1 is not another observability release.

v6.10 already gave Solfacil a governed runtime spine.
v6.10.1 hardens the storage consequences of running that system and the adjacent operational history surfaces around it.

The core architectural correction is:

> Solfacil must stop using implicit infinite growth as the default storage policy.

That correction is cross-cutting, but not broad in the wrong way.
It is narrow where risk is highest:
- container stdout/stderr logs
- append-heavy operational tables
- closed-row accumulation in runtime-governance projection storage

---

## 2. System Positioning

v6.10.1 is a **storage-retention hardening release** whose role is:
- preserve the v6.10 runtime-governance spine
- add bounded-growth semantics to uncapped storage surfaces
- classify storage by meaning instead of treating all history as one disposable bucket
- keep rollback behavioral and executor-focused rather than destructive

One-line system definition:

> v6.10.1 makes Solfacil's data growth intentional by capping volatile log surfaces, governing append-heavy operational history, and preserving business history under an explicit policy.

---

## 3. Matrix Impact Map

| Area | v6.10.1 impact | Canonical design doc |
|------|----------------|----------------------|
| M1 IoT Hub | `gateway_alarm_events` and `backfill_requests` receive explicit retention/archive governance | `01_IOT_HUB_MODULE_v6.10.1.md` |
| M2 Optimization Engine | no module-specific storage delta; accepted v6.10 scheduler/runtime-governance posture carried forward unchanged | `02_OPTIMIZATION_ENGINE_MODULE_v6.10.1.md` |
| M3 DR Dispatcher | no module-specific storage delta; accepted v6.10 dispatch/runtime-governance posture carried forward unchanged | `03_DR_DISPATCHER_MODULE_v6.10.1.md` |
| M4 Market Billing | `revenue_daily` explicitly classified as business history, not runtime residue | `04_MARKET_BILLING_MODULE_v6.10.1.md` |
| M5 BFF | container log-cap posture and `device_command_logs` lifecycle clarified | `05_BFF_MODULE_v6.10.1.md` |
| M9 Shared Layer | primary insertion point for storage-governance registry, executor orchestration, budgeting | `09_SHARED_LAYER_v6.10.1.md` |
| DB Schema | additive lifecycle/archival support for operational tables | `10_DATABASE_SCHEMA_v6.10.1.md` |
| Frontend | explicit no-new-surface posture; no dashboard-first drift | `../../docs/FRONTEND_ARCHITECTURE_v6.10.1.md` |

---

## 4. What Remains Unchanged

### 4.1 Runtime-governance semantics remain authoritative
v6.10 rules remain intact:
- `runtime_events` 90-day retention
- `runtime_health_snapshots` 30-day retention
- `runtime_self_checks` latest-state model
- operator runtime routes and admin-only `#runtime` boundary

### 4.2 Existing business/domain boundaries remain intact
v6.10.1 does **not** merge:
- domain alarms into runtime governance
- business history into disposable log cleanup
- frontend pages into a generalized storage dashboard

### 4.3 Rollback posture remains behavioral
Feature disablement / executor disablement must remain sufficient to stop new enforcement behavior.
Data-destructive rollback is not the default operating model.

Concrete rollback knobs in v6.10.1:
- Docker log rotation can be reverted by compose/runtime config only
- the shared storage-retention executor can be disabled without dropping any hot or archive table
- archive tables, if present, remain readable and are never auto-dropped during rollback

---

## 5. New Architectural Rules in v6.10.1

### 5.1 Storage must be classified by meaning
At minimum, the system distinguishes:
- platform/runtime logs
- runtime-governance history/projections
- operational append-only history
- queue/state residue
- business/system-of-record history
- audit evidence

### 5.2 Every high-growth surface needs one honest posture
Every relevant surface must be explicitly one of:
- hard-capped
- time-window-bounded
- archive-bounded
- intentionally indefinite

### 5.3 Auto-close is not deletion
A projection row that changes state but never leaves storage is not a bounded history model.
Design and reporting must say that explicitly.

### 5.4 Business history is not garbage collection collateral
`revenue_daily` and similar records cannot be pushed into a TTL lane merely because they grow.

---

## 6. Design Defaults for v6.10.1

The default architectural choices in this design set are:

1. Docker `json-file` logs remain the driver for all four observed Solfacil containers (`solfacil-bff`, `solfacil-db`, `solfacil-m1`, `solfacil-redis`) with a uniform cap of `max-size: 10m` and `max-file: 5`.
2. `device_command_logs` keeps a 90-day hot window, then archive-first into `device_command_logs_archive`.
3. `gateway_alarm_events` keeps a 180-day hot window, then archive-first into `gateway_alarm_events_archive`.
4. `backfill_requests` keeps active rows indefinitely while terminal rows (`completed`, `failed`) are deleted after 14 days; no archive lane is used.
5. `runtime_issues` closed rows are deleted from the hot projection table 30 days after `closed_at`; no archive lane is used because cycle truth remains in `runtime_events`.
6. `revenue_daily` remains business history in hot storage for v6.10.1; no TTL and no archive move in this release.
7. Enforcement is additive: config + one scheduled shared storage-retention executor extension under M9/shared, not invasive repartitioning of unrelated modules.

---

## 7. Cross-Document Navigation

- M1 operational history retention → `01_IOT_HUB_MODULE_v6.10.1.md`
- M4 business-history classification → `04_MARKET_BILLING_MODULE_v6.10.1.md`
- M5 device-command and log-cap posture → `05_BFF_MODULE_v6.10.1.md`
- central policy/execution model → `09_SHARED_LAYER_v6.10.1.md`
- DDL / index / archive support → `10_DATABASE_SCHEMA_v6.10.1.md`
- frontend non-expansion stance → `../../docs/FRONTEND_ARCHITECTURE_v6.10.1.md`

---

## 8. Acceptance Cut Line for PLAN

The later PLAN must prove:
1. container logs cannot grow without bound under normal daemon operation
2. each append-heavy operational table has a concrete lifecycle executor path
3. `runtime_issues` is no longer falsely described as bounded when rows actually accumulate
4. business-history preservation vs archival is explicit and rollback-safe
5. operator/storage-ceiling reasoning can be derived from documented policy instead of guesswork
