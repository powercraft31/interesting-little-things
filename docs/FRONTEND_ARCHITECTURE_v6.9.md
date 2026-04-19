# SOLFACIL Frontend Architecture — v6.9 Security/Auth Boundary

> **Version**: v6.9
> **Baseline**: v6.8 frontend architecture
> **Date**: 2026-04-18
> **Description**: Final-code-backed frontend deltas for cookie-first browser auth and CSP/security correction

---

## 1. Frontend Judgment

v6.9 changes the frontend auth model materially.

The browser no longer treats a JS-held bearer token as auth truth.
Instead, the browser treats the httpOnly session cookie plus `/api/auth/session` as the authoritative session model.

---

## 2. Login Surface

Final-code sources:
- `frontend-v2/login.html`
- `frontend-v2/js/login.js`

### 2.1 Structural posture
- no inline login script
- login JS moved to `js/login.js`
- login submits credentials with `credentials: "same-origin"`
- no auth token is written to localStorage

### 2.2 Auto-redirect behavior
On page load, login page checks:
- `GET /api/auth/session`

If already authenticated:
- redirect to `index.html`

If not:
- show login form

---

## 3. App Bootstrap Auth Gate

Final-code source:
- `frontend-v2/js/app.js`

Before bootstrapping the app:
- frontend calls `GET /api/auth/session`
- non-OK response redirects to `login.html`
- successful response populates `window.currentUser`
- app then bootstraps

This replaces localStorage-bearer bootstrap logic.

---

## 4. API Adapter Behavior

Final-code source:
- `frontend-v2/js/data-source.js`

Key v6.9 posture:
- live API requests use `credentials: "include"`
- no `Authorization: Bearer` header injection for browser path
- `401` redirects to `login.html`

This is the frontend-side completion of the cookie-first browser contract.

---

## 5. Logout Behavior

Final-code source:
- `frontend-v2/js/app.js`

Logout flow:
1. POST `/api/auth/logout`
2. ignore transport failure for UX continuity
3. clear `window.currentUser`
4. redirect to `login.html`

Session destruction truth stays server-side through cookie clearing.

---

## 6. CSP / Asset Hardening Baseline

Final-code evidence:
- `frontend-v2/index.html` loads self-hosted `js/vendor/echarts.min.js`
- `frontend-v2/login.html` is simple, no CDN/script-inline dependency
- search over current shipped HTML does not show CDN/font-host inline-script dependency on main app surface

So the effective frontend security posture after v6.9 is:
- self-hosted critical JS assets
- cookie-first browser auth
- no localStorage auth token path
- CSP-compatible login surface

---

## 7. Non-Goals / Non-Changes

v6.9 frontend does **not** redesign the page architecture.

P1–P6 structure remains.
What changes is browser auth/security behavior, not the business page model.
