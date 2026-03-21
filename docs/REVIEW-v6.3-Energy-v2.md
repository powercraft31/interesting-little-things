# REVIEW-v6.3-Energy-v2

**Reviewer:** Second-pass post-architecture-correction review
**Date:** 2026-03-20
**Documents reviewed:** REQ-v6.3-Energy.md, DESIGN-v6.3-Energy.md (post-correction), PLAN-v6.3-Energy.md (post-correction)
**Prior review:** REVIEW-v6.3-Energy.md

---

## Status

**Ready with minor fixes**

---

## Executive Summary

The updated DESIGN and PLAN have successfully resolved the critical React/Vite architecture mismatch (prior C1) and all six medium-severity issues from the first review. The documentation set now correctly targets the real `frontend-v2` vanilla JS stack — referencing `p3-energy.js`, `data-source.js`, `DemoStore`, `Charts.createChart()`, and the page module object pattern used by v6.1 Fleet and v6.2 Devices. The gateway context inheritance mechanism is concretely defined via DemoStore with hash-param override. Self-consumption/sufficiency clamping, peak demand from `MAX(load_power)`, 12m-to-24h date clamping, and explicit p3-energy.js replacement are all addressed.

Three minor issues remain — one column name mismatch with the actual database schema, one missing detail about the existing `selectGateway()` public method contract, and one ambiguity in the 24h summary calculation location. None block implementation.

---

## Fixed Since Previous Review

| Prior Issue | Severity | Resolution in Updated Docs | Verified |
|-------------|----------|---------------------------|----------|
| **C1** React/Vite/TSX architecture | Critical | DESIGN ss1 tech boundary + ss7 rewritten as vanilla JS page module pattern. All file paths now reference `frontend-v2/js/*.js`. No React/hooks/Context/TSX anywhere. | Yes |
| **M1** 12m->24h future date | Medium | DESIGN ss8.1 adds explicit `min(lastDay, today)` clamp rule with JS code sample. PLAN T6 step 6c repeats the clamp. | Yes |
| **M2** Peak demand approximation | Medium | DESIGN ss4.3 + ss5.2 + ss5.3 all specify `MAX(load_power) FROM telemetry_history`. PLAN T2 step 5 matches. Separate SQL sub-query shown. | Yes |
| **M3** Self-cons/suff CLAMP(0,100) | Medium | DESIGN ss4.3 adds CLAMP formula, division-by-zero handling (pvGen=0->0, load=0->0), and `Math.max(0, Math.min(100, Math.round(...)))`. | Yes |
| **M4** p3-energy.js replacement | Medium | DESIGN ss1 replacement scope explicitly states v6.3 replaces `frontend-v2/js/p3-energy.js`. PLAN T6 is labeled full rewrite. | Yes |
| **M5** Gateway context mechanism | Medium | DESIGN ss2.2 defines DemoStore as primary mechanism with 3-level priority chain (hash param -> DemoStore -> empty state). p2-devices.js write-side documented. | Yes |
| **M6** 5-min granularity | Medium | DESIGN ss3.1 adds data granularity note acknowledging variable reporting frequency, NULL buckets for slow reporters, no interpolation. | Yes |
| **M7** Battery tooltip-only in stats | Medium | DESIGN ss4.1 adds explicit design note: "6 grouped bars reduces readability" rationale. | Yes |
| **L1** Refresh interval location | Low | DESIGN ss3.4 specifies JS constant `var REFRESH_INTERVAL_MS = 60000;` in p3-energy.js. | Yes |
| **L2** Unnecessary backward compat shim | Low | DESIGN ss5.1 confirms no `?format=v1` needed (dead code, never registered). | Yes |
| **L6** SQL timezone | Low | DESIGN ss5.2 adds note about `AT TIME ZONE 'America/Sao_Paulo'` being BRT-hardcoded for v6.3. | Yes |

**All 11 previously flagged issues are resolved.** The architecture correction is thorough — the vanilla JS page module pattern in DESIGN ss7 is structurally identical to how `p1-fleet.js` and `p2-devices.js` are implemented.

---

## Remaining Issues

### N1: Column name mismatch — `pv_kwh` vs `pv_energy_kwh` (Low)

DESIGN ss5.2 SQL references `m.pv_kwh` in the `asset_5min_metrics` query. The actual column name in the database (per `migration_v5.15.sql`) is `pv_energy_kwh`, not `pv_kwh`.

**Affected locations:**
- DESIGN ss5.2 SQL query line: `SUM(m.pv_kwh) AS pv_kwh`
- Should be: `SUM(m.pv_energy_kwh) AS pv_kwh`

The other column names (`load_kwh`, `grid_import_kwh`, `grid_export_kwh`, `bat_charge_kwh`, `bat_discharge_kwh`) match the actual schema.

**Risk:** Copy-paste from DESIGN into implementation would produce a SQL error. Low severity because this will surface immediately at dev time.

### N2: Existing `selectGateway()` public method contract (Low)

The current `p3-energy.js` exposes `EnergyPage.selectGateway(gatewayId, tab)` as a public method (line 241). PLAN R7 acknowledges this may be called externally (e.g., from Devices page jump links) and proposes retaining it. However, DESIGN ss7.1 module skeleton does not list a public `selectGateway()` method — only internal `_onWindowChange`, `_onDateChange`, etc.

**Risk:** If other modules call `EnergyPage.selectGateway()`, the v6.3 rewrite would break that contract silently. Low severity because PLAN R7 already flags this; it just needs to be reflected in the DESIGN ss7.1 skeleton.

**Fix:** Add `selectGateway: function(gatewayId) { ... }` to the DESIGN ss7.1 EnergyPage skeleton with semantics: writes to DemoStore + re-inits page.

### N3: 24h summary calculation — backend vs frontend (Informational)

DESIGN ss6 responsibility table says "24h directional totals -> backend returns in summary". PLAN T1 step 3 shows the summary computed in **application-layer TypeScript** by iterating over the `points` array (not SQL). Both approaches work, but they are different:

- SQL-computed: single pass during aggregation query, more efficient
- App-layer computed: iterates 288 points in JS after query, simpler code

This is not a contradiction — the PLAN is making a valid implementation choice. But if a reviewer expects backend = SQL, they might flag the app-layer loop as inconsistent. Worth a note in DESIGN ss6 clarifying "backend" means "BFF handler code" (TypeScript), not necessarily SQL.

---

## REQ / DESIGN / PLAN Consistency Check

| Dimension | REQ | DESIGN | PLAN | Status |
|-----------|-----|--------|------|--------|
| Gateway-first, no duplicate selector | Core Object Model | ss2.2, ss2.3 | T4, T6 step 6b | **Pass** |
| 24h behavior vs 7d/30d/12m statistics | Time Model | ss3 vs ss4 | T6 steps 6d vs 6e | **Pass** |
| 4 series only (PV/Load/Battery/Grid) | 24h Main chart series | ss3.1 series table | T6 step 6d | **Pass** |
| Zero-crossing sign semantics | Fixed sign semantics | ss3.1 sign semantics | T8 tests 3-4 | **Pass** |
| SoC only in 24h, aligned | SoC Auxiliary Chart | ss3.2 dual grid | T6 step 6d, T10 tests 27-28 | **Pass** |
| Directional summary outside chart | Directional Summary | ss3.3 | T6 step 6f | **Pass** |
| Date controls per window | Date Controls | ss2.3 table | T6 step 6b | **Pass** |
| 12m->24h clamp to today | Date Controls (implied) | ss8.1 clamp rule | T6 step 6c | **Pass** |
| Statistics 3-tier hierarchy | Statistics Layer | ss4.3 | T6 step 6e | **Pass** |
| Self-cons/suff CLAMP 0-100 | (implied by integer 0-100) | ss4.3 boundary handling | T2 step 5, T9 tests 13-16 | **Pass** |
| Peak demand = MAX(load_power) | Statistics Layer: Peak Demand | ss4.3, ss5.2, ss5.3 | T2 step 5, T9 test 17 | **Pass** |
| No economic section | Explicit exclusion | ss4.3, ss10 | T10 test 37 | **Pass** |
| Gateway context via DemoStore | Context inheritance rule | ss2.2 DemoStore mechanism | T4 | **Pass** |
| Replace p3-energy.js | Replacement scope | ss1 replacement scope, ss11 | T6 | **Pass** |
| Vanilla JS stack (no React) | Implementation Boundary | ss1 tech boundary | All frontend tasks | **Pass** |

**All 15 cross-document consistency checks pass.** No remaining contradictions between REQ, DESIGN, and PLAN.

---

## Architecture Alignment Verification

Verified each infrastructure integration claim in DESIGN ss7.2 against the actual codebase:

| Claim | Actual Codebase | Status |
|-------|----------------|--------|
| `app.js` routes `#energy` to `EnergyPage.init()` | Yes — `initPage('energy')` calls `EnergyPage.init()` (app.js ~line 170) | **Confirmed** |
| `Charts.createChart(id, option, {pageId})` exists | Yes — charts.js line 90-112, `pageId` option at line 99 | **Confirmed** |
| `Charts.disposePageCharts(pageId)` exists | Yes — charts.js lines 117-133 | **Confirmed** |
| `Charts.activatePageCharts(pageId)` exists | Yes — charts.js lines 198-226 | **Confirmed** |
| `DemoStore` is sessionStorage-backed | Yes — app.js lines 14-36, uses `sessionStorage` with `ds_` prefix | **Confirmed** |
| `index.html` has `<script src="js/p3-energy.js">` | Yes — line 137 | **Confirmed** |
| `data-source.js` has `energy` section with `withFallback` | Yes — lines 284-315 | **Confirmed** |
| `get-gateway-energy.ts` exists but route not registered | Yes — handler exists, no route in bff-stack.ts | **Confirmed** |
| `telemetry_history` has required columns | Yes — `pv_power`, `load_power`, `battery_power`, `grid_power_kw`, `battery_soc` all present | **Confirmed** |
| `asset_5min_metrics` has energy columns | Yes — `pv_energy_kwh` (not `pv_kwh`), `load_kwh`, `grid_import_kwh`, etc. | **Confirmed with N1 caveat** |
| No React/Vite/TSX in frontend-v2 | Confirmed — zero `.tsx`, `.ts`, `.jsx` files | **Confirmed** |
| p2-devices.js does NOT yet write to DemoStore | Confirmed — no DemoStore references in p2-devices.js | **Confirmed** (T4 needed) |

All infrastructure claims are accurate. The docs correctly describe the real codebase.

---

## Recommended Pre-Implementation Tweaks

| # | Priority | Item | Action |
|---|----------|------|--------|
| 1 | **Should** | N1 | Fix `pv_kwh` to `pv_energy_kwh` in DESIGN ss5.2 SQL query |
| 2 | **Nice** | N2 | Add `selectGateway()` public method to DESIGN ss7.1 EnergyPage skeleton |
| 3 | **Nice** | N3 | Add clarifying note to DESIGN ss6 that "backend" = BFF handler TypeScript, not necessarily SQL |

---

## Final Verdict

**Ready with minor fixes.**

The architecture correction is complete and thorough. All 11 issues from the first review are resolved. The documentation set now accurately targets the real `frontend-v2` vanilla JS stack with correct file paths, infrastructure APIs, and state management patterns. REQ / DESIGN / PLAN are internally consistent across all 15 checked dimensions. The three remaining items (one column name typo, one missing public method, one clarifying note) are low-risk and can be fixed inline during implementation without requiring another review cycle.

The docs are implementation-ready for v6.3.
