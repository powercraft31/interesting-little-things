# SOLFACIL Frontend Architecture — v6.10 Runtime Governance Extension

> **Version**: v6.10
> **Baseline**: v6.9 normalized frontend architecture
> **Date**: 2026-04-18
> **Description**: Minimal internal runtime-governance surface added without changing P1–P6 product framing

---

## 1. Frontend Judgment

Frontend is not the center of v6.10.

That is a fixed design choice, not an implementation convenience.

The frontend role in v6.10 is:
- expose one minimal internal operator runtime page
- consume backend runtime contract directly
- avoid competing with P5/P6 domain surfaces

So the frontend delta must stay small and subordinate.

---

## 2. New Route

### 2.1 Route addition

| Page | Hash Route | JS Module | Audience | Purpose |
|------|-----------|-----------|----------|---------|
| P7 Runtime | `#runtime` | `p7-runtime.js` | `admin` only | Minimal platform runtime diagnosis surface |

### 2.2 Route rule

`#runtime` is:
- internal-only in phase-1
- not part of customer-facing navigation
- not a replacement for P6 Alerts
- not a merged observability/control center

---

## 3. Page Composition

The page stays vertically simple.

### 3.1 Required sections
1. overall runtime posture
2. component state row
3. active issues table
4. issue detail drawer/panel
5. self-check panel

### 3.2 Data sources

Direct backend contract consumption only:
- `GET /api/runtime/health`
- `GET /api/runtime/issues`
- `GET /api/runtime/issues/:fingerprint`
- `GET /api/runtime/events`
- `GET /api/runtime/self-checks`
- operator action POSTs for close/suppress/note

No page-local runtime inference is allowed.

---

## 4. Explicit UI Non-Goals

Phase-1 UI does **not** include:
- charts
- trend analysis
- SSE/live stream push
- customer-operator mode
- merge with P5 or P6
- broad responsive redesign
- aesthetic dashboard pass as release driver

Refresh posture:
- manual refresh + soft poll is sufficient in phase-1

---

## 5. Separation from Existing Pages

| Surface | Semantic question |
|---------|-------------------|
| P5 Strategy | what strategic/business intent requires governance action? |
| P6 Alerts | what fleet/site/device alarm conditions are active? |
| P7 Runtime | is the platform itself healthy and where is the runtime fault line? |

This separation is part of the product architecture, not merely page organization.

---

## 6. Navigation Discipline

If runtime page is added to navigation, it must be visually and semantically marked as:
- admin/internal
- platform runtime
- not customer operational telemetry

No relabeling of P6 should be used as a shortcut.

---

## 7. Canonical Relationship to Backend Docs

Frontend v6.10 is downstream of backend/shared design truth.

Backend authority split:
- runtime contract / lifecycle / self-check semantics → `design/backend_architecture/09_SHARED_LAYER_v6.10.md`
- operator routes → `design/backend_architecture/05_BFF_MODULE_v6.10.md`
- storage model → `design/backend_architecture/10_DATABASE_SCHEMA_v6.10.md`

Frontend must consume, not redefine, those semantics.
