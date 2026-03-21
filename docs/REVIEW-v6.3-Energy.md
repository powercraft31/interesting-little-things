# REVIEW-v6.3-Energy

**Reviewer:** Second-pass design review
**Date:** 2026-03-20
**Documents reviewed:** REQ-v6.3-Energy.md, DESIGN-v6.3-Energy.md, PLAN-v6.3-Energy.md
**Reference docs:** REQ/DESIGN/PLAN-v6.1-Fleet, DESIGN/PLAN-v6.2-Devices

---

## Status

**Ready with fixes** — one critical architecture issue must be resolved before implementation begins; several medium-risk items should be addressed to prevent rework.

---

## Executive Summary

The REQ is excellent: precise product decisions, clear semantic splits (24h behavior vs long-window statistics), and explicit exclusions. The DESIGN faithfully translates REQ intent into component structure, data contracts, and interaction rules. The locked product decisions (gateway-first, zero-crossing semantics, SoC-only-in-24h, no economic section) are respected throughout.

However, the DESIGN and PLAN are built on a **React / Vite / shadcn / Tailwind** frontend architecture that **does not exist in the codebase**. The actual `frontend-v2/` is vanilla JavaScript with no build system, no framework, no `.tsx` support — identical to how v6.1 Fleet (`p1-fleet.js`) and v6.2 Devices (`p2-devices.js`) were implemented. This mismatch invalidates the entire frontend component tree, all React hooks, the Gateway context sharing mechanism, and the file path structure in the PLAN. Everything else is solid.

---

## What Is Solid

**1. REQ product clarity.** The 24h-behavior vs 7d/30d/12m-statistics semantic split is sharp and well-reasoned. The "behavior layer answers how power flowed; statistics layer answers how much energy moved" framing gives implementers a clear decision rule for every UI choice.

**2. Zero-crossing semantics.** Battery (positive=discharge, negative=charge) and Grid (positive=import, negative=export) sign conventions are industry-standard, explicitly documented, and consistently carried through REQ -> DESIGN -> PLAN with tooltip direction labels, chart markLine at Y=0, and the explicit prohibition against splitting into 6 series.

**3. SoC scope rule and alignment requirement.** SoC-only-in-24h is well-justified. The ECharts dual-grid implementation strategy (DESIGN ss3.2) with shared `left`/`right` padding and `axisPointer.link` is the correct technical approach and achieves pixel-level alignment.

**4. Data contracts.** Both API response types (`GatewayEnergy24hResponse`, `GatewayEnergyStatsResponse`) are well-structured with named fields, clear units, and separation of time-series points from summary/totals. The migration from 96-point positional arrays to 288-point named-field objects is a clean improvement.

**5. Directional summary separation.** Main chart = behavior semantics (trend), direction summary = split totals (numbers). The four-card layout below the chart is clean and avoids chart overload.

**6. Statistics layer design.** Grouped bar chart is the right choice for discrete category axes (daily/monthly). The three-tier metrics hierarchy (Primary/Secondary/Supporting) maps directly from REQ with no drift.

**7. Explicit exclusions are consistent.** No economic section, no asset-level drilldown, no custom time ranges, no WebSocket, no export, no multi-gateway comparison, no long-window SoC — all consistently excluded across REQ, DESIGN, and PLAN.

**8. Edge cases.** DESIGN ss9 covers the important scenarios (partial today data, no-battery SoC, multi-asset gateway aggregation, data gaps, off-grid). The "no linear interpolation for gaps" decision is correct.

**9. Backend SQL.** The aggregation queries in DESIGN ss5.2 correctly use `GREATEST(value, 0)` / `GREATEST(-value, 0)` for directional splitting and `* 5.0 / 60` for power-to-energy conversion.

**10. Window switching rules.** DESIGN ss8.1 comprehensively covers all 9 transition combinations with sensible date anchor preservation.

---

## Critical Issues

### C1: Frontend architecture does not exist

**Severity:** Blocks all frontend tasks (T4-T12, ~80% of PLAN)

The DESIGN ss7 specifies "React / Vite / shadcn / Tailwind / ECharts" and the PLAN creates:
- `frontend-v2/src/contexts/GatewayContext.tsx` (React context)
- `frontend-v2/src/hooks/useECharts.ts` (React hook)
- `frontend-v2/src/hooks/useEnergyData.ts` (React hook)
- `frontend-v2/src/components/energy/*.tsx` (React components)
- `frontend-v2/src/pages/EnergyPage.tsx` (React page)
- `frontend-v2/src/services/data-source.ts` (TypeScript module)

**Reality:** `frontend-v2/` is vanilla JavaScript with:
- No React, no Vite, no build system — scripts loaded via `<script>` tags in `index.html`
- No `.tsx` / `.ts` support — all files are `.js` in `frontend-v2/js/`
- No npm/node_modules — CDN-loaded dependencies (ECharts 5.x)
- Page modules are plain objects: `var Energy = { _state: {}, init: async function() {...} }`
- State management is `window.DemoStore` (sessionStorage-backed), not React Context
- Charting uses `Charts.createChart(containerId, option)` singleton pattern, not hooks
- Routing is hash-based (`#energy`), managed by `app.js`

Both v6.1 Fleet and v6.2 Devices were implemented in this vanilla JS architecture. The PLAN does not acknowledge any framework migration or explain why v6.3 diverges.

**Impact:**
- The entire component tree (DESIGN ss7.1) is unimplementable as specified
- `GatewayContext.tsx` (T4) cannot exist — gateway sharing must use `DemoStore` or URL params, consistent with v6.2's approach
- `useECharts` hook (T5) cannot exist — must use existing `Charts.createChart()` / `Charts.register()` API from `charts.js`
- `useEnergyData` hook (T6) cannot exist — must be a plain async function or module pattern
- All `.tsx` file paths in the PLAN file manifest are wrong
- The PLAN timeline (6 days) does not budget for a framework migration, nor should it — migrating to React mid-feature is scope creep

**Required fix:** Rewrite DESIGN ss7 and PLAN T4-T12 to target the existing vanilla JS architecture:
- Energy page module: `frontend-v2/js/p3-energy.js` (replace existing)
- Data source extension: `frontend-v2/js/data-source.js` (add energy methods)
- ECharts usage: existing `Charts.createChart()` pattern
- Gateway context: `DemoStore.get('selectedGatewayId')` or URL query parameter, same mechanism v6.2 Devices uses
- State: page-local `_state` object pattern
- No new directories under `frontend-v2/src/`

---

## Medium Risks

### M1: 12m -> 24h window switch can produce future dates

DESIGN ss8.1 states: "12m -> 24h: use end month's last day as 24h date". If the user is viewing 12m ending in the current month (March 2026), switching to 24h would set the date to March 31, which is in the future. DESIGN ss8.2 says the max date is today.

**Fix:** Add explicit clamping: `min(lastDayOfEndMonth, today)`. Document this in the switching rules table.

### M2: Peak demand approximation from asset_5min_metrics

PLAN T2 step 5 suggests: `MAX(load_kwh * 12) from asset_5min_metrics` as an alternative to `MAX(load_power) from telemetry_history`. This converts 5-minute energy to average power over the interval, which **understates true peak power**. A 5-minute bucket with 2.5 kWh average could contain a 40 kW spike that gets flattened to 30 kW.

**Fix:** Always use `MAX(load_power) FROM telemetry_history` for peak demand, even when other stats come from `asset_5min_metrics`. Document this exception in the fallback strategy.

### M3: Self-consumption / self-sufficiency formulas need clamping

DESIGN ss4.3:
- Self-consumption = `(PV Generation - Grid Export) / PV Generation * 100`
- Self-sufficiency = `(Load - Grid Import) / Load * 100`

Both can produce values outside 0-100 in edge cases (e.g., battery-to-grid export exceeding PV generation). The response type says "integer 0-100" but the computation does not enforce this.

**Fix:** Add `CLAMP(0, 100)` to both formulas in DESIGN and PLAN. Handle division-by-zero (already covered for pvGen=0 and load=0, but confirm the clamping is applied after division).

### M4: Existing p3-energy.js not mentioned

The current codebase has `frontend-v2/js/p3-energy.js` (the existing Energy page). Neither DESIGN nor PLAN mentions whether v6.3 replaces it, extends it, or coexists with it. The PLAN creates a new `EnergyPage.tsx` (which does not work per C1) but says nothing about the existing file.

**Fix:** PLAN should explicitly state: "v6.3 replaces `frontend-v2/js/p3-energy.js` with the v6.3 implementation" and confirm that the hash route `#energy` in `app.js` continues to point to the Energy module.

### M5: Gateway context inheritance mechanism undefined for current architecture

REQ requires gateway context to be inherited from the Devices page left sidebar. DESIGN proposes React Context (impossible per C1). v6.2 Devices stores `selectedGatewayId` in its page `_state` — but this is lost on page navigation.

The PLAN needs a concrete cross-page state mechanism. Options available in the current architecture:
1. `DemoStore` (sessionStorage) — already used for cross-page state
2. URL query parameter `?gwId=xxx`
3. `localStorage`

PLAN R5 acknowledges this risk and proposes URL params or sessionStorage as fallbacks, but treats them as degradation paths rather than the primary design. Given C1, one of these **is** the primary design.

**Fix:** Choose DemoStore (consistent with v6.2 pattern) as the primary mechanism. Document: "When v6.2 Devices sidebar selects a gateway, it writes to `DemoStore.set('selectedGatewayId', id)`. Energy page reads from `DemoStore.get('selectedGatewayId')` on init."

### M6: 5-minute granularity assumption needs backend verification

DESIGN ss5.1 assumes 5-minute data points (288/day). The existing handler uses 15-minute aggregation (96 points). The underlying `telemetry_history` table's actual data interval is not documented — if telemetry arrives at irregular intervals (e.g., every 1-2 minutes), the 5-minute aggregation SQL will work but may produce sparse buckets for gateways with lower reporting frequency.

**Fix:** Verify the actual telemetry reporting interval in the IoT pipeline documentation or `telemetry-handler.ts`. If reporting is ~5 minutes, aggregation is nearly 1:1 and works well. If reporting is ~1 minute, 5-minute aggregation is fine but produces averaged values. Document the expected source data frequency in DESIGN ss5.1.

### M7: Statistics chart does not show Battery series but tooltip does

DESIGN ss4.1 defines 4 bar chart series (PV, Load, Grid Import, Grid Export) but the tooltip description says "tooltip shows all 6 energy metrics" (6 items including Battery Charge/Discharge). This is not wrong — Battery is secondary per REQ — but the visual inconsistency of showing 4 bars + 6 tooltip values could confuse users who expect to see bars for all tooltip items.

**Fix (low priority):** Add a brief design note in DESIGN ss4.1 explaining why Battery is tooltip-only in the chart: "Battery Charge/Discharge appear in tooltip but not as bar series because they are secondary metrics (REQ hierarchy). Showing 6 grouped bars per bucket would reduce readability."

---

## Low-Level Polish Suggestions

### L1: DESIGN ss3.4 refresh interval configuration

The 60-second auto-refresh interval is reasonable, but the env var name `ENERGY_REFRESH_INTERVAL_MS` suggests backend configuration. In the vanilla JS architecture, this would be a JS constant in `config.js` or `p3-energy.js`, not an environment variable. Clarify where this config lives.

### L2: PLAN T1 backward compatibility shim is unnecessary

PLAN T1 step 5 proposes `?format=v1` query parameter for backward compatibility. Since the existing handler's route is not registered (dead code, only used in mock mode), this compatibility shim is unnecessary. Remove it to reduce scope.

### L3: PLAN T9 DirectionalSummary reuse claim

PLAN T9 says DirectionalSummary is shared between "24h and statistics layer". However, in 24h mode the summary shows directional totals from `summary` (4 items), while in statistics mode the totals come from `totals` (which includes the same 4 items plus more). The component can share UI structure but the data source differs. This is fine but should be explicit.

### L4: 30d X-axis label density

DESIGN ss4.1 specifies 30d mode shows one bar per day with sparse labeling every 5 days. With 4 grouped bars per day x 30 days = 120 bars, the chart will be visually dense. Consider whether the implementation should use a wider chart container or allow horizontal scrolling. Worth a design note.

### L5: PLAN test file extensions

PLAN T15 creates `frontend-v2/test/e2e/energy-page.test.js` — this is consistent with the vanilla JS architecture. The backend test files use `.test.ts` which is correct for the TypeScript backend. No conflict, but ensure E2E test paths are updated if C1 changes the page file location.

### L6: DESIGN ss5.2 SQL timezone

The SQL uses `AT TIME ZONE 'America/Sao_Paulo'` for BRT aggregation. This is correct for the business context but should be parameterizable if the platform expands to other timezones. Low priority for v6.3, but worth a comment in the SQL.

---

## Recommended Fixes Before Implementation

| Priority | Item | Action |
|----------|------|--------|
| **Must** | C1 | Rewrite DESIGN ss7 and PLAN T4-T12 for vanilla JS architecture. Update all file paths from `frontend-v2/src/*.tsx` to `frontend-v2/js/*.js`. Replace React hooks with page module patterns. Replace GatewayContext with DemoStore. |
| **Must** | M5 | Define the concrete gateway context sharing mechanism (DemoStore) as primary design, not fallback. |
| **Should** | M1 | Add date clamping to 12m->24h window switch rule. |
| **Should** | M2 | Lock peak demand to `MAX(load_power)` from telemetry_history, not the energy approximation. |
| **Should** | M3 | Add CLAMP(0, 100) to self-consumption and self-sufficiency formulas. |
| **Should** | M4 | Explicitly state that p3-energy.js is replaced. |
| **Nice** | M6 | Document expected telemetry source data frequency. |
| **Nice** | M7 | Add design note explaining Battery tooltip-only in stats chart. |
| **Nice** | L1-L6 | Minor polish items. |

---

## Locked Product Decisions: Compliance Check

| Decision | REQ | DESIGN | PLAN | Status |
|----------|-----|--------|------|--------|
| Gateway-first | ss Core Object Model | ss2.2 | T4 context | Pass |
| 24h behavior vs 7d/30d/12m statistics | ss Time Model | ss3 vs ss4 | T8 vs T10 | Pass |
| Battery/Grid zero-crossing semantics | ss Fixed sign semantics | ss3.1 series table | T8 step 8a | Pass |
| SoC only in 24h, visually aligned | ss SoC Auxiliary Chart | ss3.2 dual grid | T8 step 8b | Pass |
| Gateway context from Devices sidebar | ss Context inheritance rule | ss2.2 | T4 | Pass (intent); Fail (mechanism -- React Context does not exist) |
| No economic light section | ss Statistics Layer: Explicit exclusion | ss4.3 last line | Not in any task | Pass |
| No duplicate Gateway selector in top area | ss Context inheritance rule | ss2.3 top controls | T7 | Pass |

---

## Final Verdict

**Ready with fixes.**

The product design (REQ) and technical design (DESIGN) are strong. The 24h/statistics semantic split, zero-crossing model, SoC alignment strategy, and data contracts are all well-thought-out and internally consistent. The locked product decisions are respected throughout.

The single blocking issue is the React/Vite architecture assumption in DESIGN ss7 and PLAN T4-T12. The actual codebase is vanilla JS, and both prior versions (v6.1 Fleet, v6.2 Devices) were implemented in this architecture. Rewriting the frontend section to target the real stack is straightforward — the component decomposition logic transfers directly to vanilla JS module functions — but must be done before implementation begins to avoid building on wrong foundations.

After fixing C1 and M5 (gateway context mechanism), the docs are implementation-ready. The remaining medium and low items can be addressed during implementation without requiring another review cycle.
