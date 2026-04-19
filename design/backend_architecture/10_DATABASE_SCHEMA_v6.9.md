# Database Schema — v6.9 Security Correction

> **Version**: v6.9
> **Parent**: [00_MASTER_ARCHITECTURE_v6.9.md](./00_MASTER_ARCHITECTURE_v6.9.md)
> **Baseline**: [10_DATABASE_SCHEMA_v6.8.md](./10_DATABASE_SCHEMA_v6.8.md)
> **Date**: 2026-04-18
> **Scope**: Explicit schema judgment for v6.9

---

## 1. Judgment

v6.9 introduces **no schema delta**.

This is not omission; it is the correct architectural statement.

The final security correction is implemented through:
- middleware changes
- handler contract changes
- environment/runtime preconditions
- frontend behavior changes

not through table or column changes.

---

## 2. Tables Confirmed Unchanged

Identity-related tables remain unchanged:
- `users`
- `user_org_roles`

No new auth/session table is introduced.
No refresh-token table is introduced.
No abuse-control table is introduced.

Abuse control is store-backed through Redis/in-memory middleware, not persisted to PostgreSQL schema in v6.9.

---

## 3. Why This Matters

This explicit no-change document is part of canonical continuity.

Without it, readers have to guess whether:
- auth correction required DDL
- session state moved into DB
- rate limiting created new persistence surfaces

The answer in final code is no.

So `10_DATABASE_SCHEMA_v6.9.md` exists to make that architectural fact explicit.
