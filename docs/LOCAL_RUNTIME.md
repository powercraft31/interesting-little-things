# SOLFACIL Local Runtime — Single Source of Truth

**Status:** Active
**Last Updated:** 2026-03-31
**Purpose:** Prevent environment drift, dual-runtime confusion, and accidental resurrection of retired host paths.

---

## 1. Canonical Runtime Environments

### Production
- **URL:** `https://solfacil.alwayscontrol.net/`

### Development (EC2)
- **URL:** `http://188.166.184.87/solfacil/`

### Local Development
- **BFF/UI bind:** `http://127.0.0.1:3100`
- **Database:** Docker `solfacil-db` on `127.0.0.1:5433`

### Docker Containers
- `solfacil-db` — PostgreSQL 15
- `solfacil-bff` — BFF + static frontend
- `solfacil-m1` — MQTT↔DB pipeline

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
`3100` is host-local only and is intentionally bound to `127.0.0.1`.

### C. Old IP `152.42.235.155`
All references to `152.42.235.155` are **retired**. Production now uses `https://solfacil.alwayscontrol.net/`.

---

## 3. Operational Rule

When validating Solfacil UI or BFF changes:

1. Use Docker runtime only
2. Use `https://solfacil.alwayscontrol.net/` (production) or `http://188.166.184.87/solfacil/` (dev) as the human-facing URL
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

The authoritative live paths are:

- **Production:** `https://solfacil.alwayscontrol.net/`
- **Dev:** `http://188.166.184.87/solfacil/`
- **Local:** `http://127.0.0.1:3100` backed by Docker DB on `127.0.0.1:5433`

No other path should be treated as authoritative.

> **Note:** The old IP `152.42.235.155` is retired. Production now uses the `solfacil.alwayscontrol.net` subdomain with HTTPS.
