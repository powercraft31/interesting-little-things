# SOLFACIL Local Runtime — Single Source of Truth

**Status:** Active
**Last Updated:** 2026-03-19
**Purpose:** Prevent environment drift, dual-runtime confusion, and accidental resurrection of retired host paths.

---

## 1. Canonical Local Runtime

Solfacil local development and validation must use **one environment only**.

### Public human-facing URL
- **Primary URL:** `http://152.42.235.155`

### Host-local service probe
- **BFF/UI bind:** `http://127.0.0.1:3100`

### Database
- **Canonical DB:** Docker `solfacil-db`
- **Host mapping:** `127.0.0.1:5433`

### Public entry chain
- `http://152.42.235.155`
- → nginx on `:80`
- → reverse proxy to `127.0.0.1:3100`

### Containers
- `solfacil-db`
- `solfacil-bff`
- `solfacil-m1`

---

## 2. What is retired / non-canonical

### A. Host bare-run backend / host DB
The following path is **retired** and must not be used for validation or deployment:

- `backend/scripts/local-server.ts`
- host BFF on `:3000`
- host Postgres on `127.0.0.1:5432`
- legacy `solfacil-bff.service`

These paths are no longer part of the active Solfacil runtime.

### B. Direct public access to `:3100`
The following is **not** the public entry anymore:

- `http://152.42.235.155:3100`

`3100` is now host-local only and is intentionally bound to `127.0.0.1`.

### C. File-server demo snapshots
Any `8443` file-server path such as:
- `https://152.42.235.155:8443/.../frontend-v2`

is a **static shared demo/archive path**, not the live application runtime.

---

## 3. Operational Rule

When validating Solfacil UI or BFF changes:

1. Use Docker runtime only
2. Use `http://152.42.235.155` as the human-facing URL
3. Use `http://127.0.0.1:3100` only as a host-local service probe
4. Treat `5433` as the only local Solfacil DB
5. Do not switch back to `3000 + 5432`
6. Do not use `8443 demo` as runtime evidence

---

## 4. Why this rule exists

Historically, multiple local paths coexisted:

- Docker-aligned runtime (`127.0.0.1:3100` + `127.0.0.1:5433`)
- Host bare-run runtime (`3000 + 5432`)
- File-server demo snapshots (`8443`)

This caused repeated confusion, false regressions, and wasted debugging cycles.

The environment has now been closed so that only one real runtime remains.

---

## 5. Immediate implication

For current local usage, the only authoritative live path is:

- `http://152.42.235.155`

backed by:

- BFF on `127.0.0.1:3100`
- Docker DB on `127.0.0.1:5433`

No other path should be treated as authoritative.

---

## 6. Future HTTPS

This local machine currently has **no formal DNS hostname** attached to it.

If a future subdomain is added, HTTPS can later be introduced by attaching:

- `443`
- → reverse proxy
- → `127.0.0.1:3100`

Until then, the canonical public entry remains plain HTTP via the machine IP.
