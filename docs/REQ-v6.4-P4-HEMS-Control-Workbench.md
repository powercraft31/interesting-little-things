# REQ-v6.4-P4-HEMS-Control-Workbench

## Status
Draft based on approved v4 mock direction, 2026-03-21.

## Goal
Rebuild Page 4 as a **HEMS Control Workbench** — the fleet-wide batch strategy dispatch surface. Page 4 is the **Act** layer in the four-page product chain. Its mission is safe, confident execution of batch HEMS strategy operations across targeted Gateways.

---

## Product Positioning

### The four-page chain
The SOLFACIL admin portal follows a deliberate page-chain progression:

| Page | Layer | Mission |
|------|-------|---------|
| P1 Fleet | **Observe** | Look at fleet-wide gateway health and connectivity |
| P2 Devices | **Inspect** | Drill into individual gateways, devices, configuration |
| P3 Energy | **Understand** | Analyze time-series energy behavior and statistics |
| P4 HEMS Control | **Act** | Execute batch strategy operations on targeted gateways |

Each page owns a distinct verb. Page 4 owns **Act**.

### Primary mission
**Batch HEMS strategy control**
- First question the page must answer: **which strategy do I want to deploy, to which gateways, and is it safe to do so now?**

### Secondary mission
**Dispatch review and execution confidence**
- After dispatch, the page must answer: **did the batch succeed, what failed, and can I retry?**

### Explicit exclusion
**Page 4 is not a fleet analytics dashboard.**
- It is not a KPI wall, chart gallery, or performance summary.
- Any information shown on this page must directly serve the operator's dispatch decision or execution review.
- High information density is acceptable only when it serves operational targeting and safety.

### Anti-regression rule
Page 4 must never regress into:
- a generic dashboard that duplicates P1 fleet monitoring
- an analytics page that duplicates P3 energy statistics
- a device-inspection page that duplicates P2 device workbench
- a decorative overview with KPIs that do not drive dispatch decisions

If a piece of information does not help the operator choose a strategy, evaluate impact, select targets, or confirm dispatch — it does not belong on Page 4.

---

## Relationship to Pages 1–3

### Why page 4 must not repeat dashboard/KPI/chart functions

Pages 1–3 already cover the full Observe → Inspect → Understand chain. If Page 4 also surfaces fleet KPIs, device health charts, or energy statistics, the product develops two problems:

1. **Semantic overlap**: the operator cannot distinguish Page 4's purpose from Pages 1–3. The page loses its identity.
2. **Decision dilution**: analytics content competes for attention with the dispatch workflow, reducing the operator's ability to focus on the action at hand.

Page 4 exists precisely because the first three pages do not act. The operator arrives at Page 4 having already observed, inspected, and understood. Page 4 must respect that prior context and focus entirely on execution.

### What Page 4 may reference from Pages 1–3
- **Gateway online/offline status** — needed for targeting eligibility, not for fleet monitoring.
- **Current strategy mode per gateway** — needed for impact comparison, not for device inspection.
- **Current schedule per gateway** — needed for old-vs-new schedule comparison, not for energy analysis.

These are operational inputs to the dispatch workflow, not independent analytics features.

---

## Page Philosophy

### Control workbench, not dashboard
Page 4 is an **operator console**. Its layout, density, and interaction model should feel like a control workbench — purpose-built for executing a specific high-stakes operation with confidence.

### Decision safety over information richness
The page prioritizes:
1. **Decision safety** — the operator must clearly understand what will change before confirming
2. **Actionability** — every visible element contributes to the dispatch workflow
3. **Execution confidence** — the operator sees clear feedback on what succeeded and what failed

### Acceptable density
Compact, scannable targeting grids and impact counters are appropriate. Decorative charts, trend lines, and exploration widgets are not.

---

## Core Object Model

### Primary object
**Gateway**
- Gateway is the unit of targeting, selection, dispatch, and result tracking.
- The targeting table is a Gateway table.
- Dispatch commands are issued per Gateway.
- Results are reported per Gateway.

### Secondary object
**Strategy configuration / dispatch batch**
- The strategy (mode + parameters + schedule) is the payload being dispatched.
- The batch is the grouping unit for a single dispatch operation.

### Supporting context only
**Devices**
- Device count per gateway is shown as context in the targeting table.
- Devices are not individually targetable or configurable from Page 4.
- Page 4 does not contain device-level drill-down, inspection, or control.

---

## Workflow Model

The operator flow is a strict four-step sequence:

### Step 1: Choose strategy and parameters (先選策略)
- Operator selects one of three strategy modes
- Operator configures shared parameters (SoC bounds, mode-specific parameters)
- For arbitrage mode, operator defines the 24h charge/discharge schedule
- **No gateway may be treated as dispatchable/selectable before a strategy is chosen.** Before Step 1 is complete, Step 2/3 may render context, but must not imply a valid dispatch target set yet.

### Step 2: See impact summary (看影響)
- The system computes and surfaces an impact summary based on the selected strategy against all known gateways
- Impact counters update reactively as the strategy changes

### Step 3: Target and select gateways (選 Gateway)
- Operator filters and selects specific gateways to receive the dispatch
- Non-deployable gateways (offline, conflicted) are visible but not selectable
- Current vs target schedule comparison is visible per gateway

### Step 4: Confirm and dispatch (確認下發)
- Operator opens the confirmation/review layer
- Reviews the full dispatch summary
- Executes the final dispatch action
- **State consistency rule:** once one or more gateways are selected, Step 4 must no longer present a dormant "nothing selected" state. Selection state must propagate into the review layer immediately.

This sequence is the backbone of Page 4. All UI structure must serve this flow.

---

## Strategy Modes

### 自發自用 (Self-Consumption)
- Single slot: `{mode: 'self_consumption', 0→1440}`
- No time-slot editor required
- Shared SoC bounds apply

### 削峰 (Peak Shaving)
- Single slot: `{mode: 'peak_shaving', 0→1440}`
- No time-slot editor required
- Additional parameter: `gridImportLimitKw` (grid import limit in kW)
- Shared SoC bounds apply

### 峰谷套利 (Peak-Valley Arbitrage)
- Multi-slot: operator paints a 24h charge/discharge schedule
- 24h grid editor is required (24 cells, each representing 1 hour)
- Two brush modes: charge / discharge
- All 24 cells must be filled before dispatch is allowed
- Quick templates required: Enel SP, night charge, double-charge-window, clear
- Shared SoC bounds apply

### Shared parameters (all modes)
| Parameter | Type | Range | Description |
|-----------|------|-------|-------------|
| socMinLimit | range | 5–50% | SoC lower bound |
| socMaxLimit | range | 70–100% | SoC upper bound |

### Mode-specific parameters
| Parameter | Mode | Type | Description |
|-----------|------|------|-------------|
| gridImportLimitKw | Peak Shaving only | number (kW) | Grid import ceiling |

### Charge/discharge power
Charge and discharge power settings are **not set on Page 4**. Each gateway retains its existing power settings from P2 / latest successful schedule.

---

## Impact / Targeting Model

### Eligibility states
When a strategy is selected, every gateway in the fleet falls into exactly one of four **eligibility states**:

| State | Chinese Label | Meaning | Selectable? |
|-------|--------------|---------|-------------|
| Eligible | 可下發 | Online, no conflicts, strategy differs from current — can receive dispatch | Yes |
| Already Consistent | 已一致 | Online, no conflicts, but current strategy already matches target | Yes (operator may still select and re-dispatch deliberately) |
| Blocked | 阻塞 | Online, but has an active pending/in-progress command that prevents new dispatch | No — must explain why |
| Offline | 離線 | Gateway is offline — cannot receive commands | No |

### Selection / dispatch summary states
Selection introduces a second layer of **operator-state summary**, which must not be confused with eligibility:

| State | Chinese Label | Meaning |
|-------|--------------|---------|
| Selected | 已選擇 | Gateway is currently included in the operator's selection set |
| Will Change | 將變更 | Selected gateway whose current strategy/schedule differs from the target and would actually change on dispatch |

`已選擇` and `將變更` are **selection/dispatch summary states**, not fleet eligibility buckets. A gateway may be selectable (`可下發` or `已一致`) and also be `已選擇`; `將變更` is a subset of the selected set.

### Impact counter strip
The Step 2 summary strip must surface both kinds of operational counts:
- **Eligibility counters**: 可下發 / 已一致 / 阻塞 / 離線
- **Selection counters**: 已選擇 / 將變更

This strip is an **operational control indicator**, not a dashboard KPI strip. It exists to support dispatch decisions, not to act as a fleet summary card row.

### Blocked gateway requirements
- Blocked rows must be **visibly non-deployable**: checkbox disabled, row visually muted or tinted.
- Each blocked row must display a **conflict reason** — why this gateway cannot receive the dispatch right now.
- Conflict reasons must include: the blocking condition (e.g., "command in progress"), the blocking batch ID if applicable, and a recommended action (e.g., "wait for batch-002 to complete").
- Blocked gateways must appear in the targeting table (not hidden), so the operator understands the full fleet picture.

### Offline gateway requirements
- Offline rows must be **visibly non-deployable**: checkbox disabled, row visually distinct from online rows.
- Offline gateways are shown in the targeting table with their last-known state.
- **Current business rule (no lifecycle model yet):** until a formal `lifecycle_status` / decommissioning model exists, Page 4 must treat all non-`online` backend gateway statuses as `offline` for display, filtering, and eligibility purposes. If a gateway truly exits the fleet, it should be removed from DB rather than represented as a separate retained lifecycle state in this page.

---

## Main UI Structure

### Page layout (top to bottom)
1. **Header**: page title, active mode chip, role badge
2. **Instruction line**: operator flow reminder (先選策略 → 看影響 → 選 Gateway → 確認下發)
3. **Step 1 — Strategy section**: mode cards, parameter controls, arbitrage 24h editor
4. **Step 2 — Impact counter strip**: eligibility + selection summary strip for dispatch decisions
5. **Step 3 — Targeting section**: filters, gateway targeting table with current/target schedule comparison
6. **Step 4 — Review/Dispatch section**: review panel (dormant until targets selected), dispatch summary, batch history

### Targeting table (Step 3)

#### Layout preference
**Compact scannable table/grid** is preferred over a card-wall layout. The targeting table is a dense operational grid, not a collection of feature cards.

#### Required columns
| Column | Content |
|--------|---------|
| Checkbox | Multi-select; disabled for blocked/offline |
| Gateway ID | Gateway identifier |
| Site | Home/site name |
| Status | Online/offline badge |
| Current Strategy | Current active mode label |
| Match | Eligibility badge (eligible / consistent / blocked / offline) plus selected-state marker when applicable |
| Devices | Device count (supporting context) |
| Current Schedule (24h) | Mini schedule bar showing current 24h time-slot distribution |
| Target Schedule (24h) | Mini schedule bar showing what the gateway would receive |

#### Schedule bar legend
A schedule bar legend is required, explaining color coding:
- Self-consumption color
- Peak shaving color
- Charge color
- Discharge color

This ensures the mini schedule bars are interpretable without memorization.

#### Current vs target schedule comparison
Both the current and target schedule bars must be visible per row. This is a hard requirement — the operator must see what will change before selecting a gateway.

#### Filters
- Integrator / organization
- Site / home
- Online status (`all` / `online` / `offline` under the current business rule)
- Current strategy mode
- Bulk actions: "select all eligible", "clear selection", "reset filters"

#### Strategy prerequisite for targeting
- Before a strategy is chosen, the targeting table may show fleet context, but selection must not proceed as if a dispatch target is already valid.
- At minimum, gateway checkboxes and bulk-select actions must remain inactive or clearly gated until Step 1 defines the target strategy.
- The page must not show "dispatchable" or "will change" semantics before a target strategy actually exists.

### Review panel (Step 4)

#### Dormant state
The review panel stays dormant (collapsed/muted) until at least one gateway is selected for dispatch. Dormant state must display a clear message explaining why it is inactive.

#### Review activation rule
- The dormant state is valid only when the selected gateway set is empty.
- Once one or more gateways are selected, the review panel must activate and reflect the actual selected set.
- The page must never simultaneously show non-zero selection counters and a dormant "no gateways selected" review state.

#### Active state
When targets exist, the review panel shows:
- Per-gateway review cards with old-vs-new schedule comparison
- Dispatch summary: strategy name, parameter values, selected count, will-change count, blocked count
- Status chain visualization (workflow progress)
- Dispatch action button
- Batch history (collapsible)

---

## Safety and Confirmation Rules

### Two-step dispatch flow
Dispatch must be a **two-step flow**. Direct single-click dispatch is explicitly prohibited.

#### Step A: Open confirmation layer
- The primary dispatch button is labeled to indicate it opens a review/confirmation layer (e.g., "檢視並確認下發"), not that it executes dispatch directly.
- Clicking this button opens a confirmation modal/overlay.

#### Step B: Final confirm dispatch
- The confirmation modal must summarize:
  - Strategy mode and all parameters
  - Target 24h schedule preview (visual bar)
  - Gateway counts: total targets, will-change, already-consistent
  - Blocked gateways (listed by ID, with reasons) — these will NOT be dispatched
  - Any warnings (e.g., blocked items exist)
- The final dispatch button must be:
  - **Visually distinct** from all other page actions (danger/destructive styling)
  - **Clearly labeled as irreversible** (e.g., "確認下發 — 不可撤回")
  - **Not the default focus** — operator must deliberately move to it
- A cancel button must be present and easily accessible

### Blocked items in confirmation
If any targeted gateways are blocked, the confirmation modal must:
- Show a warning banner
- List the blocked gateways with their block reasons
- Clarify that blocked gateways will be skipped (not dispatched)

### Post-dispatch feedback
- Dispatch results must be shown per gateway (success / failed / skipped)
- Failed dispatches must show failure details
- If a retry action is included in this phase, it must be limited to retryable failures only and follow DESIGN-defined retry policy
- Batch history must record the operation

---

## Explicit Exclusions

The following are **explicitly excluded** from Page 4 scope:

1. **No generic dashboard reversion** — Page 4 must not become a KPI wall, fleet summary, or analytics overview.
2. **No decorative analytics overload** — no trend charts, energy graphs, performance summaries, or statistics that do not serve the dispatch workflow.
3. **No device-first page logic** — Page 4 is gateway-first. Devices are supporting context only. No device drill-down, device health monitoring, or device-level configuration.
4. **No direct final dispatch without confirmation layer** — the two-step dispatch flow is mandatory. Removing or bypassing the confirmation modal is not permitted.
5. **No charge/discharge power configuration** — power settings are managed per-gateway on P2. Page 4 sets mode, SoC bounds, grid limit, and arbitrage schedule only.
6. **No economic analysis** — savings, revenue, cost projections do not belong on the control workbench.
7. **No time-series charts** — energy flow visualization is P3's responsibility.

---

## Data and State Requirements (Product Level)

### Gateway state needed for targeting
| Data Point | Source | Purpose |
|------------|--------|---------|
| Gateway ID | Backend | Row identity |
| Online/offline status | Backend (heartbeat) | Eligibility filtering |
| Current strategy mode | Latest successful schedule from `device_command_logs` | Impact comparison |
| Current 24h schedule | Latest successful schedule payload | Schedule bar rendering |
| Active command presence | `device_command_logs` with `result IN ('pending','dispatched','accepted')` | Block detection |
| Device count | Assets table | Supporting context |
| Site / home name | Organization/site data | Filtering |
| Last sync time | Latest telemetry timestamp | Freshness indicator |
| Integrator / organization | Org hierarchy | Filtering |

### Strategy state (client-side)
| Data Point | Scope |
|------------|-------|
| Selected mode | Session |
| SoC min/max | Session |
| Grid import limit (peak shaving) | Session |
| Arbitrage 24h slots | Session |
| Selected gateway set | Session |

### Dispatch state
| Data Point | Source |
|------------|--------|
| Batch ID | Generated by backend on dispatch |
| Per-gateway result | Backend response + polling |
| Batch history | `GET /api/hems/batch-history` |

---

## Validation-based Clarifications (2026-03-21 live admin walkthrough)

The following clarifications are now locked into the product requirement, based on live admin-role validation against a real online test gateway (`WKRD24070202100141I`):

1. **Step order must be real, not decorative.**
   The page cannot allow gateway selection to behave as if dispatch is ready before the operator has chosen a strategy.

2. **Selection state must propagate end-to-end.**
   If the impact strip shows selected gateways, the review layer must reflect that same selected set. Split-brain UI state is not acceptable.

3. **Current business semantics override speculative lifecycle modeling.**
   In the current product, there is no approved retained decommissioned lifecycle state for Page 4. Anything not `online` is treated as `offline` here until lifecycle semantics are explicitly introduced at the system level.

4. **Admin-role live validation is mandatory for Page 4 product acceptance.**
   A Page 4 build is not product-accepted merely because the structure renders under a manager account with all-offline data. It must also be validated against at least one real online gateway so that dispatchability, consistency-state, and selection flow can be observed.

---

## Acceptance Criteria

### A. Product positioning acceptance
- [ ] Page 4 is clearly a control workbench, not a dashboard or analytics page
- [ ] No KPI cards, trend charts, or analytics widgets unrelated to dispatch operations
- [ ] Page identity is immediately recognizable as "the place where you execute batch strategy changes"

### B. Workflow acceptance
- [ ] Four-step flow is implemented: choose strategy → see impact → select gateways → confirm dispatch
- [ ] Steps are visually numbered and sequenced
- [ ] Operator instruction line is present
- [ ] Before a strategy is selected, gateways are not presented as valid dispatch targets and bulk-selection is gated
- [ ] Once gateways are selected, Step 4 cannot remain in a dormant "nothing selected" state

### C. Strategy acceptance
- [ ] Three strategy modes available: 自發自用, 削峰, 峰谷套利
- [ ] Shared SoC bounds configurable
- [ ] Peak shaving shows grid import limit parameter
- [ ] Arbitrage 24h editor with brush painting, templates, and coverage validation
- [ ] Arbitrage blocks dispatch when 24h grid is not fully painted

### D. Impact / targeting acceptance
- [ ] Impact counter strip separates **eligibility counters** (可下發, 已一致, 阻塞, 離線) from **selection counters** (已選擇, 將變更)
- [ ] The summary strip is clearly presented as an operational dispatch aid, not as a dashboard KPI row
- [ ] Counters update reactively on strategy or selection change
- [ ] Gateway targeting table is a compact grid, not a card wall
- [ ] Blocked/offline rows are visibly non-selectable with checkboxes disabled
- [ ] Blocked rows show conflict reason and recommended action
- [ ] Current and target schedule bars are both visible per row
- [ ] Schedule bar legend is present and interpretable
- [ ] Status handling follows the current business rule: all non-`online` backend statuses are represented as `offline` in Page 4 until a formal lifecycle model exists
- [ ] Status filter reflects the product-level dispatch semantics (`all` / `online` / `offline`), not speculative raw lifecycle values

### E. Safety acceptance
- [ ] Dispatch requires two steps: open confirmation → final confirm
- [ ] Confirmation modal summarizes strategy, parameters, target schedule, gateway counts, blocked items
- [ ] Final dispatch button uses danger/destructive styling and irreversibility language
- [ ] Blocked gateways are listed in confirmation with reasons and clearly marked as "will not be dispatched"
- [ ] Cancel is easily accessible in confirmation modal

### F. Post-dispatch acceptance
- [ ] Per-gateway dispatch results visible (success/failed/skipped)
- [ ] Failed gateways show failure details
- [ ] If retry is included in this phase, it is limited to retryable failures and follows design-defined policy
- [ ] Batch history records the operation

### G. Anti-regression acceptance
- [ ] Page contains no fleet KPI cards
- [ ] Page contains no energy charts or time-series views
- [ ] Page contains no device drill-down or device-level configuration
- [ ] Page contains no generic dashboard layout patterns
- [ ] All visible information serves the dispatch workflow

---

## Open Items Deliberately Left to Design/Implementation

The following are intentionally delegated to DESIGN / PLAN, not decided at REQ level:
- Exact component architecture and state management approach
- Exact responsive breakpoints and mobile behavior
- Exact mini schedule bar rendering implementation
- Tooltip wording and interaction details
- Arbitrage template preset values (beyond Enel SP, night charge, double-charge-window, clear)
- Polling/WebSocket strategy for post-dispatch result updates
- Exact color values for schedule bar segments
- Batch history pagination and retention policy
- Retry logic details (which failure types are retryable)
- API contract details beyond what is defined in REQ-v6.0-P4-batch-dispatch
