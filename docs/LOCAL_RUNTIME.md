# SOLFACIL Local Runtime — Single Source of Truth

**Status:** Active
**Last Updated:** 2026-03-18
**Purpose:** Prevent environment drift, dual-runtime confusion, and repeated debugging of the wrong stack.

---

## 1. Canonical Local Runtime

Solfacil local development and UI/runtime validation must use **one** environment only:

### App / BFF
- **Primary URL:** `http://152.42.235.155:3100`
- **Host-equivalent probe URL:** `http://127.0.0.1:3100`

### Database
- **Canonical DB:** Docker `solfacil-db`
- **Host mapping:** `127.0.0.1:5433`

### Containers
- `solfacil-db`
- `solfacil-bff`
- `solfacil-m1`

---

## 2. What is NOT the canonical runtime

### A. Host bare-run backend / DB
The following path is considered a **legacy / non-canonical runtime path** and must not be used as the primary validation target:

- `backend/scripts/local-server.ts`
- Host Postgres on `127.0.0.1:5432`

This path may still exist on the machine, but it is **not** the source of truth for Solfacil page validation.

### B. File-server demo snapshots
Any `8443` file-server path such as:
- `https://152.42.235.155:8443/.../frontend-v2`

is a **static shared demo/archive path**, not the live application runtime.

Do not use it to answer questions like:
- “Is Fleet working now?”
- “Did Devices break after this code change?”
- “Is login working?”

---

## 3. Operational Rule

When validating Solfacil UI changes:

1. Use Docker runtime only
2. Use `http://152.42.235.155:3100` as the human-facing URL
3. Treat `5433` as the only local dev DB
4. Do not switch to `3000 + 5432` mid-debug
5. Do not use `8443 demo` as evidence of current runtime behavior

---

## 4. Why this rule exists

Historically, two local runtime paths coexisted:

- Docker-aligned runtime (`3100 + 5433`)
- Host bare-run runtime (`3000 + 5432`)

This caused repeated confusion where:
- code was changed in one runtime assumption
- validation happened against another runtime
- file-server demo pages were mistaken for the current live app

Result: wasted debugging cycles, false regression signals, and repeated rediscovery of the same environment split.

---

## 5. Immediate implication for v6.2 Devices

All remaining runtime validation for v6.2 Devices must be performed against:

- `http://152.42.235.155:3100`
- backed by Docker DB on `5433`

No other path is considered authoritative.

---

## 6. Recommended future cleanup

A future cleanup task should:
- retire bare-run local-server as a primary path
- retire or archive `8443` demo frontend as non-runtime-only content
- remove ambiguous host-DB defaults where safe
- enforce Docker-only local validation in docs and scripts

Until that cleanup is fully executed, this document is the rulebook.
