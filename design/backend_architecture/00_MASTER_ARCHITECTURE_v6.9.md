# SOLFACIL VPP — Master Architecture Blueprint

> **Version**: v6.9
> **Baseline**: v6.8 matrix + final v6.9 security/auth boundary code
> **Date**: 2026-04-18
> **Description**: System master blueprint — v6.9 security correction release normalized back into matrix architecture packaging
> **Core Theme**: cookie-first browser auth, browser hardening, abuse control, secret fail-fast, deployment security boundary closure

---

## Document Index

| # | Document | Path | Description |
|---|----------|------|-------------|
| 00 | **MASTER_ARCHITECTURE** | `00_MASTER_ARCHITECTURE_v6.9.md` | System-level impact map and canonical v6.9 architecture packaging |
| M1 | IOT_HUB_MODULE | `01_IOT_HUB_MODULE_v6.8.md` | Unaffected by v6.9 security correction |
| M2 | OPTIMIZATION_ENGINE_MODULE | `02_OPTIMIZATION_ENGINE_MODULE_v6.8.md` | Unaffected by v6.9 security correction |
| M3 | DR_DISPATCHER_MODULE | `03_DR_DISPATCHER_MODULE_v6.8.md` | Unaffected by v6.9 security correction |
| M4 | MARKET_BILLING_MODULE | `04_MARKET_BILLING_MODULE_v6.8.md` | No direct v6.9 surface change |
| M5 | **BFF_MODULE** | `05_BFF_MODULE_v6.9.md` | Cookie-first auth boundary, session endpoint, abuse control, security headers |
| M6 | **IDENTITY_MODULE** | `06_IDENTITY_MODULE_v6.9.md` | Browser/machine auth contract split and session/cookie identity rules |
| M7 | OPEN_API_MODULE | `07_OPEN_API_MODULE_v6.8.md` | Unaffected by v6.9 security correction |
| M8 | ADMIN_CONTROL_MODULE | `08_ADMIN_CONTROL_MODULE_v6.8.md` | No direct v6.9 architectural delta |
| M9 | **SHARED_LAYER** | `09_SHARED_LAYER_v6.9.md` | JWT verification and startup secret fail-fast changes |
| 10 | **DATABASE_SCHEMA** | `10_DATABASE_SCHEMA_v6.9.md` | Explicit statement of no schema delta in v6.9 |
| FE | **FRONTEND_ARCHITECTURE** | `../../docs/FRONTEND_ARCHITECTURE_v6.9.md` | Cookie-first browser session model and CSP/frontend hardening baseline |

Existing topic-oriented companion docs remain useful as review/release notes, but the numbered set above is the canonical matrix-aligned architecture truth for v6.9.

---

## 1. Executive Judgment

v6.9 was a correct security-correction release in intent, but its design packaging drifted out of the matrix architecture framework.

The code tells a clear story:
- browser auth is now cookie-first
- machine auth remains bearer-based but explicitly separate
- browser session truth is `/api/auth/session`, not localStorage
- login abuse control exists and is fail-fast in non-dev without Redis
- browser hardening headers are owned at app layer
- JWT secret fallback has been removed from production-capable runtime

Those are not merely topic notes. They are architecture-level changes touching M5, M6, M9, frontend, and deployment boundary assumptions. Therefore v6.9 must exist as a canonical matrix-aligned document set, not only as docs-side security essays.

---

## 2. Code-Backed Surface Map

This normalization is grounded in final code, not only earlier design prose.

### 2.1 Verified code evidence

| Area | Final code evidence |
|------|---------------------|
| Cookie-first auth middleware | `backend/src/bff/middleware/auth.ts` |
| Login contract split | `backend/src/bff/handlers/auth-login.ts` |
| Browser session endpoint | `backend/src/bff/handlers/auth-session.ts` |
| Abuse control | `backend/src/bff/middleware/rate-limit.ts` + `backend/scripts/local-server.ts` |
| Security headers | `backend/src/bff/middleware/security-headers.ts` + `backend/scripts/local-server.ts` |
| JWT secret fail-fast | `backend/src/shared/auth/validate-jwt-secret.ts` + `backend/src/shared/middleware/tenant-context.ts` |
| Frontend login/session gate | `frontend-v2/js/login.js`, `frontend-v2/js/app.js`, `frontend-v2/js/data-source.js`, `frontend-v2/login.html` |
| Deployment/runtime env closure | `.env.example`, `docker-compose.yml`, `backend/scripts/local-server.ts` |

### 2.2 Matrix impact summary

| v6.8 doc surface | v6.9 impact | Canonical v6.9 doc |
|------------------|-------------|--------------------|
| `00_MASTER_ARCHITECTURE_v6.8.md` | system-level auth/security boundary changed | this doc |
| `05_BFF_MODULE_v6.8.md` | major delta | `05_BFF_MODULE_v6.9.md` |
| `06_IDENTITY_MODULE_v6.8.md` | major delta | `06_IDENTITY_MODULE_v6.9.md` |
| `09_SHARED_LAYER_v6.8.md` | focused but critical delta | `09_SHARED_LAYER_v6.9.md` |
| `10_DATABASE_SCHEMA_v6.8.md` | explicitly no schema delta | `10_DATABASE_SCHEMA_v6.9.md` |
| `docs/FRONTEND_ARCHITECTURE_v6.8.md` | major delta | `../../docs/FRONTEND_ARCHITECTURE_v6.9.md` |

---

## 3. What v6.9 Actually Changed

### 3.1 Browser auth model

Browser auth moved from JS-readable bearer semantics to server-set session-cookie semantics.

Final-code evidence:
- `auth-login.ts` default path sets `SESSION_COOKIE_NAME` and returns `{ user }` only
- `frontend-v2/js/login.js` submits login with `credentials: "same-origin"` and writes no auth token
- `frontend-v2/js/app.js` bootstraps through `GET /api/auth/session`
- `frontend-v2/js/data-source.js` uses cookie-bearing fetches and redirects on 401

### 3.2 Machine auth model

Machine access remains bearer-capable, but only when explicitly requested via `X-Auth-Contract: machine` at login and `Authorization: Bearer` on subsequent use.

### 3.3 Abuse control

Login abuse control exists as app-owned middleware around `/api/auth/login` only, with:
- per-IP threshold
- per-email threshold
- `Retry-After`
- Redis primary for non-dev
- in-memory fallback only for development
- process-exit fail-fast when non-dev lacks Redis backing

### 3.4 Browser hardening

App-layer security headers now include:
- CSP
- X-Frame-Options
- X-Content-Type-Options
- Referrer-Policy
- Permissions-Policy

HSTS remains ingress-owned, not app-owned.

### 3.5 Secret posture

The old weak placeholder fallback path is gone from production-capable runtime semantics.
`validateJwtSecret()` enforces fail-fast startup semantics, while `verifyTenantToken()` no longer contains a hardcoded fallback secret.

---

## 4. What v6.9 Did Not Change

| Surface | Judgment |
|---------|----------|
| M1 MQTT ingestion | unaffected |
| M2 optimization engine | unaffected |
| M3 DR dispatcher | unaffected |
| M4 billing math and cron architecture | unaffected |
| M7 webhook contract | unaffected |
| M8 admin-control architecture | unchanged except inherited auth behavior |
| database schema | no DDL change required |

---

## 5. Deployment Boundary Normalization

v6.9 changes deployment responsibility semantics even though it does not change topology.

Final-code-backed boundary split:
- **application owns** CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy
- **ingress owns** HSTS and TLS termination truth
- **app trusts first proxy hop** via `app.set("trust proxy", 1)`
- **runtime env must provide** `JWT_SECRET` and `RATE_LIMIT_REDIS_URL` for production-capable path

This keeps `docs/v6.9-deployment-security-boundary-design.md` as a useful companion document, but removes ambiguity about where the canonical architecture truth now lives: the matrix baseline acknowledges the deployment-security boundary explicitly.

---

## 6. Canonical Packaging Rule for Later Releases

v6.9 is the release where design-packaging drift first became visible.
This normalized document set corrects that.

Rule going forward:
- release-specific topic docs may exist
- but if a release changes canonical architecture surfaces, those changes must be reflected back into numbered matrix docs

That rule now applies to v6.10 as well.
