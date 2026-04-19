# M5: BFF Module — v6.9 Security/Auth Boundary

> **Module Version**: v6.9
> **Parent Document**: [00_MASTER_ARCHITECTURE_v6.9.md](./00_MASTER_ARCHITECTURE_v6.9.md)
> **Baseline**: [05_BFF_MODULE_v6.8.md](./05_BFF_MODULE_v6.8.md)
> **Date**: 2026-04-18
> **Description**: Final-code-backed BFF deltas for v6.9 security correction

---

## 1. Module Judgment

M5 is the main architectural landing zone of v6.9.

The final code shows four real BFF-level changes:
1. auth middleware became cookie-first with explicit browser/machine split
2. browser session bootstrap moved to `GET /api/auth/session`
3. login abuse control wraps `/api/auth/login`
4. security response headers moved into app-layer middleware

---

## 2. Auth Middleware Delta

Final-code source: `backend/src/bff/middleware/auth.ts`

### 2.1 Resolution order

| Order | Signal | Meaning |
|-------|--------|---------|
| 1 | session cookie present | browser contract |
| 2 | `Authorization` header present and no cookie | machine contract |
| 3 | neither | 401 |

Cookie wins when both are present.

### 2.2 Public-route posture

Still public:
- `/api/auth/login`
- `/api/auth/logout`
- non-`/api/*` frontend/static paths

### 2.3 Backward compatibility technique

After verification, middleware rewrites `req.headers.authorization` into raw JSON claims so downstream wrapped handlers do not need mass surgery.

That is an intentional compatibility bridge inside M5.

---

## 3. Login / Logout / Session Contract

Final-code sources:
- `backend/src/bff/handlers/auth-login.ts`
- `backend/src/bff/handlers/auth-session.ts`
- `backend/scripts/local-server.ts`

### 3.1 `POST /api/auth/login`

| Caller mode | Behavior |
|-------------|----------|
| default / browser | set session cookie; return `{ user }`; no token in body |
| `X-Auth-Contract: machine` | return `{ token, user }`; no cookie |

Cookie attributes in final code:
- `httpOnly: true`
- `sameSite: "strict"`
- `path: "/"`
- `secure: NODE_ENV === "production"`
- cookie name from `SESSION_COOKIE_NAME`

### 3.2 `POST /api/auth/logout`

Clears the same session cookie with matching security attributes.

### 3.3 `GET /api/auth/session`

Cookie-only browser truth endpoint.

Final-code behavior:
- rejects requests lacking session cookie
- reads claims from middleware rewrite
- queries DB for fresh user metadata
- returns `{ userId, orgId, role, name, email }`

---

## 4. Abuse Control in M5

Final-code sources:
- `backend/src/bff/middleware/rate-limit.ts`
- `backend/scripts/local-server.ts`

### 4.1 Scope
Only wraps `/api/auth/login`.

### 4.2 Policy
- per-IP: 10 failures / 15 minutes
- per-email: 5 failures / 15 minutes
- blocked requests return `429` with `Retry-After`

### 4.3 Store selection
- dev without Redis → in-memory store allowed
- Redis URL present → Redis store
- non-dev without Redis URL → process exits

This is an architecture-level anti-fail-open decision.

---

## 5. Security Headers Middleware

Final-code sources:
- `backend/src/bff/middleware/security-headers.ts`
- `backend/scripts/local-server.ts`

Headers set at app layer:
- `Content-Security-Policy`
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy`

HSTS is intentionally excluded from M5 and remains ingress-owned.

---

## 6. Trusted Proxy and Runtime Wiring

`backend/scripts/local-server.ts` final code shows:
- `app.set("trust proxy", 1)`
- `app.use(securityHeaders)`
- `app.use(authMiddleware)`
- explicit login wrapping with abuse-control pre/post hooks
- explicit registration of `/api/auth/session`

So the BFF runtime boundary after v6.9 is materially different from v6.8 and must be documented as a canonical M5 change.

---

## 7. Non-Changes

v6.9 did **not** require:
- wholesale downstream handler rewrite
- BFF route-family redesign outside auth/security concerns
- SSE contract redesign beyond inheriting cookie-first auth behavior
