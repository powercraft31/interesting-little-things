# REVIEW-v6.4-P4-HEMS-Control-Workbench

**Reviewer:** Claude Code (second review)
**Date:** 2026-03-21
**Documents reviewed:** REQ / DESIGN / PLAN for v6.4 P4

---

## Executive Summary

**Conditional Pass** — The DESIGN and PLAN are well-structured, faithfully trace to the REQ baseline, and demonstrate strong architectural continuity with v6.0. The two-layer eligibility/selection model is correctly separated. The API design is sound and properly motivated. However, there are **3 critical issues** and **6 warnings** that should be addressed before implementation begins.

Critical issues:
1. Query 3 (active commands) may return multiple rows per gateway, but the `Map` constructor in the merge logic silently drops duplicates — a gateway with commands in two batches will only show one `activeCommandBatchId`.
2. The `_selectAllEligible()` function only selects `eligible` gateways but REQ says `已一致` (same-schedule) gateways are also selectable — "select all eligible" should arguably include `same` gateways too, or the button label must be precise.
3. PLAN retry logic (T5, step 30) defines retryable as `status === 'skipped' with reason !== 'active_command'`, but DESIGN §9.4 doesn't define retryable criteria at all — this PLAN-level decision has no DESIGN backing and may conflict with REQ's "follows design-defined retry policy" language.

---

## Part A: DESIGN vs REQ Alignment

### A1: Functional Coverage Matrix

| REQ Requirement | REQ Section | DESIGN Coverage | Status |
|-----------------|-------------|-----------------|--------|
| Page 4 = control workbench, not dashboard | Product Positioning | §2 core principles, §1 matrix header | **Covered** |
| Four-page chain positioning (Act layer) | Product Positioning | §2 architecture overview | **Covered** |
| Anti-regression rule (no KPIs, charts, device drill-down) | Anti-regression rule | §2 core principles, implied throughout | **Covered** (implicit, no explicit anti-regression section in DESIGN) |
| Four-step workflow (choose → impact → target → dispatch) | Workflow Model | §3.4 step flow, §4.1–4.5 | **Covered** |
| Three strategy modes + parameters | Strategy Modes | §4.1 strategy selector | **Covered** |
| Shared SoC bounds (5–50%, 70–100%) | Strategy Modes | §4.1 parameter strip: SoC 下限 5–50, SoC 上限 70–100 | **Covered** |
| Peak shaving gridImportLimitKw | Strategy Modes | §4.1 grid import limit slider 10–80 kW | **Covered** |
| Arbitrage 24h editor with brush painting | Strategy Modes | §8 entire section | **Covered** |
| Arbitrage templates (Enel SP, night, double, clear) | Strategy Modes | §8.2 template presets | **Covered** |
| Arbitrage 24h completeness validation | Strategy Modes | §8.3 coverage validation | **Covered** |
| Charge/discharge power NOT on P4 | Strategy Modes | Not mentioned in DESIGN (correct exclusion) | **Covered** |
| 4 eligibility states (eligible/same/blocked/offline) | Impact Model | §3.3 `_classify()` function | **Covered** |
| 2 selection states (selected/will-change) | Impact Model | §3.3 `_impactCounters()` | **Covered** |
| Impact counter strip (6 cells) | Impact Model | §4.2 impact counter strip | **Covered** |
| Blocked gateway: visible, non-selectable, conflict reason | Blocked Requirements | §4.3 blocked gateway display | **Covered** |
| Blocked row: blocking batch ID + recommended action | Blocked Requirements | §4.3 popover with batch ID + reason detail | **Partially covered** — see Warning W1 |
| Offline gateway: visible, non-selectable, last-known state | Offline Requirements | §4.3 row styling offline | **Covered** |
| Targeting table: compact grid, required columns | Main UI Structure | §4.3 targeting table | **Covered** |
| Schedule bar legend | Main UI Structure | §7.4 legend | **Covered** |
| Current vs target schedule bars per row | Main UI Structure | §4.3 columns 8+9, §7 schedule bar | **Covered** |
| Filters (integrator, site, status, mode, bulk actions) | Main UI Structure | §4.3 filter controls | **Covered** |
| Review panel dormant state | Main UI Structure | §4.4 dormant state | **Covered** |
| Review panel active: per-gateway cards, dispatch summary | Main UI Structure | §4.4 active state | **Covered** |
| Two-step dispatch (open confirmation → final confirm) | Safety Rules | §9.1 two-step flow | **Covered** |
| Confirmation modal content (strategy, schedule, counts, blocked) | Safety Rules | §9.2 modal data summary, §4.5 modal content | **Covered** |
| Final dispatch button: danger styling, irreversibility | Safety Rules | §9.3 button styling | **Covered** |
| Cancel button easily accessible | Safety Rules | §9.3 cancel button | **Covered** |
| Blocked items in confirmation: warning + list + skip clarification | Safety Rules | §4.5 warning banner + blocked list | **Covered** |
| Post-dispatch: per-gateway results (success/failed/skipped) | Post-dispatch | §9.4, §5.4 dispatch flow | **Covered** |
| Retry limited to retryable failures | Post-dispatch | §9.4 mentions retry button | **Partially covered** — see Critical C3 |
| Batch history records operation | Post-dispatch | §4.6 batch history, §5.5 | **Covered** |
| No KPI cards | Explicit Exclusions | Not present in DESIGN (correct) | **Covered** |
| No economic analysis | Explicit Exclusions | Not present in DESIGN (correct) | **Covered** |
| No time-series charts | Explicit Exclusions | Not present in DESIGN (correct) | **Covered** |

**Gaps identified:**

1. REQ §Blocked Requirements says conflict reasons must include "a recommended action (e.g., 'wait for batch-002 to complete')". DESIGN §4.3 mentions "popover with: block reason detail, blocking batch ID, recommended action" — the popover content list includes it, but there's no specification of how the recommended action is determined or what the possible values are. This is a design gap (Warning W1).

2. REQ §Main UI Structure says header should include "role badge". DESIGN §4 doesn't explicitly mention a role badge in the header. The v4 mock may have it, but DESIGN should document it. Minor gap (Warning W2).

3. REQ §Data Requirements lists "Last sync time" as needed for "Freshness indicator". The DESIGN API response (§6.3) includes `lastSeenAt` but the targeting table columns (§4.3) don't include a last-sync column. The data is fetched but not displayed. This may be intentional (not enough column space) but should be noted (Suggestion S1).

### A2: Impact Model

**Assessment: Correctly separated.**

DESIGN §3.3 explicitly implements the two-layer model as required by REQ:

- **Layer 1 (Eligibility):** `_classify(gw)` returns one of `'eligible' | 'same' | 'conflict' | 'offline'` — maps exactly to REQ's 可下發/已一致/阻塞/離線.
- **Layer 2 (Selection):** `_selected` object + `_impactCounters()` computing `selected` and `willChange` — maps exactly to REQ's 已選擇/將變更.

The two layers are independent dimensions as REQ requires. A gateway can be `eligible` and `selected` simultaneously. `willChange` is correctly defined as the subset of selected gateways classified as `eligible` (not `same`).

**One nuance worth confirming:** DESIGN §3.3 `_impactCounters()` counts `willChange` only when `cls === 'eligible'`. This means a `same` gateway that is selected is counted as `selected` but NOT as `willChange`. This is semantically correct per REQ: "Selected gateway whose current strategy/schedule differs from the target and would actually change on dispatch" — a `same` gateway won't change, so it shouldn't be in `willChange`. **Correct.**

### A3: Counter Strip Boundary

**Assessment: Correctly bounded.**

DESIGN §4.2 describes the impact counter strip as:
- 6 cells: 可下發/已一致/阻塞/離線 (eligibility) | 已選擇/將變更 (selection)
- Uses "subtle separator or grouping" between the two groups
- Described purely in terms of its function: "counters recompute on [strategy/selection change]"

At no point does DESIGN refer to the counter strip as a "KPI strip", "dashboard indicator", or "fleet summary". It is positioned within the Step 2 section of the four-step workflow. **This respects the REQ boundary.**

### A4: Retry Scope

**Assessment: Appropriately scoped with one gap.**

DESIGN §9.4 says: "If retryable failures exist, enable '只重試失敗' button." This is within REQ's delegation scope — REQ says "retry is bounded to retryable failures only and follows DESIGN-defined retry policy."

**However**, DESIGN does not actually define which failure types are retryable. It mentions the retry button existence but defers the retryable criteria. The PLAN (T5, step 30) fills this gap with `status === 'skipped' with reason !== 'active_command'`, but this creates an inversion — PLAN defines what DESIGN should have defined. See Critical C3.

The retry mechanism itself is simple (re-send POST with only failed gateway IDs) and does not constitute over-engineering. **Scope is appropriate; definition is incomplete.**

### A5: No KPI Cards

**Assessment: Clean.**

DESIGN contains zero KPI card definitions, zero chart library references, zero dashboard-style widget layouts. The only numeric indicators are the 6 impact counter cells, which serve the dispatch workflow directly. **No violation.**

### A6: API Design

**Assessment: Sound, with one data integrity concern.**

**Separation from GET /api/gateways:**
DESIGN §6.2 explicitly calls out that `GET /api/gateways` is NOT used by P4. §6.3 justifies the dedicated endpoint:
- P4 needs gateway + schedule + command status JOINed
- Adding these to `GET /api/gateways` would bloat the general endpoint
- Dedicated endpoint enables batch query optimization

This is a sound architectural decision. **Approved.**

**3-batch-query pattern:**
DESIGN §6.3 uses the same pattern proven in v6.0 DESIGN §2: three targeted queries + application-level merge. The SQL is well-formed:
- Q1: gateway list with device count (LEFT JOINs for org and assets)
- Q2: DISTINCT ON for latest successful schedule
- Q3: active command detection

**Concern (Critical C1):** Query 3 returns `DISTINCT gateway_id, batch_id` but a gateway could have multiple active commands from different batches (e.g., batch-002 pending + batch-003 dispatched). The `DISTINCT` doesn't deduplicate to one row per gateway — it deduplicates the (gateway_id, batch_id) pair. The application merge uses `new Map(q3Rows.map(r => [r.gateway_id, r.batch_id]))`, which will silently overwrite the first batch_id with the last one encountered. This means:
- `hasActiveCommand` will be correct (any row means true)
- `activeCommandBatchId` may show the wrong batch ID

Fix: Either use `SELECT DISTINCT ON (gateway_id) gateway_id, batch_id ... ORDER BY gateway_id, created_at DESC` to get the latest blocking batch, or aggregate all batch IDs.

**Request/response schemas:** Well-defined in §6.3 with TypeScript interface. All fields from REQ's "Data and State Requirements" table are accounted for:
- Gateway ID ✓
- Online/offline status ✓
- Current strategy mode ✓ (via `currentMode`)
- Current 24h schedule ✓ (via `currentSlots`)
- Active command presence ✓ (via `hasActiveCommand`)
- Device count ✓
- Site/home name ✓ (via `homeAlias` + `name`)
- Last sync time ✓ (via `lastSeenAt`)
- Integrator/organization ✓ (via `integrator`)

### A7: Client-side Eligibility

**Assessment: Reasonable trade-off, acceptable for current scale.**

DESIGN §2 core principles state: "Client-side eligibility: eligibility 計算（可下發/已一致/阻塞/離線）在前端基於 targeting API 返回的數據完成."

**Trade-off analysis:**

| Factor | Client-side (DESIGN choice) | Server-side (alternative) |
|--------|---------------------------|--------------------------|
| Reactivity | Instant — no API round-trip on strategy change | Requires API call per change |
| Consistency | Snapshot-based — stale if gateway status changes after load | Always fresh |
| Complexity | Simple — one pure function per gateway | Requires strategy-aware endpoint |
| Scale ceiling | Fine for <200 gateways per org | Would scale to thousands |
| Correctness risk | Low — eligibility is based on mode comparison, not complex logic | Slightly lower risk |

**Verdict:** For fleets <200 gateways (stated in DESIGN §6.3), client-side computation is the right call. The classification logic is deterministic and simple: compare modes, check online status, check active commands. There's no consistency risk because:
1. The gateway data is fetched at page load
2. Eligibility only needs to be correct at dispatch time — the confirmation modal re-summarizes the state
3. If a gateway goes offline between page load and dispatch, the backend's batch-dispatch handler (v6.0) already handles this server-side

**One consideration:** There's no refresh/polling mechanism in DESIGN. If an operator keeps the page open for 30+ minutes, the gateway status data goes stale. REQ delegates this ("Polling/WebSocket strategy for post-dispatch result updates" is in Open Items), but DESIGN should at minimum mention that a manual refresh or periodic auto-refresh would be beneficial in a future iteration. See Suggestion S2.

---

## Part B: PLAN vs DESIGN Alignment

### B1: Phase Coverage

| DESIGN Component | DESIGN Section | PLAN Task | Status |
|-----------------|----------------|-----------|--------|
| BFF get-hems-targeting handler | §6.3 | T1 | **Covered** |
| Route registration | §6.3 | T2 | **Covered** |
| data-source.js gatewayTargeting() | §5.1 | T3 | **Covered** |
| HEMSPage module structure + state | §3.1 | T4 (4a) | **Covered** |
| Header + instruction line | §3.4 | T4 (4b) | **Covered** |
| Strategy selector (Step 1) | §4.1, §8 | T4 (4c) | **Covered** |
| Impact counter strip (Step 2) | §4.2 | T4 (4d) | **Covered** |
| Targeting table (Step 3) | §4.3 | T4 (4e) | **Covered** |
| Review panel dormant (Step 4) | §4.4 | T4 (4f) | **Covered** |
| Review panel active | §4.4 | T5 (5a) | **Covered** |
| Dispatch summary box | §4.4 | T5 (5b) | **Covered** |
| Confirmation modal | §4.5, §9 | T5 (5c, 5d) | **Covered** |
| Dispatch execution | §5.4 | T5 (5e) | **Covered** |
| Post-dispatch results | §9.4 | T5 (5f) | **Covered** |
| Retry mechanism | §9.4 | T5 (5g) | **Covered** (but see C3) |
| Batch history UI | §4.6 | T6 | **Covered** |
| Edge cases | §10.1 R3, R5 | T7 | **Covered** |
| Touch support | §10.1 R4 | T8 | **Covered** |
| CSS architecture | §11 | T4, T8 | **Covered** |
| Responsive breakpoints | §11.2 | T8 | **Covered** |
| Security (RLS, RBAC, XSS) | §12 | T1 (auth middleware), T7 (esc()) | **Covered** |
| Backend tests | Implied | T9 | **Covered** |
| Frontend E2E tests | Implied | T10 | **Covered** |

**Assessment: Full coverage.** Every DESIGN component maps to at least one PLAN task. No DESIGN features are orphaned.

### B2: Phase Independence

| Phase | Can test independently? | Assessment |
|-------|------------------------|------------|
| Phase 1 | Yes — mock data validates eligibility, impact counters, targeting table | **Good** — T3 mock fallback enables standalone testing |
| Phase 2 | Yes — can use v6.0 batch-dispatch API or mock backend | **Good** — PLAN explicitly notes "可用 mock backend 或真實 v6.0 API 測試" |
| Phase 3 | Yes — polish on top of working Phase 2 | **Good** — T6/T7/T8 are independent and parallel |
| Phase 4 | Yes — testing requires Phase 2 complete but is independently runnable | **Good** — T9 and T10 are parallel |

**Assessment: Strong phase independence.** Each phase has a clear acceptance gate.

### B3: Phase Ordering

```
Phase 1 (API + skeleton) → Phase 2 (dispatch) → Phase 3 (polish) → Phase 4 (testing)
```

**Assessment: Correct ordering.**

- API (T1) before frontend (T4) that consumes it — correct, though T3 mock enables parallel start
- Skeleton before dispatch — correct, dispatch builds on the targeting table
- Polish after core features — correct, avoids premature optimization
- Testing last — acceptable for this scope, though TDD purists might prefer tests alongside each phase

**One concern (Warning W3):** PLAN places ALL testing in Phase 4 (Day 6-7). This means Phases 1-3 are tested only by manual verification. Given the CLAUDE.md TDD requirements, this is a deviation from the mandated "write tests first" approach. However, the manual acceptance criteria in each phase are thorough, and adding E2E tests to Phase 1 would create a dependency on test infrastructure that may not exist. **Pragmatic but worth noting.**

### B4: Acceptance Criteria

| Phase | Has acceptance criteria? | Quality |
|-------|------------------------|---------|
| Phase 1 (T4) | Yes — 10 checkboxes | **Strong** — covers strategy switching, impact counters, table rendering, blocked/offline UX, filters, arb editor |
| Phase 2 (T5) | Yes — 10 checkboxes | **Strong** — covers review panel, modal, dispatch, results, two-step enforcement |
| Phase 3 (T6, T7, T8) | No explicit checkboxes | **Weak** — T6/T7/T8 have "detailed steps" but no verification checkboxes |
| Phase 4 (T9, T10) | Yes — 30 test cases listed | **Strong** — detailed test case tables |

**Assessment:** Phase 3 tasks lack explicit acceptance criteria. The detailed steps describe what to build but not what "done" looks like. See Warning W4.

### B5: Risk Items

PLAN §4 identifies 6 risks. Cross-referencing with DESIGN §10.1:

| DESIGN Risk | PLAN Risk | Alignment |
|-------------|-----------|-----------|
| R1: p4-hems.js rewrite breaks existing | R1: same | **Aligned** |
| R2: Targeting API performance | R2: data format consistency (different focus) | **Different** — DESIGN focuses on performance, PLAN on format. Both valid. |
| R3: Full-page re-render performance | R4: large gateway re-render | **Aligned** |
| R4: Mobile touch events | R5: Android touch | **Aligned** |
| R5: Schedule payload format inconsistency | R3: same | **Aligned** |
| R6: DemoStore dependency | Not in PLAN | **Acceptable** — PLAN correctly ignores this (P4 doesn't use DemoStore) |
| — | R6: v6.0 batch-dispatch API contract change | PLAN adds a risk not in DESIGN | **Acceptable addition** |

**Missing risk in both documents:** Neither DESIGN nor PLAN addresses what happens if the operator's session token expires mid-workflow (e.g., spends 20 minutes configuring strategy, then dispatch POST returns 401). The existing auth middleware presumably handles this, but it's not documented. See Suggestion S3.

---

## Part C: Internal Consistency

### C1: Terminology Consistency

| Term | REQ | DESIGN | PLAN | Consistent? |
|------|-----|--------|------|-------------|
| Eligibility states | 可下發/已一致/阻塞/離線 | eligible/same/conflict/offline | eligible/same/conflict/offline | **Yes** |
| Selection states | 已選擇/將變更 | selected/willChange | selected/willChange | **Yes** |
| Strategy modes | 自發自用/削峰/峰谷套利 | self_consumption/peak_shaving/peak_valley_arbitrage | same keys | **Yes** |
| Impact counter strip | "impact counter strip" | "impact counter strip" §4.2 | "impact counters" in T4 step 4d | **Yes** |
| Targeting table | "gateway targeting table" | "targeting table" §4.3 | "targeting table" | **Yes** |
| Review panel | "review panel" | "review panel" §4.4 | "review panel" | **Yes** |
| Confirmation modal | "confirmation modal" | "confirmation modal" §4.5, §9 | "confirm modal" T5 5d | **Yes** (minor abbreviation, acceptable) |
| Two-step dispatch | "two-step flow" | "two-step dispatch flow" §9.1 | "two-step flow" T5 acceptance | **Yes** |
| Blocked | "Blocked / 阻塞" | "conflict" in code, "blocked" in prose | "conflict" in code | **Minor inconsistency** — see Warning W5 |
| Batch history | "batch history" | "batch history" §4.6 | "batch history" | **Yes** |

**Warning W5:** REQ uses "Blocked/阻塞" consistently for the eligibility state. DESIGN maps this to `'conflict'` in code (`_classify()` returns `'conflict'`, CSS class `.row-conflict`, badge `.sb-conflict`) but uses "blocked" in prose descriptions. PLAN follows DESIGN's code convention. This creates a terminology split: prose says "blocked", code says "conflict". While functional, it can cause confusion during code review and debugging. Recommendation: align on one term. Since REQ uses "blocked", consider `'blocked'` as the internal key too.

### C2: Data Flow Consistency

DESIGN §5 data flows match PLAN implementation:

- **Page load:** DESIGN §5.1 → `Promise.all([gatewayTargeting(), batchHistory()])` → PLAN T4 step 4a init: identical.
- **Strategy change:** DESIGN §5.2 → client-side recompute → `_render()` → PLAN T4 step 4d: consistent.
- **Selection change:** DESIGN §5.3 → update `_selected` → recompute → `_render()` → PLAN T4 step 4e: consistent.
- **Dispatch:** DESIGN §5.4 → modal → POST → results → PLAN T5 steps 5c-5f: consistent.

**No data flow inconsistencies found.**

### C3: Component Naming

| Component | DESIGN Name | PLAN Name | Match? |
|-----------|-------------|-----------|--------|
| Main module | `HEMSPage` | `HEMSPage` | **Yes** |
| Classify function | `_classify(gw)` | `_classify(gw)` | **Yes** |
| Impact counters | `_impactCounters()` | `_impactCounters()` | **Yes** |
| Visible gateways | `_visibleGateways()` | `_visibleGateways()` | **Yes** |
| Target schedule | `_targetSchedule()` | `_targetSchedule()` | **Yes** |
| Mini bar builder | `_buildMiniBar(slots)` | `_buildMiniBar(slots)` | **Yes** |
| Confirm modal builder | `_buildConfirmModal()` | `_buildConfirmModal()` | **Yes** |
| Select all eligible | `_selectAllEligible()` | `_selectAllEligible()` | **Yes** (implicit from DESIGN §4.3 code) |
| API method | `DataSource.hems.gatewayTargeting()` | `DataSource.hems.gatewayTargeting()` | **Yes** |
| Handler file | `get-hems-targeting.ts` | `get-hems-targeting.ts` | **Yes** |

**No naming inconsistencies found.**

### C4: v6.0 Backward Compatibility

| v6.0 Component | DESIGN Position | PLAN Position | Assessment |
|----------------|----------------|---------------|------------|
| `POST /api/hems/batch-dispatch` | §6.1: "NO CHANGES" | T5: reuses existing API | **Preserved** |
| `GET /api/hems/batch-history` | §6.1: "NO CHANGES" | T4/T6: reuses existing API | **Preserved** |
| `GET /api/gateways` | §6.2: "NOT used by P4 directly" | Not referenced | **Preserved** |
| `post-hems-batch-dispatch.ts` handler | §1: "不動" | Not touched | **Preserved** |
| `get-hems-batch-history.ts` handler | §1: "不動" | Not touched | **Preserved** |
| M3 command-dispatcher.ts | §1: "不動" | Not touched | **Preserved** |
| M1 command-publisher.ts | §1: "不動" | Not touched | **Preserved** |
| `DataSource.hems.batchDispatch()` | §5.4: reuses existing | T5 step 5e: reuses existing | **Preserved** |
| `DataSource.hems.batchHistory()` | §5.1: reuses existing | T4 step 4a: reuses existing | **Preserved** |

**v6.0 backward compatibility is fully preserved.** The only new backend artifact is `GET /api/hems/targeting`, which is additive. PLAN §8 Rollback section correctly notes that existing v6.0 APIs are unaffected.

---

## Issues Found

### Critical (must fix before implementation)

**C1: Query 3 active command deduplication**
- **Location:** DESIGN §6.3, Query 3 SQL + application merge code
- **Issue:** `SELECT DISTINCT gateway_id, batch_id` can return multiple rows per gateway (one per active batch). The `new Map()` constructor will silently overwrite, keeping only the last batch_id per gateway. While `hasActiveCommand` will still be correct (Map.has), `activeCommandBatchId` may show the wrong batch.
- **Fix:** Use `SELECT DISTINCT ON (gateway_id) gateway_id, batch_id FROM device_command_logs WHERE ... ORDER BY gateway_id, created_at DESC` to get the most recent blocking batch per gateway. Alternatively, if showing multiple blocking batches is desired, change the response schema to `activeCommandBatchIds: string[]`.

**C2: "Select all eligible" semantics**
- **Location:** DESIGN §4.3 `_selectAllEligible()` code; REQ §Impact Model
- **Issue:** The `_selectAllEligible()` function only selects gateways where `_classify(gw) === 'eligible'`. However, REQ states that `已一致` (same-schedule) gateways are selectable ("Yes — operator may still select and re-dispatch deliberately"). The button labeled "選取可下發" (select deployable) maps to the `eligible` state only, but "select all eligible" conceptually includes all selectable gateways.
- **Impact:** An operator wanting to re-dispatch to all gateways (including already-consistent ones) would need to manually select each `same` gateway individually. This may be intentional UX friction, or it may be an oversight.
- **Fix:** Either (a) add a second button "選取全部可選" that selects both `eligible` and `same`, or (b) rename the existing button to make the scope unambiguous (e.g., "選取將變更"), or (c) document this as an intentional design choice in DESIGN.

**C3: Retry policy defined in PLAN, not DESIGN**
- **Location:** PLAN T5 step 30; DESIGN §9.4; REQ §Post-dispatch
- **Issue:** REQ says retry "follows DESIGN-defined retry policy." DESIGN §9.4 mentions the retry button but does not define what constitutes a retryable failure. PLAN T5 step 30 fills this gap: "Retryable determination: gateway status === 'skipped' with reason !== 'active_command'". This policy should live in DESIGN, not PLAN.
- **Fix:** Add a §9.5 "Retry Policy" subsection to DESIGN that defines: (a) which result statuses are retryable, (b) which skip reasons are non-retryable, (c) maximum retry count (or unlimited).

### Warning (should fix, not blocking)

**W1: Recommended action for blocked gateways under-specified**
- **Location:** DESIGN §4.3 conflict popover
- **Issue:** REQ requires blocked rows to display "a recommended action (e.g., 'wait for batch-002 to complete')". DESIGN lists "recommended action" as a popover item but doesn't specify how it's generated. Is it a static string template? Is it computed from the blocking command's state?
- **Recommendation:** Add a mapping table in DESIGN: blocking reason → recommended action text.

**W2: Role badge missing from DESIGN header specification**
- **Location:** DESIGN §4 (header not detailed); REQ §Main UI Structure item 1
- **Issue:** REQ says header includes "role badge". DESIGN doesn't mention it.
- **Recommendation:** Add role badge to the header component specification in DESIGN.

**W3: Testing deferred to Phase 4 (TDD deviation)**
- **Location:** PLAN §1 Phase 4
- **Issue:** All automated testing is in Phase 4 (Day 6-7). This deviates from the TDD workflow mandated in project conventions. Phases 1-3 rely on manual verification only.
- **Recommendation:** At minimum, move T9 (backend tests) to Phase 1 so the targeting API is tested immediately. Consider adding a lightweight smoke test in Phase 2 acceptance.

**W4: Phase 3 tasks lack acceptance criteria**
- **Location:** PLAN T6, T7, T8
- **Issue:** Phase 3 tasks have "detailed steps" but no verification checkboxes like Phases 1 and 2.
- **Recommendation:** Add 2-3 acceptance checkboxes per Phase 3 task.

**W5: "Blocked" vs "conflict" terminology split**
- **Location:** DESIGN §3.3 `_classify()`, §4.3 CSS classes, §11.1 CSS class table
- **Issue:** REQ uses "Blocked/阻塞" consistently. DESIGN code uses `'conflict'` as the internal state key and CSS class prefix (`.row-conflict`, `.sb-conflict`). Prose uses "blocked".
- **Recommendation:** Use `'blocked'` as the internal key to match REQ terminology, or add an explicit terminology mapping note.

**W6: DESIGN §4.5 — "Disabled until operator has scrolled/reviewed"**
- **Location:** DESIGN §4.5 final dispatch button styling
- **Issue:** DESIGN says the confirm button is "Disabled until operator has scrolled/reviewed" — this is a new requirement not in REQ and adds implementation complexity (scroll detection). REQ only requires the button not be the default focus.
- **Recommendation:** Either remove the scroll-gating requirement (REQ doesn't mandate it), or if kept, add implementation details to PLAN (currently not addressed in any PLAN task).

### Suggestion (nice to have)

**S1: Consider displaying lastSeenAt in targeting table**
- **Location:** DESIGN §6.3 response includes `lastSeenAt`; §4.3 table columns don't use it
- **Issue:** The data is fetched but not displayed. For offline gateways, showing "last seen 2h ago" would help the operator assess whether the gateway might come back online soon.
- **Recommendation:** Consider adding a tooltip on the status badge, or a dedicated column for offline rows.

**S2: No data refresh mechanism documented**
- **Location:** DESIGN §5 data flows
- **Issue:** Gateway data is loaded once at page init. No refresh mechanism is documented. If the page is open for 30+ minutes, eligibility data may be stale (e.g., a gateway goes offline, or a blocking command completes).
- **Recommendation:** Add a manual "refresh fleet data" button, or document that periodic refresh is deferred to a future version.

**S3: Session expiry during long workflow**
- **Location:** Neither DESIGN nor PLAN
- **Issue:** If the operator spends significant time on the page and the auth token expires, the dispatch POST will fail with 401. While the auth middleware handles this globally, the specific UX for "you were about to dispatch but your session expired" is not addressed.
- **Recommendation:** Low priority — the existing global auth error handling likely covers this.

---

## Verdict

**Conditional Pass.** The DESIGN and PLAN are comprehensive, well-structured, and faithfully trace to the REQ baseline. The architectural decisions (client-side eligibility, dedicated targeting API, v6.0 backend reuse) are sound and well-justified.

**Before implementation begins, fix:**
1. **C1** — Query 3 deduplication (data correctness issue)
2. **C2** — Clarify "select all eligible" button scope (UX ambiguity)
3. **C3** — Move retry policy definition from PLAN to DESIGN (document structure)

**Should also address (non-blocking):**
- W1 through W6, especially W3 (TDD) and W6 (scroll-gating scope creep)

Once the 3 critical items are resolved, the documents are ready for implementation.
