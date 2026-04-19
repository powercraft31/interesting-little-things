# M6: Identity Module — v6.9 Security/Auth Contract

> **Module Version**: v6.9
> **Parent Document**: [00_MASTER_ARCHITECTURE_v6.9.md](./00_MASTER_ARCHITECTURE_v6.9.md)
> **Baseline**: [06_IDENTITY_MODULE_v6.8.md](./06_IDENTITY_MODULE_v6.8.md)
> **Date**: 2026-04-18
> **Description**: Final-code-backed identity/auth contract changes for v6.9

---

## 1. Module Judgment

v6.9 does not replace the identity model.
It corrects the runtime auth contract.

The important identity-level change is not new RBAC or new tables.
It is the split between:
- browser session contract
- machine bearer contract

That split becomes explicit and non-ambiguous in final code.

---

## 2. Browser vs Machine Contract

Final-code evidence:
- `backend/src/bff/middleware/auth.ts`
- `backend/src/bff/handlers/auth-login.ts`
- `backend/src/bff/handlers/auth-session.ts`

| Property | Browser contract | Machine contract |
|----------|------------------|------------------|
| credential transport | session cookie | bearer token |
| login default | yes | no, must request explicitly |
| token in login body | no | yes |
| session endpoint | yes | no |
| intended caller | SPA/browser | CLI/scripts/service clients |

This is the core v6.9 identity correction.

---

## 3. Session Cookie Contract

### 3.1 Name selection
Final-code source: `backend/src/bff/middleware/auth.ts`

| Environment | Cookie name |
|-------------|-------------|
| production | `__Host-solfacil_session` |
| non-production | `solfacil_session` |

### 3.2 Cookie attributes in final login/logout code
- `httpOnly: true`
- `sameSite: "strict"`
- `path: "/"`
- `maxAge: 24h` on login
- `secure: true` in production-capable path

### 3.3 Dev-mode exception
Local/plain-HTTP development cannot use `__Host-` cookie semantics, so non-production name/secure behavior is intentionally different.

---

## 4. Session Truth Source

Browser session truth is now:
- `GET /api/auth/session`

Not:
- `localStorage` token presence
- ad hoc browser-side bearer handling

This matters because identity truth moved from JavaScript-held credential state to server-validated session state.

---

## 5. RBAC and Claims

v6.9 does not redesign role model or auth tables.

Still authoritative:
- `users`
- `user_org_roles`
- `role` claims inside verified JWT

What changes is how those claims reach the browser/runtime boundary, not what they mean.

---

## 6. Secret Discipline

Identity contract after v6.9 assumes:
- JWT signing/verifying requires `JWT_SECRET`
- no hardcoded production-capable fallback secret path
- startup validation is mandatory via shared-layer fail-fast logic

That turns secret absence from a silent downgrade into an explicit boot failure.

---

## 7. Non-Changes

v6.9 does **not** introduce:
- refresh-token architecture
- MFA
- auth-table schema changes
- role model redesign
- tenant model redesign

It is a correction release, not identity-system expansion.
