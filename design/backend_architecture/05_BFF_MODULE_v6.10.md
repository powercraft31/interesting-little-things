# M5: BFF Module — Runtime Governance Extension

> **Module Version**: v6.10
> **Parent Document**: [00_MASTER_ARCHITECTURE_v6.10.md](./00_MASTER_ARCHITECTURE_v6.10.md)
> **Baseline**: [05_BFF_MODULE_v6.9.md](./05_BFF_MODULE_v6.9.md)
> **Date**: 2026-04-18
> **Description**: v6.10 BFF deltas — runtime operator contract, BFF emitter points, minimal runtime page boundary

---

## 1. Module Judgment

In v6.10, M5 is **not** the runtime-governance brain.

M5 has exactly three responsibilities in this release:
1. expose the operator-facing backend contract under `/api/runtime/*`
2. emit BFF-side runtime facts into the shared-layer spine
3. host the minimal admin-only `#runtime` UI shell

All governance semantics remain owned by M9 shared layer.

---

## 2. New BFF Contract Surface

### 2.1 New endpoints

| # | Method | Route | Purpose |
|---|--------|-------|---------|
| R1 | GET | `/api/runtime/health` | derived platform health summary |
| R2 | GET | `/api/runtime/issues` | active/recovered issue list with filters |
| R3 | GET | `/api/runtime/issues/:fingerprint` | one issue + recent event tail |
| R4 | GET | `/api/runtime/events` | retained raw event tail |
| R5 | GET | `/api/runtime/self-checks` | latest self-check state from `runtime_self_checks` |
| R6 | POST | `/api/runtime/issues/:fingerprint/close` | operator close |
| R7 | POST | `/api/runtime/issues/:fingerprint/suppress` | operator suppress |
| R8 | POST | `/api/runtime/issues/:fingerprint/note` | operator note |

### 2.2 Auth boundary

Phase-1 access rule:
- all `/api/runtime/*` routes are **SOLFACIL_ADMIN only**
- service-pool reads/writes are allowed because runtime governance is platform-scoped, not tenant-RLS-scoped

### 2.3 Contract shape

All routes continue to use existing `ok()` / `fail()` envelope conventions.

No new public URL family is introduced outside current BFF conventions.

---

## 3. BFF Emitter Points

BFF phase-1 emitter coverage is intentionally selective.

| BFF area | Runtime fact class |
|----------|--------------------|
| boot/start path | `bff.boot.*` |
| top-level express error boundary | `bff.handler.unhandled_exception` |
| `wrapHandler(...)` catch-all | lambda-adaptor side unhandled failures |
| auth middleware invalid burst / anomaly path | `bff.auth.*` |
| runtime self-heartbeat | `bff.listen` self-check support |

Non-goals:
- do not turn every handler log into an event
- do not create per-endpoint runtime taxonomy in phase-1
- do not alter business endpoint payloads to carry runtime-governance data

---

## 4. BFF Read/Write Relationship to Spine

M5 is a **read/write edge**, not the storage authority.

- write side: call shared-layer `emit(...)`
- read side: query shared-layer health/projection interfaces backed by runtime tables
- operator action side: close/suppress/note mutate `runtime_issues` through shared-layer contract, not ad hoc handler SQL

This keeps M5 from becoming a second governance center.

---

## 5. Minimal UI Boundary

M5 serves one new operator-facing route family on the frontend side:
- hash route: `#runtime`

But BFF design rule is:
- UI exists only to prove operator usability of backend contract
- UI sophistication is deferred
- no runtime-SSE channel in phase-1
- no merge with P5 or P6 surfaces

---

## 6. Failure / Rollback Discipline

BFF must preserve these constraints:
- if runtime-governance feature flag is off, `/api/runtime/health` may return top-level `overall="disabled"` and empty runtime collections
- runtime emit failure must never fail a normal user/business request
- disabling feature flag must be sufficient to neutralize runtime-governance behavior without breaking existing BFF routes

---

## 7. Canonical References

For actual governance semantics, do not treat this document as the authority.

Authority split:
- schema / lifecycle / self-check / projection → `09_SHARED_LAYER_v6.10.md`
- storage / indexes / retention → `10_DATABASE_SCHEMA_v6.10.md`
- UI page posture → `../../docs/FRONTEND_ARCHITECTURE_v6.10.md`
