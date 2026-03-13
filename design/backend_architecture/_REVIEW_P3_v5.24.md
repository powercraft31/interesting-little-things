# P3 v5.24 Cross-Review Report (Second Round)

> **Reviewer**: Claude Code (Independent Session #2)
> **Date**: 2026-03-13
> **Scope**: 6 design documents for P3 Asset History View
> **Source of Truth**: `db-init/02_schema.sql`, `backend/src/shared/db.ts`, `backend/src/shared/tarifa.ts`, `backend/src/bff/handlers/get-gateway-energy.ts`, `frontend-v2/js/data-source.js`, `frontend-v2/js/app.js`, `frontend-v2/index.html`, `backend/scripts/local-server.ts`, `docs/REQ-P3-history-view.md`

---

## Summary

| Severity | Found | Fixed | Notes |
|----------|-------|-------|-------|
| **HIGH** | 5 | 5 | All fixed in-place |
| **MED** | 5 | 5 | All fixed in-place |
| **LOW** | 3 | 0 | Documented only |

---

## HIGH Issues

### H1. M05 §2.1 — Month resolution SQL references non-existent column in outer query

**Location**: `05_BFF_MODULE_v5.24.md` §2.1, resolution = `'month'` SQL

**Problem**: The outer SELECT uses `date_trunc('month', recorded_at AT TIME ZONE 'America/Sao_Paulo') AS t` but `recorded_at` is NOT available in the outer query scope — it only exists inside the subquery. The outer query only has access to `sub.day`, `sub.day_pv`, etc.

**Impact**: This SQL will fail at runtime with `ERROR: column "recorded_at" does not exist`.

**Fix**: Change outer SELECT to `date_trunc('month', sub.day) AS t`.

---

### H2. M05 §2.2 — Missing voltage/current history query (Q8)

**Location**: `05_BFF_MODULE_v5.24.md` §2.2

**Problem**: The response schema includes `voltageHistory: [{ t, voltage, current }]` but the parallel queries only define Q1-Q7. There is no SQL query to populate `voltageHistory`. The REQ (`REQ-P3-history-view.md` §P3-2) explicitly requires "battery_voltage + battery_current".

**Impact**: `voltageHistory` will always be empty/undefined in the response.

**Fix**: Add Q8 for voltage/current history. Update parallel query count from "7" to "8".

---

### H3. M05 header — Wrong parent document reference

**Location**: `05_BFF_MODULE_v5.24.md` line 4

**Problem**: Header links to `00_MASTER_ARCHITECTURE_v5.22.md` instead of `v5.24`.

**Fix**: Update to `00_MASTER_ARCHITECTURE_v5.24.md`.

---

### H4. M04 §2.2 — Alignment table incorrectly claims export deduction is "same"

**Location**: `04_MARKET_BILLING_MODULE_v5.24.md` §2.2 alignment table

**Problem**: The table claims `grid_export_kwh x feed_in_rate` is "same" between M4 `calculateActualCost` and P3. But the actual `calculateActualCost` in `shared/tarifa.ts` (line 103-112) does NOT subtract grid export x feed_in_rate — it only sums `gridImportKwh * rate`. P3's formula correctly includes the export credit per REQ, making it DIFFERENT from `calculateActualCost`.

**Impact**: Developers implementing P3 may incorrectly call `calculateActualCost` expecting export deduction, resulting in wrong savings values.

**Fix**: Change the checkmark to warning with note explaining the difference.

---

### H5. M05 §4 — Pool compliance table says "7" for health handler

**Location**: `05_BFF_MODULE_v5.24.md` §4

**Problem**: Says `queryWithOrg() x7` but should be x8 after adding voltage/current query.

**Fix**: Update to x8.

---

## MED Issues

### M1. M15 Step 1.3 — Wrong `wrapHandler` signature

**Location**: `15_P3_EXECUTION_PLAN_v5.24.md` Phase 1, Step 1.3

**Problem**: Shows `wrapHandler(getAssetTelemetry)` with 1 argument. The actual `wrapHandler` function in `local-server.ts` requires 3 arguments: `(handler, method, path)`.

**Fix**: Update code sample to use correct 3-argument signature.

---

### M2. M00 §2 — P2 route and JS file are fabricated

**Location**: `00_MASTER_ARCHITECTURE_v5.24.md` §2 route table

**Problem**: Claims P2 Gateway Detail uses hash route `#gateway/:gatewayId` and JS file `p2-gateway.js`. But the actual frontend uses `#devices` route (in app.js PAGES array) and `p2-devices.js` (in index.html script imports). No `p2-gateway.js` file exists; no `#gateway/:gatewayId` route exists in the router.

**Fix**: Correct to match actual codebase with note that gateway detail is a sub-view within the devices page.

---

### M3. M09 §1.4 — `getRateForHour` ignores DB time periods

**Location**: `09_SHARED_LAYER_v5.24.md` §1.4

**Problem**: Recommends P3 handler use `getRateForHour(hour, schedule)` for time-of-use classification. But `getRateForHour` internally calls `classifyHour(hour)` which HARDCODES peak hours (18-21) and intermediate hours (17-18, 21-22). It completely ignores the `peak_start`, `peak_end`, `intermediate_start`, `intermediate_end` values from `tariff_schedules`.

**Fix**: Add limitation note to the recommendation.

---

### M4. M10 §3.6 — tariff_schedules column count wrong

**Location**: `10_DATABASE_SCHEMA_v5.24.md` §3.6

**Problem**: Says "17" columns but the real `02_schema.sql` has 18 columns (missing `created_at TIMESTAMPTZ DEFAULT now() NOT NULL` from the listing).

**Fix**: Add `created_at` row to the table and update count to 18.

---

### M5. M05/M00 — P3 hash routes require app.js router changes not documented

**Location**: `00_MASTER_ARCHITECTURE_v5.24.md` §2, `05_BFF_MODULE_v5.24.md` §6

**Problem**: Design specifies hash routes `#asset-energy/:assetId` and `#asset-health/:assetId` but doesn't mention that `app.js`'s router (`PAGES` array + `navigateTo` function) currently only supports simple hash matching. Parameterized routes won't match.

**Fix**: Add note that app.js router needs extension for parameterized hash routes.

---

## LOW Issues (not fixed)

### L1. M00 §8 — "P3 split from P2" wording is misleading

P3 pages are navigated FROM P2, not split from P2.

### L2. M09 — tarifa.ts export count says "7 exports"

Actual: 8 function/const exports + 5 type/interface exports = 13 total.

### L3. M05 §1 — Handler count discrepancy

"34 handler + 1 middleware = 35 files" is approximately correct but exact count depends on inclusion criteria for non-Lambda handlers.

---

## Verification Checklist

| Check | Result |
|-------|--------|
| `shared/tarifa.ts` exists | Confirmed (224 lines, 8 function exports) |
| `queryWithOrg` signature matches docs | `(sql, params, orgId: string or null)` |
| telemetry_history 25 columns match schema | All columns verified against `02_schema.sql` |
| tariff_schedules real columns match docs | Missing `created_at` (fixed in M10) |
| assets.capacity_kwh exists | `capacity_kwh NUMERIC(6,2) NOT NULL` |
| telemetry_history is partitioned | `PARTITION BY RANGE (recorded_at)` |
| REQ exclusions respected | No SSE/WS, no multi-asset, no PDF, no prediction, no custom charts |
| Savings formula matches REQ | hypothetical - actual, with Tarifa Branca 3-tier |
| feed_in_rate column exists | `feed_in_rate NUMERIC(8,4) NOT NULL` |
| wrapHandler actual signature | `(handler, method, path)` — 3 args |
| Frontend router supports param routes | Current app.js only does exact hash match |
