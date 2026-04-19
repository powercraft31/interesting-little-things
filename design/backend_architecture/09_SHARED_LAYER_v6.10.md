# 09 Shared Layer Architecture — Runtime Governance Extension

> **Version**: v6.10
> **Parent**: [00_MASTER_ARCHITECTURE_v6.10.md](./00_MASTER_ARCHITECTURE_v6.10.md)
> **Baseline**: [09_SHARED_LAYER_v6.9.md](./09_SHARED_LAYER_v6.9.md)
> **Date**: 2026-04-18
> **Scope**: Runtime-governance spine inserted into M9 as the cross-cutting operational contract layer

---

## 1. Core Judgment

M9 is the only correct place for the v6.10 spine.

Reason:
- every runtime-critical module already depends on M9
- M9 already owns cross-cutting types, middleware, pools, and migrations
- placing runtime governance in M5 or a new standalone module would fracture semantics again

So v6.10 extends M9 with a new sub-package rather than inventing M10.5 as a second brain.

---

## 2. New File Inventory

| File / path | Role |
|-------------|------|
| `types/runtime.ts` | canonical runtime event / issue / lifecycle / self-check types |
| `runtime/contract.ts` | closed event-code registry + dedup dimension registry |
| `runtime/emit.ts` | feature-flag-gated best-effort emitter API |
| `runtime/projection.ts` | issue lifecycle and fingerprint projection rules |
| `runtime/persistence.ts` | writes runtime rows via service pool |
| `runtime/self-check.ts` | self-check registry + execution helpers |
| `runtime/health.ts` | health summary derivation logic |
| `migrations/002_runtime_governance.sql` | DDL for `runtime_*` tables |

---

## 3. Canonical Shared-Layer Contract

### 3.1 Event contract

The runtime-governance spine standardizes these fields:
- `event_id`
- `event_code`
- `source`
- `severity`
- `lifecycle_hint`
- `occurred_at`
- `observed_at`
- `fingerprint`
- `correlation_id?`
- `tenant_scope`
- `summary`
- `detail`

### 3.2 Severity taxonomy

Closed phase-1 scale:
- `info`
- `notice`
- `warning`
- `degraded`
- `critical`

### 3.3 Lifecycle model

Closed phase-1 issue states:
- `detected`
- `ongoing`
- `recovered`
- `closed`
- `suppressed`

Critical clarification:
- `suppressed` is not a second kind of closure
- `closed` means the current cycle is finished
- `suppressed` means the cycle still exists but is intentionally muted from active-summary posture

### 3.4 Projection identity model

Phase-1 explicitly chooses:

> **one mutable issue row per fingerprint**

Meaning:
- `runtime_issues` row identity is `fingerprint`
- reopen does not create a second issue id
- reopen increments `cycle_count` and starts a new cycle on the same row
- historical evidence remains in `runtime_events`

This is the correct phase-1 tradeoff because it keeps operator contract stable and avoids premature issue genealogy complexity.

---

## 4. Emitter API Rules

### 4.1 `emit(...)`

Shared-layer emitter contract:
- synchronous call site
- asynchronous / buffered persistence
- feature-flag-gated
- no throw to caller
- bounded queue / ring buffer
- fallback to stdout only as last-resort degradation path

### 4.2 Governance ownership rule

Emitters may declare facts.
Emitters may not become authorities on:
- lifecycle transitions
- dedup semantics
- severity normalization
- retention policy
- active-issue projection

Those remain spine-owned in M9.

---

## 5. Self-Check Registry

### 5.1 Why it exists

Quiet systems are not automatically healthy systems.
Self-checks solve the "absence of bad signals ≠ proof of health" problem.

### 5.2 Phase-1 read-model decision

Self-check latest state is **stored explicitly**, not reconstructed ad hoc from event history.

That means M9 owns both:
- self-check execution semantics
- self-check latest-state read model contract

### 5.3 Mandatory phase-1 check set

| check_id | source | purpose |
|----------|--------|---------|
| `db.app_pool.reachable` | `db` | app pool probe |
| `db.service_pool.reachable` | `db` | service pool probe |
| `db.critical_query` | `db` | representative critical read |
| `ingest.freshness` | `m1.ingest` | stale data detection |
| `dispatch.loop.alive` | `m3.dispatch` | heartbeat/liveness |
| `scheduler.jobs.alive` | `scheduler` | cron heartbeat coverage |
| `bff.listen` | `bff` | BFF reflective liveness |

Redis note:
- `redis.*` namespace may be reserved in the registry
- Redis is **not** part of the fixed phase-1 summary component set unless confirmed as a governed runtime dependency in a later release

---

## 6. Health Derivation Rules

M9 derives platform health from:
1. active `runtime_issues`
2. latest `runtime_self_checks`
3. `runtime_health_snapshots`

Top-level API posture may return `overall="disabled"` only when the feature flag is off.
This value is:
- API-only
- not a component state
- not part of severity taxonomy
- not persisted in snapshot history

---

## 7. Cross-Module Boundaries

M9 must preserve the separation between:
- platform runtime governance
- domain alarms / fleet business visibility
- strategy/business governance surfaces

Therefore M9 runtime spine must not read/write:
- `gateway_alarm_events`
- P5 strategy tables
- P6 alert projection tables

Correlation, if added later, must be read-side only.

---

## 8. Non-Goals

M9 v6.10 extension is not:
- external observability platform adoption
- generalized metrics system
- tracing stack rollout
- cross-code root-cause inference engine
- universal eventification of every existing log line

It is a bounded governance spine.
