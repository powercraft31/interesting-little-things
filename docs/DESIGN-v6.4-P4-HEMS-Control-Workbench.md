# DESIGN-v6.4-P4-HEMS-Control-Workbench

**Version:** 6.4
**Date:** 2026-03-21
**REQ:** REQ-v6.4-P4-HEMS-Control-Workbench.md
**Predecessor:** DESIGN-v6.0-P4-batch-dispatch.md (backend APIs)
**Mock:** hems-page-v64-workbench-mock-v4-claude.html
**Status:** Draft

---

## 1. 模塊影響矩陣

| 模塊 | 文件路徑 | 動作 | 風險 | 依賴 | 說明 |
|------|----------|------|------|------|------|
| **Frontend — p4-hems.js** | `frontend-v2/js/p4-hems.js` | **重寫** | 高 | 新 API 就緒 | 現有 977 行 v6.0 三步流程 → v6.4 四步工作台 |
| **Frontend — data-source.js** | `frontend-v2/js/data-source.js` | **改** | 低 | 無 | 新增 `hems.gatewayTargeting()` 方法 |
| **Frontend — mock-data.js** | `frontend-v2/js/mock-data.js` | **改** | 低 | 無 | 新增 gateway targeting mock 數據 |
| **BFF — get-hems-targeting.ts** | `backend/src/bff/handlers/get-hems-targeting.ts` | **新增** | 中 | 無 | 提供 fleet-wide gateway eligibility 數據 |
| **BFF — bff-stack.ts** | `backend/lib/bff-stack.ts` | **改** | 低 | 新 handler 就緒 | 註冊 1 條新路由 |
| **BFF — post-hems-batch-dispatch.ts** | `backend/src/bff/handlers/post-hems-batch-dispatch.ts` | **不動** | — | — | v6.0 已實現，直接復用 |
| **BFF — get-hems-batch-history.ts** | `backend/src/bff/handlers/get-hems-batch-history.ts` | **不動** | — | — | v6.0 已實現，直接復用 |
| **M3 — command-dispatcher.ts** | `backend/src/dr-dispatcher/services/command-dispatcher.ts` | **不動** | — | — | pending→dispatched 邏輯不變 |
| **M1 — command-publisher.ts** | `backend/src/iot-hub/services/command-publisher.ts` | **不動** | — | — | dispatched→MQTT 邏輯不變 |

### 風險等級定義

| 等級 | 定義 |
|------|------|
| 高 | 大範圍重寫，錯誤會導致 P4 頁面不可用 |
| 中 | 局部新增，影響可控但需仔細測試 |
| 低 | 增量式加法，不影響現有行為 |

### v6.0 vs v6.4 範圍差異

| 維度 | v6.0 | v6.4 |
|------|------|------|
| **Backend** | 新增 batch-dispatch + batch-history API、DDL | **不動**——直接復用 |
| **Frontend** | 三步流程、無 eligibility、無 schedule bars | 四步工作台、eligibility 計算、schedule bar、確認 modal |
| **New API** | — | `GET /api/hems/targeting`（gateway fleet eligibility data） |

---

## 2. 架構概覽

### v6.4 P4 在系統中的位置

```
                     ┌─────────────────┐
                     │  P4 前端 (v6.4) │
                     │  p4-hems.js     │
                     └─────┬───────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
     GET /api/hems/   POST /api/hems/  GET /api/hems/
     targeting        batch-dispatch   batch-history
     (NEW)            (v6.0 existing)  (v6.0 existing)
              │            │            │
              ▼            ▼            ▼
           ┌──────────────────────────────┐
           │          PostgreSQL           │
           │  gateways + device_command_   │
           │  logs + organizations + assets│
           └──────────┬───────────────────┘
                      │
                      ▼ (after batch-dispatch)
           ┌────────────────────┐
           │ M3 pending→dispatched│
           │ M1 dispatched→MQTT   │
           └────────────────────┘
```

### 核心設計原則

1. **Frontend-heavy**: 大部分 v6.4 工作是前端重寫；後端只新增 1 個 GET endpoint
2. **Client-side eligibility**: eligibility 計算（可下發/已一致/阻塞/離線）在前端基於 targeting API 返回的數據完成
3. **Reuse v6.0 dispatch pipeline**: POST batch-dispatch 和 GET batch-history 完全復用，不做任何修改
4. **No framework migration**: 使用 current frontend-v2 vanilla JS stack

---

## 3. 前端架構

### 3.1 頁面模塊結構

`p4-hems.js` 完全重寫。新模塊結構：

```javascript
var HEMSPage = {
  // ── State ──
  _mode: null,                    // 'self_consumption' | 'peak_shaving' | 'peak_valley_arbitrage'
  _socMin: 20,                    // 5-50
  _socMax: 95,                    // 70-100
  _gridImportLimitKw: 50,         // peak_shaving only
  _arbGrid: Array(24).fill(null), // charge | discharge | null
  _arbBrush: 'charge',

  _gateways: [],                  // from targeting API
  _selected: {},                  // { gwId: true/false }
  _filters: { integrator: 'all', home: 'all', status: 'all', mode: 'all' },
  _batchHistory: [],
  _dispatchState: 'idle',         // idle | dispatching | done

  // ── Computed (derived from state, not stored) ──
  // _classify(gw)      → 'eligible' | 'same' | 'conflict' | 'offline'
  // _impactCounters()   → { eligible, same, conflict, offline, selected, willChange }
  // _visibleGateways()  → filtered gateway list
  // _targetSchedule()   → DomainSlot[] for the current mode/arb config

  // ── Lifecycle ──
  init: function() { ... },
  onRoleChange: function() { ... },

  // ── Render methods (one per UI section) ──
  _render: function() { ... },           // full page re-render
  _renderHeader: function() { ... },
  _renderStrategy: function() { ... },   // Step 1
  _renderImpact: function() { ... },     // Step 2
  _renderTargeting: function() { ... },  // Step 3
  _renderReview: function() { ... },     // Step 4

  // ── Components ──
  _buildMiniBar: function(slots) { ... },
  _buildArbEditor: function() { ... },
  _buildConfirmModal: function() { ... },

  // ── Event handlers ──
  _setupListeners: function() { ... },
  _handleDispatch: function() { ... },
};
```

### 3.2 State management

**設計決策：Plain JS object model。**

理由：
- frontend-v2 全局使用 plain objects（DemoStore 也只是 sessionStorage wrapper）
- 頁面不需要跨組件通信——所有 state 在 HEMSPage 單一對象內
- 引入 reactive library（MobX, Zustand）會增加 bundle size 且脫離現有 codebase 慣例

**State 更新模式：**
```
user interaction → update state property → _render() full re-render
```

全頁 re-render 在 vanilla JS 下可接受（targeting table ~100 rows × 9 columns ≈ O(1000) DOM elements，重繪 < 16ms）。不需要 virtual DOM diffing。

### 3.3 Two-layer model: eligibility vs selection

REQ 明確要求兩個獨立的狀態層：

**Layer 1: Eligibility（由 gateway 數據 + 選定策略決定）**

```javascript
_classify: function(gw) {
  // Strategy prerequisite gate (REQ R1): before a strategy is chosen,
  // no gateway may be classified as dispatchable/eligible.
  if (this._mode === null) {
    return gw.status !== 'online' ? 'offline' : 'no_strategy';
  }
  if (gw.status !== 'online') return 'offline';
  if (gw.hasActiveCommand) return 'conflict';
  if (this._currentMatchesTarget(gw)) return 'same';
  return 'eligible';
}
```

**Pre-strategy state (`_mode === null`):** When no strategy has been selected, `_classify()` returns `'no_strategy'` for all online gateways. This state means:
- Gateway checkboxes are **disabled** (same as conflict/offline)
- Bulk-select buttons ("選取將變更", "選取全部可選") are **disabled**
- Impact counters show 0 for eligibility and selection counters
- The targeting table renders fleet context (gateway list, status, current schedule) but does **not** show "dispatchable" or "will change" semantics
- The `'no_strategy'` classification is **not** an eligibility badge — rows display a neutral state (no eligibility badge) until a strategy is chosen

**Offline normalization rule (REQ R3):** Until a formal `lifecycle_status` / decommissioning model exists, Page 4 treats all non-`online` backend gateway statuses as `offline` for display, filtering, and eligibility. The `_classify()` check `gw.status !== 'online'` implements this: any backend status value other than `'online'` results in the `'offline'` classification. There is no `'decommissioned'` display state on Page 4. The status filter uses product-level dispatch semantics (`all` / `online` / `offline`), not raw backend status values.

`_currentMatchesTarget(gw)` 比較 gateway 的 current schedule (from API) 與 operator 選擇的 target strategy：
- self_consumption / peak_shaving: compare `gw.currentMode === this._mode`
- peak_valley_arbitrage: compare `gw.currentSlots` deep-equal target arbSlots

**Layer 2: Selection（operator 手動操作）**

```javascript
// _selected: { 'GW-BR-001': true, 'GW-BR-005': true }
// Only 'eligible' and 'same' gateways can be selected
// 'conflict' and 'offline' have disabled checkboxes
```

**Impact counters (computed from both layers):**

```javascript
_impactCounters: function() {
  var self = this;
  var counters = { eligible: 0, same: 0, conflict: 0, offline: 0, selected: 0, willChange: 0 };
  (this._gateways || []).forEach(function(gw) {
    var cls = self._classify(gw);
    counters[cls]++;
    if (self._selected[gw.gatewayId]) {
      counters.selected++;
      if (cls === 'eligible') counters.willChange++;
      // 'same' gateways that are selected count as selected but not willChange
    }
  });
  return counters;
}
```

### 3.4 Step flow implementation

v6.4 uses a **single-page, all-steps-visible** layout (not a wizard with prev/next buttons like v6.0).

All four steps are rendered simultaneously on the page:
1. Strategy selector (always active)
2. Impact counter strip (updates reactively)
3. Targeting table (updates reactively)
4. Review panel (dormant until selection exists)

Step numbers are visual labels (①②③④) to guide the operator's mental flow, not navigation states. This matches the v4 mock design.

**Key difference from v6.0:** v6.0 used `_currentStep` + `_nextStep()` / `_prevStep()` to show one step at a time. v6.4 shows all steps simultaneously, which enables the operator to adjust strategy while seeing the targeting table update in real time.

---

## 4. UI Component Breakdown

### 4.1 Strategy Selector (Step 1)

**Three mode cards** in a `grid-template-columns: repeat(3, 1fr)` layout:

| Mode | Key | Accent Color | Icon |
|------|-----|-------------|------|
| 自發自用 | `self_consumption` | `--green` | ☀️ |
| 削峰 | `peak_shaving` | `--amber` | ⚡ |
| 峰谷套利 | `peak_valley_arbitrage` | `--violet` | 📊 |

Active card: `.active` class → green border glow + dot indicator.

**Parameter strip** (always visible when mode is selected):
- SoC 下限 slider: 5–50%, default 20
- SoC 上限 slider: 70–100%, default 95
- Grid import limit slider: 10–80 kW (peak_shaving only, hidden otherwise)

**Arbitrage 24h editor** (visible only when peak_valley_arbitrage selected):
- Described in Section 8 below.

### 4.2 Impact Counter Strip (Step 2)

**Layout:** Single horizontal strip with 6 cells, separated by `|` borders.

| Cell | Label | Color | Source |
|------|-------|-------|--------|
| 可下發 | `counters.eligible` | green | Eligibility layer |
| 已一致 | `counters.same` | blue | Eligibility layer |
| 阻塞 | `counters.conflict` | amber | Eligibility layer |
| 離線 | `counters.offline` | red | Eligibility layer |
| 已選擇 | `counters.selected` | text default | Selection layer |
| 將變更 | `counters.willChange` | green accent | Selection layer |

The first four are **eligibility counters**; the last two are **selection counters**. REQ requires these be visually distinguishable — use a subtle separator or grouping.

**Reactive update:** counters recompute on any of:
- Mode change
- SoC/parameter change (only affects same/eligible boundary for arb mode)
- arbGrid change
- Gateway selection change

### 4.3 Targeting Table (Step 3)

**Layout:** Compact `<table>` grid. Not a card wall.

**Columns:**

| # | Column | Content | Width |
|---|--------|---------|-------|
| 1 | Checkbox | `<input type="checkbox">`, disabled for conflict/offline | 30px |
| 2 | Gateway | Gateway ID | auto |
| 3 | 站點 | Home alias / site name | auto |
| 4 | 狀態 | Online/offline badge | auto |
| 5 | 當前策略 | Current mode label | auto |
| 6 | 匹配 | Eligibility badge (可下發/已一致/阻塞/離線) | auto |
| 7 | 設備 | Device count | auto |
| 8 | 目前排程 (24h) | Mini schedule bar (current) | 100px min |
| 9 | 目標排程 (24h) | Mini schedule bar (target) | 100px min |

**Row styling:**
- Selected rows: green tint (`.sel`)
- Conflict rows: amber tint + conflict reason inline
- Offline rows: red tint + muted text

**Blocked gateway display (REQ 要求):**
- Checkbox disabled
- Row background tinted amber
- Below the gateway ID cell, a `.conflict-reason` element shows:
  - Icon + short reason (e.g., "指令執行中")
  - Clickable detail toggle → popover with: block reason detail, blocking batch ID, recommended action

**Filter controls above table:**
- Integrator dropdown (populated from `unique(gateways, 'integrator')`)
- Site/home dropdown
- Online status dropdown (all / online / offline)
- Current strategy dropdown
- Action buttons: 選取將變更 / 選取全部可選 / 清空 / 重設篩選
  - **Strategy gate (REQ R1):** All bulk-select action buttons are disabled when `_mode === null`. Checkboxes on individual rows are also disabled pre-strategy. The page must not show "dispatchable" or "will change" semantics before a target strategy exists.

**"Select" button semantics:**

REQ defines `已一致` (same-schedule) gateways as selectable — an operator may deliberately
re-dispatch to them. Two bulk-select buttons serve distinct intents:

| Button | Label | Selects | Use case |
|--------|-------|---------|----------|
| Primary | **選取將變更** | `eligible` only | Default workflow — select gateways that will actually change |
| Secondary | **選取全部可選** | `eligible` + `same` | Re-dispatch workflow — operator wants to force-refresh all reachable gateways |

Neither button selects `conflict` or `offline` gateways (non-selectable per REQ).

```javascript
_selectWillChange: function() {
  var self = this;
  this._visibleGateways().forEach(function(gw) {
    var cls = self._classify(gw);
    if (cls === 'eligible') {
      self._selected[gw.gatewayId] = true;
    }
  });
  this._render();
},

_selectAllSelectable: function() {
  var self = this;
  this._visibleGateways().forEach(function(gw) {
    var cls = self._classify(gw);
    if (cls === 'eligible' || cls === 'same') {
      self._selected[gw.gatewayId] = true;
    }
  });
  this._render();
}
```

**Legend row** between filters and table:
- Eligibility badges: 可下發 / 已一致 / 衝突-不可選 / 離線-不可選
- Schedule bar legend: self-consumption (green) / peak shaving (amber) / charge (cyan) / discharge (violet)

### 4.4 Review Panel (Step 4)

**Dormant state:** When `_getSelectedIds().length === 0`:
- Panel has `.dormant` class (opacity: 0.45)
- Shows: "尚未選擇 Gateway。完成第 3 步後這裡才會啟動。"
- Review body hidden

**Review activation rule (REQ R2):**
- The dormant state is valid **only** when the selected gateway set is empty (`_getSelectedIds().length === 0`).
- Once one or more gateways are selected, the review panel **must** activate and reflect the actual selected set. The transition is wired reactively via `_render()` — any selection change triggers re-evaluation.
- **Consistency invariant:** The page must never simultaneously show non-zero `已選擇` / `將變更` counters in the impact strip and a dormant "no gateways selected" review panel. If the counters show selection, the review panel must be active.

**Active state:** When targets exist:
- Two-column layout: `grid-template-columns: 1.2fr 0.8fr`
- Left: scrollable review card list (per-gateway)
- Right: dispatch summary box (sticky)

**Per-gateway review card:**
```html
<div class="rv-card">
  <h4>GW-BR-001 · 晨光宅</h4>
  <div class="rv-meta">Solfacil 華東 · 3 devices · online</div>
  <div class="rv-schedules">
    <div class="rv-sched-row"><span>目前</span> [mini-bar: current]</div>
    <div class="rv-sched-row"><span>目標</span> [mini-bar: target]</div>
  </div>
</div>
```

**Dispatch summary box:**
- Strategy mode + icon
- SoC range
- Grid limit (if peak_shaving)
- Selected count / will-change count / blocked count
- Status chain visualization: `已選取 → 驗證中 → 下發中 → 完成`
- Primary button: "檢視並確認下發" → opens confirmation modal
- Retry button (disabled until dispatch completes with retryable failures)

**Batch history:** Collapsible `<details>` section with recent batches.

### 4.5 Confirmation Modal

**Trigger:** "檢視並確認下發" button in review panel.

**Modal content (REQ safety requirements):**

```
┌─────────────────────────────────────┐
│ ⚠ 確認批次下發                        │
│ 請仔細檢查以下變更摘要，確認後不可撤回。  │
│                                      │
│ 策略與參數                            │
│   模式: ☀️ 自發自用                   │
│   SoC: 20% – 95%                     │
│                                      │
│ 目標排程預覽                          │
│   [========== mini-bar ===========]  │
│                                      │
│ 影響範圍                              │
│   目標數量: 3                         │
│   將變更: 2                           │
│   已一致: 1                           │
│   阻塞（不下發）: 1                    │
│                                      │
│ ⚠ 1 台 Gateway 因阻塞而不會下發        │ (warning banner, shown when blocked > 0)
│                                      │
│ 阻塞的 Gateway（不會下發）              │ (shown when blocked > 0)
│   GW-BR-003: 指令執行中 (batch-002)   │
│                                      │
│ [取消]   [確認下發 — 不可撤回]          │
└─────────────────────────────────────┘
```

**Final dispatch button styling:**
- CSS class: `.btn.danger` → red background, white text, 13px font-weight 800
- Label: "確認下發 — 不可撤回"
- NOT the default focus (cancel button gets focus)
- Disabled until operator has scrolled/reviewed

**Cancel button:** `.btn` (neutral), easily accessible, positioned left of confirm.

### 4.6 Batch History Section

Embedded in the review panel as a collapsible `<details>`.

Each history item shows: batch ID, mode label, time, gateway count, changed count, result summary.

Data source: `DataSource.hems.batchHistory(20)` (existing v6.0 API).

---

## 5. Data Flow

### 5.1 Page Load

```
init()
  │
  ├─ DataSource.hems.gatewayTargeting()     → GET /api/hems/targeting
  │   → _gateways = response.data.gateways
  │
  ├─ DataSource.hems.batchHistory(20)       → GET /api/hems/batch-history?limit=20
  │   → _batchHistory = response.data.batches
  │
  └─ (parallel via Promise.all)
      │
      ▼
  _render()  → build full page with all 4 steps
```

### 5.2 Strategy Change

```
user clicks mode card / adjusts slider / paints arb grid
  │
  ├─ update _mode / _socMin / _socMax / _gridImportLimitKw / _arbGrid
  │
  ├─ recompute: _classify(gw) for all gateways (client-side)
  │             _impactCounters() (client-side)
  │             _targetSchedule() (client-side)
  │
  └─ _render()  → impact strip, targeting table, review panel all update
```

No API call. All computation is client-side.

### 5.3 Selection Change

```
user clicks checkbox / "select all eligible" / "clear"
  │
  ├─ update _selected
  │
  ├─ recompute: _impactCounters().selected, .willChange
  │
  └─ _render()  → impact strip selected/willChange counters update,
                   review panel transitions dormant↔active
```

No API call.

### 5.4 Dispatch Flow

```
user clicks "檢視並確認下發"
  │
  ├─ _buildConfirmModal()  → show modal overlay
  │
  user clicks "確認下發 — 不可撤回"
  │
  ├─ _dispatchState = 'dispatching'
  ├─ disable buttons
  │
  ├─ POST /api/hems/batch-dispatch
  │   body: { mode, socMinLimit, socMaxLimit, gridImportLimitKw?, arbSlots?, gatewayIds }
  │
  ├─ on success:
  │   ├─ parse response.data.results (per-gateway: pending / skipped)
  │   ├─ parse response.data.summary (total, pending, skipped)
  │   ├─ update UI: show per-gateway results
  │   ├─ show toast (success / warning if skipped > 0)
  │   ├─ close modal
  │   ├─ refresh batch history (GET /api/hems/batch-history)
  │   └─ _dispatchState = 'done'
  │
  └─ on error:
      ├─ show toast (error)
      ├─ re-enable buttons
      └─ _dispatchState = 'idle'
```

### 5.5 Batch History

```
_render() for history section
  │
  └─ iterate _batchHistory → build collapsible list
     each item: batchId, mode (from samplePayload.slots[0].mode),
                dispatchedAt (formatted), total, successCount, failedCount
```

---

## 6. API Dependencies

### 6.1 Existing APIs (v6.0, NO CHANGES)

| API | Handler | Used for |
|-----|---------|----------|
| `POST /api/hems/batch-dispatch` | `post-hems-batch-dispatch.ts` | Execute dispatch |
| `GET /api/hems/batch-history` | `get-hems-batch-history.ts` | Batch history display |

Contract details: see DESIGN-v6.0-P4-batch-dispatch.md §6.

### 6.2 Existing API (v6.2, NO CHANGES)

| API | Handler | Used for |
|-----|---------|----------|
| `GET /api/gateways` | `get-gateways.ts` | **NOT used by P4 directly** — targeting endpoint replaces this need |

### 6.3 New API: GET /api/hems/targeting

**設計決策：** 新增專用 endpoint，而非復用 `GET /api/gateways`。

**理由：**
- P4 需要 gateway 數據 + latest successful schedule + active command status 三者 JOIN
- `GET /api/gateways` 只返回 gateway list + basic info，缺少 schedule 和 command status
- 添加這些到 `GET /api/gateways` 會讓該通用 endpoint 過度膨脹
- 專用 endpoint 可以用 batch query 優化（見 DESIGN-v6.0-P4 §2 的批量查詢策略）

**權限：** SOLFACIL_ADMIN, ORG_MANAGER, ORG_OPERATOR（與 batch-dispatch 相同角色）

**Request:** `GET /api/hems/targeting`

**Response 200:**
```typescript
interface HEMSTargetingResponse {
  success: true;
  data: {
    gateways: Array<{
      gatewayId: string;
      name: string;
      homeAlias: string | null;       // from gateways.home_alias (v6.2)
      integrator: string;              // organization name
      status: 'online' | 'offline';    // REQ R3: backend normalizes all non-'online' statuses to 'offline'
      deviceCount: number;
      lastSeenAt: string | null;       // ISO 8601
      currentMode: string | null;      // from latest successful schedule
      currentSlots: Array<{            // from latest successful schedule payload_json
        mode: string;
        action?: string;               // charge | discharge (arb only)
        startMinute: number;
        endMinute: number;
      }> | null;
      hasActiveCommand: boolean;       // true if pending/dispatched/accepted command exists
      activeCommandBatchId: string | null;  // for conflict reason display
    }>;
  };
}
```

**SQL (3 queries, matching v6.0 batch query strategy):**

**Query 1 — Gateway list with device count:**
```sql
SELECT
  g.gateway_id,
  g.name,
  g.home_alias,
  o.name AS integrator,
  g.status,
  g.last_seen_at,
  COUNT(a.id) AS device_count
FROM gateways g
LEFT JOIN organizations o ON o.id = g.org_id
LEFT JOIN assets a ON a.gateway_id = g.gateway_id
WHERE ($1::VARCHAR IS NULL OR g.org_id = $1)
GROUP BY g.gateway_id, g.name, g.home_alias, o.name, g.status, g.last_seen_at
```

**Query 2 — Latest successful schedule per gateway:**
```sql
SELECT DISTINCT ON (gateway_id)
  gateway_id, payload_json
FROM device_command_logs
WHERE gateway_id = ANY($1)
  AND command_type = 'set'
  AND config_name = 'battery_schedule'
  AND result IN ('success', 'accepted')
ORDER BY gateway_id, created_at DESC
```

**Query 3 — Active commands per gateway (most recent blocking batch):**
```sql
SELECT DISTINCT ON (gateway_id)
       gateway_id, batch_id
FROM device_command_logs
WHERE gateway_id = ANY($1)
  AND command_type = 'set'
  AND config_name = 'battery_schedule'
  AND result IN ('pending', 'dispatched', 'accepted')
ORDER BY gateway_id, created_at DESC
```

> **Rationale:** A gateway may have active commands from multiple batches.
> `DISTINCT ON (gateway_id) ... ORDER BY created_at DESC` guarantees exactly
> one row per gateway — the most recent blocking batch — preventing the
> silent-overwrite bug that would occur with a plain `DISTINCT gateway_id, batch_id`
> fed into a `Map` constructor.

**Application-level merge:**
```typescript
// Build maps from Q2 and Q3 (Q3 already returns 1 row per gateway)
const scheduleMap = new Map(q2Rows.map(r => [r.gateway_id, r.payload_json]));
const activeMap = new Map(q3Rows.map(r => [r.gateway_id, r.batch_id]));

// Merge into Q1 results
const gateways = q1Rows.map(g => ({
  gatewayId: g.gateway_id,
  name: g.name,
  homeAlias: g.home_alias,
  integrator: g.integrator,
  status: g.status,
  deviceCount: g.device_count,
  lastSeenAt: g.last_seen_at,
  currentMode: extractMode(scheduleMap.get(g.gateway_id)),
  currentSlots: extractSlots(scheduleMap.get(g.gateway_id)),
  hasActiveCommand: activeMap.has(g.gateway_id),
  activeCommandBatchId: activeMap.get(g.gateway_id) || null,
}));
```

**效能：** 3 queries for any fleet size. Gateway count < 200 per org → total response time < 300ms.

---

## 7. Schedule Bar Rendering

### 7.1 Mini Schedule Bar Component

**設計決策：** 建立可重用的 `_buildMiniBar(slots)` 函數。

**理由：** Mini schedule bars 出現在 3 個位置：
1. Targeting table — current schedule column (per row)
2. Targeting table — target schedule column (per row)
3. Confirmation modal — target schedule preview
4. Review panel — per-gateway review cards (current + target)

Total: 4 render sites × up to 100 rows = potentially 800 mini bars. Must be lightweight.

### 7.2 Implementation

```javascript
_buildMiniBar: function(slots) {
  if (!slots || slots.length === 0) {
    return '<div class="mini-bar"><span class="seg" style="width:100%;background:rgba(255,255,255,0.04)"></span></div>';
  }
  var totalMinutes = 1440;
  var segments = slots.map(function(s) {
    var pct = ((s.endMinute - s.startMinute) / totalMinutes * 100);
    var cls = 'seg-' + _segmentClass(s);
    return '<span class="seg ' + cls + '" style="width:' + pct + '%" title="' + _segTitle(s) + '"></span>';
  });
  return '<div class="mini-bar">' + segments.join('') + '</div>';
}
```

### 7.3 Color Mapping

| Segment Type | CSS Class | Color Variable | Visual |
|-------------|-----------|---------------|--------|
| self_consumption | `.seg-self` | `--green` (#2bcc5a) | Green |
| peak_shaving | `.seg-peak` | `--amber` (#f0a820) | Amber |
| charge (arb) | `.seg-charge` | `--cyan` (#28c8e8) | Cyan |
| discharge (arb) | `.seg-discharge` | `--violet` (#8b6cf5) | Violet |

**Mapping function:**
```javascript
function _segmentClass(slot) {
  if (slot.mode === 'self_consumption') return 'self';
  if (slot.mode === 'peak_shaving') return 'peak';
  if (slot.action === 'charge') return 'charge';
  if (slot.action === 'discharge') return 'discharge';
  return 'self'; // fallback
}
```

### 7.4 Legend

Required per REQ. Rendered once above the targeting table:

```html
<div class="sched-legend">
  <span>排程色碼：</span>
  <span class="sched-legend-item"><span class="swatch swatch-self"></span>自發自用</span>
  <span class="sched-legend-item"><span class="swatch swatch-peak"></span>削峰</span>
  <span class="sched-legend-item"><span class="swatch swatch-charge"></span>充電</span>
  <span class="sched-legend-item"><span class="swatch swatch-discharge"></span>放電</span>
</div>
```

### 7.5 Target Schedule Computation (client-side)

```javascript
_targetSchedule: function() {
  if (this._mode === 'self_consumption') {
    return [{ mode: 'self_consumption', startMinute: 0, endMinute: 1440 }];
  }
  if (this._mode === 'peak_shaving') {
    return [{ mode: 'peak_shaving', startMinute: 0, endMinute: 1440 }];
  }
  // peak_valley_arbitrage: merge consecutive same-action hours
  var slots = [];
  var grid = this._arbGrid;
  var i = 0;
  while (i < 24) {
    if (!grid[i]) { i++; continue; }
    var action = grid[i];
    var start = i;
    while (i < 24 && grid[i] === action) i++;
    slots.push({
      mode: 'peak_valley_arbitrage',
      action: action,
      startMinute: start * 60,
      endMinute: i * 60
    });
  }
  return slots;
}
```

---

## 8. Arbitrage 24h Editor

### 8.1 Interaction Model

**Brush painting:**
1. Operator selects brush mode: 充電 (charge) or 放電 (discharge)
2. Click a cell → paint that hour
3. Click-drag across cells → paint continuous range
4. Mouse events: `mousedown` → `mouseenter` (while held) → `mouseup`

**Implementation:**
```javascript
var isMouseDown = false;
cells.forEach(function(cell) {
  cell.addEventListener('mousedown', function(e) {
    e.preventDefault();
    isMouseDown = true;
    self._arbGrid[cell.dataset.hour] = self._arbBrush;
    self._render();
  });
  cell.addEventListener('mouseenter', function() {
    if (!isMouseDown) return;
    self._arbGrid[cell.dataset.hour] = self._arbBrush;
    self._updateArbCellVisual(cell);
  });
});
document.addEventListener('mouseup', function() {
  if (isMouseDown) { isMouseDown = false; self._render(); }
});
```

### 8.2 Template Presets

| Template | Label | Pattern |
|----------|-------|---------|
| `enel` | Enel SP | charge 0-6, discharge 6-9, charge 9-17, discharge 17-24 |
| `night` | 夜間充電 | charge 0-6, discharge 6-24 |
| `double` | 雙充電窗 | charge 0-6, discharge 6-12, charge 12-17, discharge 17-24 |
| `clear` | 清空 | all null |

### 8.3 Coverage Validation

Coverage indicator: `XX/24` displayed below the grid.

**Dispatch blocking rule:** If `_mode === 'peak_valley_arbitrage'` and any cell is `null`, the "檢視並確認下發" button is disabled. Display hint text: "需覆蓋全部 24 小時".

---

## 9. Safety / Confirmation Layer

### 9.1 Two-Step Dispatch Flow

REQ prohibits single-click dispatch. Implementation:

**Step A:** "檢視並確認下發" button → opens `.modal-overlay` with confirmation content.

**Step B:** Inside modal, "確認下發 — 不可撤回" button → executes POST batch-dispatch.

### 9.2 Modal Data Summary

The confirmation modal must render:

| Section | Content |
|---------|---------|
| 策略與參數 | Mode icon + label, SoC range, grid limit (if applicable) |
| 目標排程預覽 | Large mini-bar showing target 24h schedule |
| 影響範圍 | 目標數量, 將變更, 已一致, 阻塞(不下發) |
| Warning banner | Shown if blocked count > 0: "X 台 Gateway 因阻塞而不會下發" |
| Blocked list | Per-gateway: ID + reason + batch ID (only if blocked > 0) |

### 9.3 Button Styling Requirements

| Button | Class | Behavior |
|--------|-------|----------|
| 取消 | `.btn` (neutral) | Closes modal, no side effects |
| 確認下發 — 不可撤回 | `.btn.danger` | Red bg, white text, 800 weight, min-width 140px |

**Focus management:** Modal opens → focus on 取消 button (NOT on confirm). Operator must deliberately navigate to danger button.

### 9.4 Post-Dispatch Result Display

After successful POST:
- Close modal
- Update review panel with per-gateway results
- Toast notification: success or warning (if skipped > 0)
- Batch history auto-refreshes
- If retryable failures exist, enable "只重試失敗" button

### 9.5 Retry Policy

REQ delegates retry policy details to DESIGN. The following rules apply:

**Retryable determination:**
A gateway's dispatch result is retryable when ALL of the following are true:
1. `status === 'skipped'` (not `'success'` or `'failed'`)
2. `reason !== 'active_command'` — a gateway skipped due to an active blocking command is NOT retryable because the blocking condition is unlikely to resolve within the same operator session

**Non-retryable cases (no retry offered):**
- `status === 'success'` — nothing to retry
- `status === 'failed'` — indicates a backend/MQTT-level failure; operator should investigate before retrying
- `status === 'skipped'` with `reason === 'active_command'` — blocking condition persists; retry would produce the same skip

**Retry mechanism:**
- "只重試失敗" button re-invokes `POST /api/hems/batch-dispatch` with only the retryable gateway IDs
- Strategy and schedule payload are identical to the original dispatch (no re-editing)
- Results merge into the existing result panel (retried gateways update in-place)

**Retry count:** No limit enforced in v6.4 phase 1. If repeated retries become a pattern, a future version may add a cap.

---

## 10. Risk Assessment

### 10.1 Technical Risks

| # | Risk | Severity | Probability | Mitigation |
|---|------|----------|-------------|------------|
| R1 | **p4-hems.js 重寫破壞現有 dispatch 功能** | 高 | 中 | 逐 Phase 重寫（先骨架，後 dispatch）；保留 v6.0 代碼直到 Phase 2 驗證通過 |
| R2 | **Targeting API 效能 — fleet > 100 gateways** | 中 | 低 | 3 batch queries + application merge（已在 v6.0 驗證過的模式） |
| R3 | **Full-page re-render 在大量 gateway 下卡頓** | 低 | 低 | 100 rows × 9 cols ≈ 1000 DOM elements，現代瀏覽器 < 16ms |
| R4 | **Arbitrage editor mouseenter 事件在 mobile 不生效** | 中 | 中 | 添加 touch event 支持（touchstart/touchmove）作為 Phase 3 polish |
| R5 | **Schedule bar 數據格式不一致**（v6.0 早期 payload vs 新格式） | 中 | 低 | `extractSlots()` 做 defensive parsing with fallback |
| R6 | **DemoStore 依賴** | 低 | 低 | P4 不依賴 DemoStore；完全自帶 targeting API |

### 10.2 Migration from Current p4-hems.js

**v6.0 p4-hems.js 保留清單：**
- `_modeKeys` metadata → 保留概念，更新色彩/key 對應
- `_buildArbSlots()` → 直接復用
- `_applyArbTemplate()` → 直接復用
- `_validateStep1()` → 改名為 `_isArbComplete()`
- `_showToast()` → 直接復用
- `_showConfirmDialog()` → 重寫為 full confirmation modal

**v6.0 p4-hems.js 刪除清單：**
- `_currentStep` / `_nextStep()` / `_prevStep()` / `_buildStepIndicator()` — 不再是 wizard 流程
- `_buildStep1/2/3()` — 替換為 `_renderStrategy/Targeting/Review()`
- `_buildBatchHistory()` — 重寫為 collapsible details

---

## 11. CSS Architecture

### 11.1 新增 CSS 範圍

v6.4 P4 的 CSS 直接在 `frontend-v2/css/style.css` 的 P4 section 中更新（與 v6.0 相同位置）。

**Key CSS classes (from v4 mock):**

| Component | Classes |
|-----------|---------|
| Strategy cards | `.s-card`, `.s-card.active` |
| Parameter strip | `.params-strip`, `.param-item` |
| Arb editor | `.arb-section`, `.arb-grid`, `.arb-cell`, `.arb-cell.charge`, `.arb-cell.discharge` |
| Impact strip | `.impact-strip`, `.impact-cell` |
| Targeting table | `.gw-table`, `.gw-table tr.sel`, `.gw-table tr.row-conflict`, `.gw-table tr.row-offline` |
| Mini schedule bar | `.mini-bar`, `.seg`, `.seg-self`, `.seg-peak`, `.seg-charge`, `.seg-discharge` |
| Schedule legend | `.sched-legend`, `.sched-legend-item`, `.swatch-*` |
| Eligibility badges | `.sb-eligible`, `.sb-same`, `.sb-conflict`, `.sb-offline` |
| Conflict reason | `.conflict-reason`, `.conflict-popover` |
| Review panel | `.review-panel`, `.review-panel.dormant`, `.review-grid`, `.rv-card` |
| Dispatch box | `.dispatch-box`, `.d-row`, `.chain`, `.chain-step` |
| Confirm modal | `.modal-overlay`, `.modal`, `.modal-kv`, `.modal-warning`, `.btn.danger` |
| Batch history | `.history-section`, `.hist-list`, `.hist-item` |

### 11.2 Responsive Breakpoints

From v4 mock:
- `> 1100px`: default layout (review-grid 2-column, arb 24-column)
- `800-1100px`: review-grid 1-column, arb 12-column
- `< 800px`: strategy-row 1-column, impact-strip vertical, filters stacked

---

## 12. 驗證要求

### 12.1 Admin-Role Live Validation (REQ R4)

Page 4 product acceptance requires validation against at least one real online gateway under an admin-role session. A Page 4 build is not product-accepted merely because the structure renders under a manager account with all-offline data. The following must be observed during live validation:

- **Dispatchability:** At least one gateway classified as `eligible` (可下發) under a chosen strategy
- **Consistency state:** At least one gateway classified as `same` (已一致) to verify the consistency detection logic
- **Selection flow:** End-to-end selection → impact counter update → review panel activation
- **Strategy prerequisite:** Verify that checkboxes and bulk-select are gated before strategy selection (`_mode === null`)
- **Offline normalization:** Verify that non-online gateways display as `offline` with no speculative lifecycle states

---

## 13. 安全性考量

| 項目 | 設計決策 | 說明 |
|------|---------|------|
| RLS | targeting 端點透過 `queryWithOrg` 確保 org 隔離 | 與 v6.0 batch-dispatch 一致 |
| RBAC | GET targeting: SOLFACIL_ADMIN + ORG_MANAGER + ORG_OPERATOR | 與 POST batch-dispatch 一致角色 |
| 輸入驗證 | 前端驗證 + 後端驗證雙重 | arbSlots 覆蓋度、soc 範圍、mode enum 白名單 |
| XSS | Gateway name / home alias 使用 text escaping | `esc()` 函數處理所有 user-generated strings |
| Two-step dispatch | Modal 確認層強制 | 防止誤操作 |
| Focus management | Danger button 非默認焦點 | 防止 Enter 鍵誤觸 |
