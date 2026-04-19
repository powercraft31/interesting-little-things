# 09 Shared Layer Architecture — v6.9 Security Extension

> **Version**: v6.9
> **Parent**: [00_MASTER_ARCHITECTURE_v6.9.md](./00_MASTER_ARCHITECTURE_v6.9.md)
> **Baseline**: [09_SHARED_LAYER_v6.8.md](./09_SHARED_LAYER_v6.8.md)
> **Date**: 2026-04-18
> **Scope**: Final-code-backed shared-layer deltas for v6.9 auth/security correction

---

## 1. Core Judgment

v6.9 changes M9 less broadly than M5, but the change is critical.

The shared layer becomes the place where weak-secret tolerance ends.

That happens in two ways:
1. token verification path no longer carries a hardcoded production-capable fallback
2. startup secret validation becomes explicit and fail-fast

---

## 2. `tenant-context.ts` Delta

Final-code source:
- `backend/src/shared/middleware/tenant-context.ts`

### 2.1 What remains
Still supports two inputs:
- raw JSON claims (for internal compatibility path after M5 middleware rewrite)
- JWT with HS256 verification

### 2.2 What changed
The JWT verification path now requires `process.env.JWT_SECRET`.
If it is absent:
- verification throws
- no hardcoded default secret is used

That is the real shared-layer security delta.

---

## 3. Startup Secret Validation

Final-code source:
- `backend/src/shared/auth/validate-jwt-secret.ts`

### 3.1 Rules
Startup validation rejects:
- missing or empty `JWT_SECRET`
- weak legacy placeholder in non-dev mode (`solfacil-dev-secret`)

### 3.2 Architectural significance
This moves secret posture from:
- passive convention

to:
- enforceable runtime precondition

That is why v6.9 must be reflected in canonical M9 docs even though file count changes are small.

---

## 4. Shared-Layer Role in v6.9 Boundary

M9 after v6.9 provides:
- pure verification semantics for tenant token validation
- fail-fast secret hygiene
- compatibility support for downstream handler claim format

M9 does **not** own:
- cookie parsing
- browser/machine contract discrimination
- login abuse control
- security header middleware

Those remain M5 concerns.

---

## 5. Non-Changes

v6.9 does **not** alter these shared-layer concerns:
- DB dual-pool architecture
- `queryWithOrg` semantics
- tarifa logic
- P5 persistence helpers
- protocol timestamp utilities
- shared domain types outside auth boundary

So the v6.9 M9 change is narrow, but it is still canonical because it changes security invariants.
