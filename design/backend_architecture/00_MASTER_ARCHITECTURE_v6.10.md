# SOLFACIL VPP — Master Architecture Blueprint

> **Version**: v6.10
> **Baseline**: v6.9 normalized matrix + v6.10 runtime-governance spine
> **Date**: 2026-04-18
> **Description**: System master blueprint — runtime governance skeleton inserted into existing matrix architecture
> **Core Theme**: internal-ops-first, narrow-but-deep, backend-contract-first runtime governance

---

## Document Index

| # | Document | Path | Description |
|---|----------|------|-------------|
| 00 | **MASTER_ARCHITECTURE** | `00_MASTER_ARCHITECTURE_v6.10.md` | System-level impact map and v6.10 matrix deltas |
| M1 | **IOT_HUB_MODULE** | `01_IOT_HUB_MODULE_v6.10.md` | Ingest freshness / parser-failure / backlog emitter boundary |
| M2 | **OPTIMIZATION_ENGINE_MODULE** | `02_OPTIMIZATION_ENGINE_MODULE_v6.10.md` | Optimization-owned scheduler heartbeat / error emitter boundary |
| M3 | **DR_DISPATCHER_MODULE** | `03_DR_DISPATCHER_MODULE_v6.10.md` | Dispatch-loop heartbeat / ack-stall runtime facts |
| M4 | **MARKET_BILLING_MODULE** | `04_MARKET_BILLING_MODULE_v6.10.md` | Billing-job heartbeat / error emitter boundary |
| M5 | **BFF_MODULE** | `05_BFF_MODULE_v6.10.md` | `/api/runtime/*` contract, minimal `#runtime` operator surface, BFF emitters |
| M6 | IDENTITY_MODULE | `06_IDENTITY_MODULE_v6.9.md` | No standalone v6.10 delta; inherits normalized v6.9 identity baseline |
| M7 | OPEN_API_MODULE | `07_OPEN_API_MODULE_v6.8.md` | Base module unchanged as source doc; v6.10 impact summarized here only |
| M8 | ADMIN_CONTROL_MODULE | `08_ADMIN_CONTROL_MODULE_v6.8.md` | No phase-1 design changes |
| M9 | **SHARED_LAYER** | `09_SHARED_LAYER_v6.10.md` | Runtime-governance spine lives here |
| 10 | **DATABASE_SCHEMA** | `10_DATABASE_SCHEMA_v6.10.md` | `runtime_*` tables and retention/index model |
| FE | **FRONTEND_ARCHITECTURE** | `../../docs/FRONTEND_ARCHITECTURE_v6.10.md` | Minimal `#runtime` page and UI deferral stance |

Companion synthesis doc (non-canonical summary):
- `../../docs/v6.10-runtime-governance-design.md`

Canonical rule for v6.10:
- **matrix-aligned design truth lives in the split docs above**
- the monolithic design doc is a review-friendly synthesis, not the primary architecture packaging

---

## 1. Executive Judgment

No — the earlier single `docs/v6.10-runtime-governance-design.md` artifact was **architecturally directionally correct but packaging-wrong** for Solfacil's existing matrix design framework.

Why:
1. Solfacil does not describe major releases as one floating design essay.
2. The current architecture system is explicitly matrix-based: master document + module/shared/schema documents.
3. v6.10 changes are cross-cutting across M5, M9, database schema, and frontend surface.
4. Therefore a single design doc can be a useful synthesis, but it cannot be the canonical architecture artifact set.

Corrective decision:
- keep the synthesis doc for review convenience
- restore canonical design packaging to the existing numbered framework

---

## 2. v6.10 System Positioning

v6.10 is not a feature-page release and not an external observability-stack adoption release.

It is a **runtime governance skeleton** release whose system role is:
- insert one central runtime-governance spine into the normalized v6.9 matrix lineage
- make selected runtime-critical modules emit standardized facts
- centralize severity, lifecycle, active-issue projection, self-check, and platform-health semantics
- expose an internal-ops-first backend contract for diagnosis

One-line system definition:

> v6.10 makes the platform able to express its own operational condition through governed runtime facts instead of scattered logs and module-local judgment.

---

## 3. Matrix Impact Map

| Area | v6.10 impact | Canonical design doc |
|------|--------------|----------------------|
| M1 IoT Hub | **Canonical v6.10 delta exists** | `01_IOT_HUB_MODULE_v6.10.md` |
| M2 Optimization Engine | **Canonical v6.10 delta exists** | `02_OPTIMIZATION_ENGINE_MODULE_v6.10.md` |
| M3 DR Dispatcher | **Canonical v6.10 delta exists** | `03_DR_DISPATCHER_MODULE_v6.10.md` |
| M4 Market Billing | **Canonical v6.10 delta exists** | `04_MARKET_BILLING_MODULE_v6.10.md` |
| M5 BFF | New `/api/runtime/*` read/write operator contract, BFF emitters, admin-only `#runtime` shell | `05_BFF_MODULE_v6.10.md` |
| M6 Identity | No standalone v6.10 design package; inherits v6.9 normalized identity baseline | `06_IDENTITY_MODULE_v6.9.md` |
| M7 Open API | Optional later emitter path, deferred from phase-1 onboarding | This doc summary |
| M8 Admin Control | No phase-1 change | none |
| M9 Shared Layer | **Primary insertion point**: runtime spine, event contract, lifecycle, health derivation, self-check registry | `09_SHARED_LAYER_v6.10.md` |
| DB Schema | New `runtime_events`, `runtime_issues`, `runtime_self_checks`, `runtime_health_snapshots` | `10_DATABASE_SCHEMA_v6.10.md` |
| Frontend | Minimal admin-only `#runtime` surface, backend-contract-first | `../../docs/FRONTEND_ARCHITECTURE_v6.10.md` |

---

## 4. Architectural Commitments

### 4.1 What remains unchanged
- Existing matrix architecture remains the system boundary model.
- Existing business/domain surfaces (P5, P6, fleet/device/domain alarm logic) remain separate from platform runtime governance.
- Existing module ownership remains intact.

### 4.2 What is new in v6.10
- one shared-layer runtime-governance spine in M9
- one runtime event contract
- one issue/lifecycle projection model
- one self-check read model
- one platform health summary surface
- one minimal internal operator runtime UI

### 4.3 What is explicitly not happening
- no new monolithic module replacing M1–M8
- no merge of platform runtime issues into P6 alerts
- no broad UI redesign
- no all-module full observability rollout in phase-1

---

## 5. Phase-1 Onboarding Set

Phase-1 remains intentionally narrow.

| Source | Reason |
|--------|--------|
| BFF request lifecycle | top-of-funnel runtime truth for user-facing failures |
| Shared DB pool | common substrate for nearly all runtime paths |
| M1 ingest pipeline | freshness is foundational to platform truth |
| M3 dispatch loops | catches silent-workflow-failure class |
| Scheduler / cron jobs | catches time-bounded correctness failures |

Redis namespace is reserved but **not** part of the fixed phase-1 component set.

---

## 6. Cross-Document Navigation

Read v6.10 in this order:
1. `00_MASTER_ARCHITECTURE_v6.10.md`
2. `09_SHARED_LAYER_v6.10.md`
3. `10_DATABASE_SCHEMA_v6.10.md`
4. `05_BFF_MODULE_v6.10.md`
5. `../../docs/FRONTEND_ARCHITECTURE_v6.10.md`

If Alan wants the short reviewer path instead:
- `../../docs/v6.10-runtime-governance-design.html`
- `../../docs/v6.10-runtime-governance-docs.html`

---

## 7. Release Boundary

v6.10 is design-complete only when the numbered matrix artifact set exists.

That means the canonical DESIGN for v6.10 is now this **plural** set, not the earlier single synthesis doc alone.
