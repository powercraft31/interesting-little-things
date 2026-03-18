# REVIEW: v6.2 Devices — Second-Pass Cross-Document & Code-Reality Check

**Date:** 2026-03-18
**Reviewer:** Claude (second-pass)
**Documents reviewed:**
- REQ-6.2-Devices-Home-First-Workbench.md
- DESIGN-v6.2-Devices.md
- PLAN-v6.2-Devices.md

**Code files inspected:**
- `frontend-v2/js/p2-devices.js`
- `backend/src/bff/handlers/get-gateway-detail.ts`
- `backend/src/bff/handlers/get-gateway-schedule.ts`
- `backend/src/iot-hub/handlers/schedule-translator.ts`
- `backend/src/bff/handlers/get-gateways.ts`
- `backend/lib/bff-stack.ts`
- `frontend-v2/js/data-source.js`
- `db-init/02_schema.sql`
- `docs/DESIGN-v6.1-Fleet.md`
- `docs/PLAN-v6.1-Fleet.md`

---

## 1. Executive Summary

The REQ-DESIGN-PLAN chain is well-structured and internally consistent on the conceptual level. The core semantics (Home-first workbench, schedule structural invariants, state machine) propagate correctly across all three documents.

However, there are **two blocking issues** and several significant gaps that would cause implementation failures if not corrected before coding begins:

1. **`GET /api/gateways` route is not registered in `bff-stack.ts`** — the PLAN's entire object locator depends on this endpoint, but it's currently dead code.
2. **syncStatus mapping is inconsistent** between `get-gateway-detail.ts` and `get-gateway-schedule.ts` — this will cause state machine bugs in the pending/idle logic.

Beyond these, the PLAN underspecifies search implementation, drag interaction mechanics, and the "mode" control value concept.

---

## 2. What Is Solid

- **REQ to DESIGN semantic fidelity is excellent.** The DESIGN faithfully translates every REQ section with explicit cross-references (e.g., "REQ §6.1", "REQ §12.3"). No semantic drift detected.
- **"No independent settings table" constraint correctly propagated** across all three docs. REQ §16.1 -> DESIGN §7.1 -> PLAN avoids creating one.
- **Schedule structural invariants (24h, no overlap, no gap, hourly granularity)** are defined identically in REQ §12, DESIGN §5.3, PLAN T9. Backend `validateSchedule()` (schedule-translator.ts:207-297) already enforces the exact same rules. Front-back alignment is clear.
- **State machine (online/offline/pending)** is consistently defined in REQ §15, DESIGN §6.1, PLAN T8 with matching matrices.
- **Backend endpoint reuse analysis** (DESIGN §7.5) is accurate. `get-gateway-detail.ts` and `get-gateway-schedule.ts` provide the data needed for Data Lane and Control Lane respectively. `put-gateway-schedule.ts` exists and handles Apply (the DESIGN says "(假設存在)" but it does exist).
- **Non-goals** are identically listed across docs.
- **Line number references** are accurate: `_buildBatteryScheduleCard` is at line ~933, `_buildEnergyFlow` is at line 1667, `validateSchedule` is at lines 207-297.
- **PLAN's incremental rollback strategy** (R1 degradation plan: Stage A-D) is pragmatic and well-thought-out.

---

## 3. Gaps / Risks / Incorrect Assumptions

### BLOCKING

#### G1: `GET /api/gateways` route not registered (Severity: Blocker)

**PLAN T2** assumes modifying `get-gateways.ts` will make the gateway list available to the frontend. **PLAN T5** calls `DataSource.devices.gateways()` which hits `GET /api/gateways`.

**Reality:** `bff-stack.ts` registers only three gateway routes:
- `GET /api/gateways/{gatewayId}/detail`
- `GET /api/gateways/{gatewayId}/schedule`
- `PUT /api/gateways/{gatewayId}/schedule`

There is **no** `GET /api/gateways` route. The handler file exists but is dead code. `data-source.js` line ~201 calls this endpoint, but it will 404 in live mode (works only in mock mode).

**Impact:** The entire object locator (left panel) will fail to load any data.

**Fix:** PLAN must add a task to register `GET /api/gateways` in `bff-stack.ts`, or bundle it into T4 (route registration task).

#### G2: syncStatus mapping inconsistency (Severity: Blocker)

`get-gateway-detail.ts` (line 253-258) maps syncStatus as:
```
"pending" | "pending_dispatch" -> "pending"
```

`get-gateway-schedule.ts` (line 153-162) maps syncStatus as:
```
"pending" | "dispatched" | "accepted" -> "pending"
"failed" | "timeout" -> "failed"
```

These two endpoints disagree on:
- `"dispatched"` and `"accepted"` are only recognized by the schedule endpoint
- `"pending_dispatch"` is only recognized by the detail endpoint
- The detail endpoint has no `"failed"` status — anything non-success/non-pending falls to `"unknown"`

**Impact:** PLAN T8 (state handling) uses both endpoints. If the frontend reads syncStatus from detail (for initial load) and schedule (for control lane), the same command could show different statuses depending on which endpoint is queried. A `"dispatched"` command would show `"pending"` from schedule but `"unknown"` from detail.

**Fix:** Normalize syncStatus mapping to be identical in both handlers before v6.2 work begins, or explicitly document which endpoint is the single source of truth for syncStatus.

### HIGH

#### G3: Search implementation unspecified (Severity: High)

REQ §6.2 requires search across Home alias, Gateway name, and Gateway ID. PLAN T5b mentions the search box but provides no implementation detail.

Current `get-gateways.ts` has no search/filter parameter. `data-source.js` `devices.gateways()` passes no query params.

**Options not discussed:**
- Client-side filtering (simple but doesn't scale)
- Server-side query param on `GET /api/gateways?search=xxx`

**Fix:** PLAN should specify whether search is client-side or server-side, and if server-side, include it in T2's scope.

#### G4: "mode" as standalone control value is misleading (Severity: High)

REQ §9.1 lists "mode" as one of the control values in the top section of Control Lane. DESIGN §4.3 echoes this. PLAN T7a says "顯示當前控制數值：SoC min/max、charge/discharge limit、mode、grid limit".

**Reality:** `mode` is not a top-level field in DomainSchedule. It is a per-slot field (`self_consumption`, `peak_valley_arbitrage`, `peak_shaving`). There is no single "current mode" for the gateway — a schedule with 4 slots could have 4 different modes.

**Impact:** The Control Lane top section cannot display "mode" as a single value without additional design.

**Fix:** Clarify in DESIGN what "mode" means in the context of top-level settings. If it's a summary, specify the display logic (e.g., "show mode if all slots share the same mode, otherwise show 'Mixed'"). If it's not applicable at the top level, remove it from the list.

#### G5: Drag interaction complexity underestimated (Severity: High)

PLAN T9a describes implementing shared-boundary drag with snap-to-grid on a 24h timeline bar. The current frontend is vanilla JavaScript with no framework or drag library.

Implementing pointer-event-based drag with:
- snap to 60-minute grid
- bidirectional slot resize (left slot end + right slot start)
- boundary constraints (00:00 locked, 24:00 locked)
- touch support

...is non-trivial in vanilla JS. The PLAN estimates ~400 lines for the entire schedule editor including the timeline preview, slot table, split, merge, and validation. This is optimistic.

**Fix:** Either acknowledge the complexity in PLAN risk section, specify a drag library, or scope the timeline preview as view-only in Phase 1 (defer drag to Phase 2). The split/merge + form approach alone satisfies the REQ's structural invariant requirement without drag.

### MEDIUM

#### G6: DESIGN §7.1 Priority 3 misattribution (Severity: Medium)

DESIGN §7.1 states Priority 3 for schedule reading is "硬編碼 default + asset capacity 欄位" at `get-gateway-detail.ts:217-225`.

**Reality:** The `config` object in `get-gateway-detail.ts` (lines 217-225) provides hardcoded defaults (`socMin: 10, socMax: 100`, etc.), but this is the `config` section of the detail response, NOT part of the schedule response. The schedule endpoint (`get-gateway-schedule.ts`) returns `batterySchedule: null` when no data exists — there is no fallback to defaults.

**Impact:** If a gateway has never had a set or get_reply, the Control Lane will have `batterySchedule: null` from the schedule endpoint. The PLAN doesn't address how the top-level settings section handles this null case. Should it show defaults from the detail endpoint's `config` section? This needs explicit design.

#### G7: Redundant schedule data between two endpoints (Severity: Medium)

`get-gateway-detail.ts` returns a simplified schedule (syncStatus + slots only), while `get-gateway-schedule.ts` returns the full schedule (with socMinLimit, socMaxLimit, etc. + syncStatus).

PLAN T5c calls both endpoints in parallel. The schedule data from `detail` overlaps with `schedule` but is less complete. This creates:
- Wasted bandwidth
- Potential confusion about which response is authoritative for schedule-related display

**Fix:** Consider removing the schedule section from `get-gateway-detail.ts` response (breaking change) or explicitly document that the detail endpoint's schedule is ignored when the full schedule endpoint is also called.

#### G8: Role restriction for home_alias editing (Severity: Medium)

PLAN T3 restricts PATCH home-alias to `SOLFACIL_ADMIN` and `ORG_MANAGER`. REQ §2.1 says Home is "操作者可自定義的場景代號" (operator-customizable alias).

If `ORG_OPERATOR` is the day-to-day operator role, they cannot set their own Home aliases. This may conflict with the REQ's intent of Home being a human-readable convenience label.

**Fix:** Clarify whether ORG_OPERATOR should be allowed to edit home_alias. If yes, add the role to T3.

#### G9: v6.1 Fleet DDL conflict with v6.2 DDL (Severity: Medium)

Both v6.1 Fleet PLAN (T1) and v6.2 Devices PLAN (T1) modify `db-init/02_schema.sql`. If these are developed in parallel or merged in sequence, the DDL changes must not conflict.

v6.1 adds `gateway_outage_events` table. v6.2 adds `home_alias` column to `gateways`. These are independent changes, but the PLAN should note the coordination requirement.

---

## 4. Cross-Doc Consistency Check

| Check | REQ | DESIGN | PLAN | Verdict |
|-------|-----|--------|------|---------|
| Home-first semantic | §2.1 | §2.3 | T5b | Consistent |
| Three-segment layout | §4-6 | §3.1-3.4 | T5a-T5c | Consistent |
| 60/40 dual waterfall | §7.3 | §4.1 | T5a | Consistent |
| Energy flow first in Data Lane | §8.1 | §4.2 | T6a | Consistent |
| Control values before schedule | §9.1 | §4.3 | T7a | Consistent, but "mode" issue (G4) |
| Apply not sticky | §9.3 | §4.3 | T7c | Consistent |
| Schedule: 24h/no-overlap/no-gap | §12.1 | §5.3 | T9e | Consistent |
| Drag = shared boundary | §12.3 | §5.4 | T9a | Consistent |
| Add = split | §13.1 | §5.5 | T9c | Consistent |
| Delete = merge | §13.2 | §5.5 | T9d | Consistent |
| 1-hour granularity | §14 | §5.6 | T9a | Consistent |
| Online+idle: editable | §15.1 | §6.1 | T8 | Consistent |
| Online+pending: locked | §15.2 | §6.1 | T8 | Consistent |
| Offline+snapshot: read-only | §15.3A | §6.1 | T8 | Consistent |
| Offline+no-snapshot: unavailable | §15.3B | §6.1 | T8 | Consistent |
| No independent settings table | §16.1 | §7.1 | (not created) | Consistent |
| Backend validation already strict | §16.2 | §7.2 | (not modified) | Consistent |
| Frontend edit gap (current) | §16.3 | §7.3 | T9 | Consistent |
| Non-goals list | §17 | §8 | - | Consistent |
| Home alias field source | - | §7.6 (proposes) | T1 (implements) | Consistent |
| Search REQ | §6.2 | §3.3 | T5b | **Gap: no implementation detail** |

---

## 5. Code-Reality Check

| Claim in Docs | Code Reality | Verdict |
|---|---|---|
| "gateways 表新增 home_alias" (PLAN T1) | `gateways` table has no `home_alias` today (confirmed in 02_schema.sql) | Correct — this is new work |
| "get-gateways.ts 現有 70 行" (PLAN T2) | Handler exists, ~70 lines | Correct |
| "get-gateway-detail.ts 已提供 Data Lane 所需數據" (DESIGN §7.5) | Returns gateway, state, telemetryExtra, config, devices, schedule | Correct |
| "get-gateway-schedule.ts 已提供 Control Lane schedule 數據" (DESIGN §7.5) | Returns batterySchedule (with SoC limits, current limits, slots) + syncStatus | Correct |
| "put-gateway-schedule.ts (假設存在)" (DESIGN §9) | File exists, returns 202, requires ADMIN/MANAGER | Exists (remove "假設" qualifier) |
| "schedule-translator.ts validateSchedule() 已具備完整校驗" (DESIGN §7.2) | Lines 207-297: validates 24h, no overlap, no gap, hourly, SoC min<max, non-negative ints | Correct |
| "_buildBatteryScheduleCard (line ~933)" (DESIGN §7.3) | Line 933 confirmed | Correct |
| "Add slot 為凭空新增" (DESIGN §7.3) | Lines 2245-2265: creates new 6h slot, appends to array | Correct |
| "Delete slot 為直接刪除" (DESIGN §7.3) | Lines 1277-1289: filters out slot by index | Correct |
| "_buildEnergyFlow() 已在 Layer 3 實現 (p2-devices.js:1667)" (DESIGN §4.2) | Line 1667 confirmed | Correct |
| "Layer 1: _buildLayer1, Layer 3: _buildLayer3" (DESIGN §7.4) | Both exist in p2-devices.js | Correct |
| "Gateway list endpoint 可複用" (DESIGN §7.5) | **Handler exists but route NOT registered in bff-stack.ts** | **INCORRECT — route is dead code** |
| "p2-devices.js 現有 2,348 行" (PLAN T5) | File is ~85KB, consistent with ~2,348 lines | Plausible |
| "data-source.js 現有 517 行" (PLAN T10) | File exists with devices.gateways(), devices.gatewayDetail(), etc. | Correct |
| "DataSource.devices.gateways() 取列表" (PLAN T5b) | Method exists at data-source.js ~line 201, calls GET /api/gateways | **Correct method, but endpoint 404s** (G1) |

---

## 6. Recommended Corrections (Priority Ordered)

### P0 — Must fix before implementation starts

1. **Register `GET /api/gateways` route in `bff-stack.ts`.** Add to PLAN as T0 or prepend to T2. Without this, the object locator has no data source. This is likely a pre-existing gap (mock-only endpoint) that v6.2 must fix.

2. **Normalize syncStatus mapping** between `get-gateway-detail.ts` and `get-gateway-schedule.ts`. Add a task to align the status string handling. At minimum, document which endpoint is the canonical source for state machine decisions in T8.

### P1 — Should fix before implementation starts

3. **Specify search implementation** in PLAN. Either:
   - Add a `search` query parameter to `GET /api/gateways` in T2 (server-side), or
   - Explicitly state client-side filtering in T5b and acknowledge it won't scale past ~200 gateways.

4. **Resolve "mode" in top-level settings.** Either:
   - Remove "mode" from the top-level control values list, or
   - Define display logic (e.g., "show mode if all slots share the same mode, otherwise show 'Mixed'").

5. **Address `batterySchedule: null` fallback.** When no schedule history exists, define what the Control Lane shows. Should it display defaults from `get-gateway-detail.ts`'s `config` section? Add this to PLAN T7a.

### P2 — Should address during implementation

6. **Acknowledge drag complexity** in PLAN risk section. Consider:
   - Phase 1: timeline preview is view-only; time changes only via split/merge + form selects.
   - Phase 2: add drag interaction.
   This de-risks the schedule editor without losing structural invariant guarantees.

7. **Fix DESIGN §7.5**: Remove "(假設存在)" from put-gateway-schedule reference — the file exists.

8. **Fix DESIGN §7.1 Priority 3**: Clarify that hardcoded defaults are in the `detail` endpoint's `config` section, not in the `schedule` endpoint. They are separate response objects.

9. **Clarify ORG_OPERATOR role** for home_alias editing (PLAN T3).

---

## 7. Final Verdict

### Needs Fixes

The document chain is conceptually sound and internally consistent. The semantic design (Home-first workbench, schedule invariants, state machine) is well-reasoned and correctly maps to existing backend capabilities.

However, two blockers (G1: unregistered route, G2: syncStatus inconsistency) and three high-severity gaps (G3: search unspecified, G4: "mode" mismatch, G5: drag complexity) must be resolved before implementation begins.

**Estimated correction effort:** 1-2 hours of document updates. No architectural rework needed.

**After P0+P1 corrections are applied, the docs are ready for implementation.**
