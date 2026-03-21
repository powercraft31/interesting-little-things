# PLAN-v6.4-P4-HEMS-Control-Workbench

**Version:** 6.4
**Date:** 2026-03-21
**REQ:** REQ-v6.4-P4-HEMS-Control-Workbench.md
**DESIGN:** DESIGN-v6.4-P4-HEMS-Control-Workbench.md
**Status:** Draft

---

## 1. 任務拆解

### Phase 1：Core Workbench Skeleton — 策略選擇 + 影響計算 + 目標表（唯讀）

> **目標：** 頁面骨架就位，四步流程可視，策略切換能驅動 impact counters 和 targeting table 更新。不含 dispatch 功能。
> **獨立可測試：** 是 — 可用 mock 數據驗證 eligibility 計算和 UI 反應性。

---

#### T1: BFF — get-hems-targeting.ts 新建（gateway fleet eligibility endpoint）

| 項目 | 內容 |
|------|------|
| **文件** | `backend/src/bff/handlers/get-hems-targeting.ts`（**新建**） |
| **改動** | 3 次 batch query → merge → 回傳 HEMSTargetingResponse |
| **預計行數** | ~120 行 |
| **前置** | 無（查詢現有表） |
| **可並行** | 與 T2、T3 並行 |

**詳細步驟：**

1. 建立 handler，接受 auth middleware（SOLFACIL_ADMIN, ORG_MANAGER, ORG_OPERATOR）
2. **Query 1:** SELECT gateways + org name + device count（見 DESIGN §6.3 SQL）
3. **Query 2:** DISTINCT ON(gateway_id) 讀最新成功排程的 payload_json（復用 DESIGN-v6.0-P4 §2 的 SQL）
4. **Query 3:** SELECT DISTINCT gateway_id, batch_id WHERE result IN ('pending','dispatched','accepted')
5. Application merge: 組合三次查詢結果為 `HEMSTargetingResponse`
6. `extractMode()`: 從 payload_json.slots[0].mode 取 currentMode
7. `extractSlots()`: 從 payload_json.slots 取 currentSlots（defensive parsing, 格式異常 → null）
8. Org 過濾: 非 admin 角色透過 `queryWithOrg` 自動 RLS

**驗收：**
- [ ] 回傳正確的 gateway list + schedule + active command status
- [ ] Non-admin 只能看到自己 org 的 gateways
- [ ] payload_json 格式異常時 currentMode/currentSlots 回 null（不 crash）

---

#### T2: BFF — bff-stack.ts 路由註冊

| 項目 | 內容 |
|------|------|
| **文件** | `backend/lib/bff-stack.ts` |
| **改動** | 註冊 `GET /api/hems/targeting` 路由 |
| **預計行數** | +5 行 |
| **前置** | T1 |
| **可並行** | 否（依賴 T1） |

**詳細步驟：**
1. 在 HEMS route section 新增 `GET /api/hems/targeting` → `get-hems-targeting` handler
2. 確保 auth middleware 一致

---

#### T3: Frontend — data-source.js 新增 hems.gatewayTargeting()

| 項目 | 內容 |
|------|------|
| **文件** | `frontend-v2/js/data-source.js` |
| **改動** | 新增 `hems.gatewayTargeting()` 方法 + mock fallback |
| **預計行數** | +15 行 |
| **前置** | 無（可先用 mock） |
| **可並行** | 與 T1 並行 |

**詳細步驟：**
1. 在 `hems` 對象中新增：
   ```javascript
   gatewayTargeting: function() {
     return withFallback(
       function() { return apiGet('/api/hems/targeting'); },
       typeof MOCK_DATA !== 'undefined' && MOCK_DATA.HEMS_TARGETING
         ? MOCK_DATA.HEMS_TARGETING : { gateways: [] }
     );
   }
   ```
2. 在 `mock-data.js` 中新增 `HEMS_TARGETING` mock（7 gateways 含各 eligibility 狀態）

---

#### T4: Frontend — p4-hems.js Phase 1 重寫（骨架 + 策略 + impact + targeting table）

| 項目 | 內容 |
|------|------|
| **文件** | `frontend-v2/js/p4-hems.js` |
| **改動** | 完全重寫：v6.0 三步 wizard → v6.4 四步同頁工作台（Phase 1 scope: Steps 1-3 only, Step 4 dormant placeholder） |
| **預計行數** | ~500 行（取代現有 977 行中的 Step 1 + Step 2 邏輯） |
| **前置** | T3 (data-source API) |
| **可並行** | 否（依賴 T3） |

**詳細步驟：**

**4a. 模塊骨架 + state 初始化**
1. 重寫 `HEMSPage` 對象結構（見 DESIGN §3.1）
2. State properties: `_mode`, `_socMin`, `_socMax`, `_gridImportLimitKw`, `_arbGrid`, `_arbBrush`, `_gateways`, `_selected`, `_filters`
3. `init()`: `Promise.all([DataSource.hems.gatewayTargeting(), DataSource.hems.batchHistory(20)])` → `_render()`

**4b. Header + instruction line**
4. Page title: "HEMS 控制工作台"
5. Active mode chip (top right, updates on mode change)
6. Instruction line: "操作順序：先選策略 → 看影響 → 選 Gateway → 確認下發"

**4c. Step 1 — Strategy selector**
7. Three mode cards with click-to-select
8. Parameter strip: SoC min/max sliders, grid limit slider (peak_shaving only)
9. Arbitrage 24h editor: brush painting, template presets, coverage indicator
10. Port `_applyArbTemplate()` from v6.0 (直接復用)
11. Port `_buildArbSlots()` from v6.0 (直接復用)

**4d. Step 2 — Impact counter strip + strategy prerequisite gate**
12. `_classify(gw)` function: returns `'no_strategy'` when `_mode === null` (REQ R1); otherwise eligible / same / conflict / offline
13. `_impactCounters()` computed function
14. Render 6 counter cells: 可下發 / 已一致 / 阻塞 / 離線 | 已選擇 / 將變更
15. Wire reactive update: mode change → recompute → re-render strip

**4e. Step 3 — Targeting table (read-only, selection enabled)**
16. Filter controls: integrator, home, status, mode dropdowns + action buttons
17. Legend row: eligibility badges + schedule bar color legend
18. `_buildMiniBar(slots)` reusable function
19. `_targetSchedule()` function
20. Table render: checkbox (disabled for conflict/offline), gateway, site, status, current strategy, eligibility badge, devices, current schedule bar, target schedule bar
21. Row styling: `.sel` for selected, `.row-conflict` for blocked, `.row-offline` for offline
22. Blocked row conflict reason display (inline + popover)
23. Checkbox logic: toggle `_selected[gwId]`, "選取將變更" (`_selectWillChange`), "選取全部可選" (`_selectAllSelectable`), "清空"
    - **Strategy gate (REQ R1):** All checkboxes and bulk-select buttons disabled when `_mode === null`. No "dispatchable"/"will change" semantics before strategy is chosen.
24. Filter logic: `_visibleGateways()` applies all filters

**4f. Step 4 — Review panel (dormant placeholder only in Phase 1)**
25. Dormant state: "尚未選擇 Gateway。完成第 3 步後這裡才會啟動。"
26. Active/dispatch functionality deferred to Phase 2

**驗收：**
- [ ] 頁面載入顯示四步結構
- [ ] 策略卡片切換 → impact counters 更新
- [ ] Targeting table 顯示 eligibility badges 和 schedule bars
- [ ] Blocked/offline rows checkbox disabled
- [ ] Conflict reason popover 顯示
- [ ] Filter controls 正常工作
- [ ] "Select all eligible" 只選 eligible gateways
- [ ] Selection change → 已選擇/將變更 counters 更新
- [ ] Arb editor brush painting + templates work
- [ ] Arb coverage indicator 正確
- [ ] **(REQ R1)** Before strategy selection: checkboxes disabled, bulk-select buttons disabled, no eligibility badges shown, no "dispatchable"/"will change" semantics
- [ ] **(REQ R3)** All non-`online` backend gateway statuses display as `offline`; status filter uses `all`/`online`/`offline` only (no speculative lifecycle values)
- [ ] **(REQ R2 — known Phase 1 limitation)** Step 4 review panel remains dormant in Phase 1 regardless of selection state. The selection→review consistency requirement (REQ R2) will be fully implemented in Phase 2 T5.

---

### Phase 2：Dispatch Flow — 選擇、確認、下發、結果

> **目標：** 完成 Step 4 review panel、confirmation modal、dispatch 執行、result 顯示。
> **獨立可測試：** 是 — 可用 mock backend 或真實 v6.0 API 測試完整 dispatch 流程。

---

#### T5: Frontend — p4-hems.js Phase 2（review panel + confirm modal + dispatch）

| 項目 | 內容 |
|------|------|
| **文件** | `frontend-v2/js/p4-hems.js` |
| **改動** | 實現 Step 4 完整功能 |
| **預計行數** | +300 行（累計 ~800 行） |
| **前置** | T4 (Phase 1 skeleton) |
| **可並行** | 否 |

**詳細步驟：**

**5a. Review panel active state**
1. When `_getSelectedIds().length > 0`: remove `.dormant`, show `.review-body`
2. Left column: per-gateway review cards with old-vs-new schedule bars
3. Right column (sticky): dispatch summary box

**5b. Dispatch summary box**
4. Strategy mode + icon
5. SoC range display
6. Grid limit (peak_shaving only)
7. Counts: selected / will-change / blocked
8. Status chain: `已選取 → 驗證中 → 下發中 → 完成`（visual steps）

**5c. "檢視並確認下發" button**
9. Disabled when: no selection, or arb mode with incomplete coverage
10. Click → `_buildConfirmModal()`

**5d. Confirmation modal**
11. Modal overlay with backdrop click to close
12. Strategy & parameters summary section
13. Target schedule preview (large mini-bar)
14. Impact scope: target count, will-change, already-consistent, blocked
15. Warning banner: shown when blocked > 0
16. Blocked gateway list: per-gateway ID + reason + batch ID
17. Cancel button (neutral, receives initial focus)
18. "確認下發 — 不可撤回" button (`.btn.danger`, NOT default focus)

**5e. Dispatch execution**
19. Disable all buttons, show loading state
20. Build `params`: mode, socMinLimit, socMaxLimit, gridImportLimitKw?, arbSlots?, gatewayIds
21. `DataSource.hems.batchDispatch(params)` → POST /api/hems/batch-dispatch
22. On success: parse results, close modal, update UI with per-gateway results, show toast
23. On error: show error toast, re-enable buttons

**5f. Post-dispatch result display**
24. Update status chain visualization (highlight completed steps)
25. Show per-gateway results in review cards: ✅ pending / ⏭ skipped (with reason)
26. Failure box: if any failures, show failure details list
27. Refresh batch history: `DataSource.hems.batchHistory(20)`

**5g. Retry mechanism (implements DESIGN §9.5 Retry Policy)**
28. "只重試失敗" button: enabled only when retryable failures exist
29. Retry re-sends POST with only retryable gateway IDs (same strategy/schedule payload)
30. Retryable determination per DESIGN §9.5: `status === 'skipped'` AND `reason !== 'active_command'`

**驗收：**
- [ ] Review panel transitions dormant → active on first selection
- [ ] Per-gateway review cards show correct old-vs-new schedules
- [ ] "檢視並確認下發" opens confirmation modal
- [ ] Modal summarizes strategy, parameters, schedule preview, gateway counts
- [ ] Modal shows blocked gateways with reasons when applicable
- [ ] Cancel closes modal safely
- [ ] "確認下發" executes dispatch → shows results
- [ ] Post-dispatch: per-gateway success/skipped results visible
- [ ] Batch history refreshes after dispatch
- [ ] Two-step flow enforced: cannot dispatch without modal
- [ ] **(REQ R2)** Selection state consistency: non-zero selection counters in impact strip always correspond to an active (non-dormant) review panel. No split-brain between counters and review state.

---

### Phase 3：Polish — 批次歷史、邊界情況、互動細節

> **目標：** 完善所有 edge cases、batch history 完整 UI、arb editor 觸控支持、CSS 收尾。
> **獨立可測試：** 是 — 在 Phase 2 基礎上逐項 polish。

---

#### T6: Frontend — Batch history 完整 UI

| 項目 | 內容 |
|------|------|
| **文件** | `frontend-v2/js/p4-hems.js` |
| **改動** | 在 review panel 內建完整 batch history collapsible section |
| **預計行數** | +60 行 |
| **前置** | T5 |
| **可並行** | 與 T7、T8 並行 |

**詳細步驟：**
1. `<details class="history-section">` collapsible
2. Each batch item: ID, mode label, time (formatted), gateway count, success/fail counts, result summary
3. Mode label extraction: `samplePayload.slots[0].mode` → display label
4. Empty state: "尚無歷史記錄"

---

#### T7: Frontend — Edge cases & defensive handling

| 項目 | 內容 |
|------|------|
| **文件** | `frontend-v2/js/p4-hems.js` |
| **改動** | Edge case handling 完善 |
| **預計行數** | +40 行 |
| **前置** | T5 |
| **可並行** | 與 T6、T8 並行 |

**詳細步驟：**
1. Empty gateway list (0 gateways) → show "此租戶無可用 Gateway" 空狀態
2. All gateways offline → impact strip all offline, targeting table shows all offline rows, dispatch disabled
3. All gateways already-consistent → 已一致 counter highlighted, dispatch still allowed (re-dispatch)
4. Arbitrage incomplete → clear visual indicator + tooltip on disabled dispatch button
5. `esc()` function for all user-generated strings (gateway name, home alias, org name)
6. Error boundary: API failure → `showErrorBoundary()` fallback
7. Gateway with null schedule (never deployed) → show empty schedule bar, classify as eligible

---

#### T8: Frontend — Arb editor touch support + CSS polish

| 項目 | 內容 |
|------|------|
| **文件** | `frontend-v2/js/p4-hems.js` + `frontend-v2/css/style.css` |
| **改動** | Touch event 支持 + responsive CSS 收尾 |
| **預計行數** | +40 行 JS + CSS updates |
| **前置** | T5 |
| **可並行** | 與 T6、T7 並行 |

**詳細步驟：**
1. Add `touchstart` / `touchmove` / `touchend` events to arb cells
2. Touch painting: touch → identify cell under finger → paint
3. CSS responsive: verify breakpoints at 1100px and 800px
4. Ensure conflict popover positioning works at all widths
5. Verify modal scroll on small screens

---

### Phase 4：Testing

---

#### T9: 後端測試 — get-hems-targeting handler

| 項目 | 內容 |
|------|------|
| **文件** | `backend/test/bff/hems-targeting.test.ts`（**新建**） |
| **改動** | 測試 targeting API handler |
| **預計行數** | ~200 行 |
| **前置** | T1 |
| **可並行** | 與 T10 並行 |

**測試用例：**

| # | 測試用例 | 類型 |
|---|---------|------|
| 1 | 回傳所有 gateways（含 online + offline） | Unit |
| 2 | deviceCount 正確（per-gateway asset count） | Unit |
| 3 | currentMode 從 latest successful schedule 正確提取 | Unit |
| 4 | currentSlots 正確提取（含 arb multi-slot） | Unit |
| 5 | hasActiveCommand = true 當存在 pending/dispatched/accepted | Unit |
| 6 | hasActiveCommand = false 當無 active command | Unit |
| 7 | activeCommandBatchId 正確回傳 | Unit |
| 8 | gateway 從未部署（無 schedule history）→ currentMode=null, currentSlots=null | Unit |
| 9 | payload_json 格式異常 → currentMode=null, currentSlots=null, 不 crash | Unit |
| 10 | 非 admin 角色 org 過濾正確 | Integration |
| 11 | 未授權角色 → 403 | Unit |
| 12 | homeAlias fallback: null → 前端自行 fallback 到 name | Unit |

---

#### T10: 前端 E2E 測試

| 項目 | 內容 |
|------|------|
| **文件** | `frontend-v2/test/e2e/hems-workbench.test.js`（**新建**） |
| **預計行數** | ~250 行 |
| **前置** | T5 (Phase 2 完成) |
| **可並行** | 與 T9 並行 |

**測試用例：**

| # | 測試用例 | 類型 |
|---|---------|------|
| 13 | 頁面載入顯示四步結構 | E2E |
| 14 | 策略卡片切換 → impact counters 更新 | E2E |
| 15 | Arb editor brush painting 正常 | E2E |
| 16 | Arb template "Enel SP" 填充正確 | E2E |
| 17 | Blocked gateway checkbox disabled | E2E |
| 18 | Offline gateway checkbox disabled | E2E |
| 19 | "Select all eligible" 只選 eligible | E2E |
| 20 | 清空選擇 → review panel 回 dormant | E2E |
| 21 | 選擇後 → review panel active，顯示 review cards | E2E |
| 22 | "檢視並確認下發" → modal 開啟 | E2E |
| 23 | Modal 顯示策略、參數、schedule bar、gateway counts | E2E |
| 24 | Modal cancel → 關閉，不執行 dispatch | E2E |
| 25 | Modal "確認下發" → 執行 dispatch → 顯示結果 | E2E |
| 26 | Post-dispatch batch history 更新 | E2E |
| 27 | Arb 未全部填充 → dispatch 按鈕 disabled | E2E |
| 28 | 0 gateways → 顯示空狀態 | E2E |
| 29 | Filter 篩選 → table 行更新 | E2E |
| 30 | Schedule bar legend 可見 | E2E |

---

## 2. 執行順序圖

```
                    Phase 1: Core Workbench Skeleton
                    --------------------------------

Timeline:   Day 1        Day 2        Day 3
            |            |            |
    T1 BFF  [============]                       (get-hems-targeting)
    T2 Route             [====]                  (依賴 T1)
    T3 DS   [====]                               (可提前，用 mock；與 T1 並行)
    T4 FE   [====================================] (依賴 T3；大量工作)
            4a骨架  4b頭  4c策略  4d影響  4e目標  4f佔位

                    Phase 2: Dispatch Flow
                    ----------------------

Timeline:   Day 3        Day 4        Day 5
            |            |            |
    T5 FE   [====================================] (依賴 T4)
            5a review  5b summary  5c button  5d modal  5e dispatch  5f results  5g retry

                    Phase 3: Polish
                    ---------------

Timeline:   Day 5        Day 6
            |            |
    T6 Hist [============]      (與 T7, T8 並行)
    T7 Edge [============]
    T8 Touch[============]

                    Phase 4: Testing
                    ----------------

Timeline:   Day 6        Day 7
            |            |
    T9 BFF  [============]      (與 T10 並行)
    T10 E2E [============]
```

### 並行分組

| 分組 | 任務 | 並行策略 |
|------|------|---------|
| **Batch A（Day 1）** | T1 + T3 | BFF handler 和 data-source 完全獨立，可並行 |
| **Batch B（Day 2）** | T2 | 串行：依賴 T1 完成 |
| **Batch C（Day 1-3）** | T4 | 大塊前端工作，依賴 T3（但 T3 可先用 mock） |
| **Batch D（Day 3-5）** | T5 | 串行：依賴 T4 |
| **Batch E（Day 5-6）** | T6 + T7 + T8 | 3 個 polish 任務完全獨立，可並行 |
| **Batch F（Day 6-7）** | T9 + T10 | BFF 測試和 E2E 測試獨立，可並行 |

---

## 3. 依賴關係

```
T1 (BFF targeting) ─────→ T2 (route registration)
                    └───→ T9 (BFF tests)

T3 (data-source) ───────→ T4 (Phase 1 frontend)

T4 (Phase 1) ──────────→ T5 (Phase 2 dispatch)

T5 (Phase 2) ──────────→ T6 (batch history polish)
              ──────────→ T7 (edge cases)
              ──────────→ T8 (touch + CSS)
              ──────────→ T10 (E2E tests)
```

**關鍵路徑：** T3 → T4 → T5 → T10

**最早可開始 dispatch 測試：** T5 完成時（Day 5），使用既有 v6.0 batch-dispatch API。

---

## 4. 風險項

| # | 風險 | 嚴重度 | 概率 | 降級方案 |
|---|------|--------|------|---------|
| R1 | **p4-hems.js 重寫過程中現有 P4 功能中斷** | 高 | 中 | Phase 1 完成前保留 v6.0 代碼作為 fallback；Phase 1 通過驗收後切換 |
| R2 | **Targeting API 回傳數據與前端 classify 邏輯不一致** | 中 | 中 | 在 T1 完成後立即用 T9 測試驗證數據格式 |
| R3 | **Schedule payload_json 格式在早期 gateway 上不一致** | 中 | 低 | extractSlots() 做 defensive try-catch；格式異常 → null |
| R4 | **大量 gateway (>100) 下全頁 re-render 卡頓** | 低 | 低 | 測試 200 rows rendering time；若 > 32ms 則改為 partial update |
| R5 | **Arb editor touch events 在部分 Android 設備不順暢** | 低 | 中 | Phase 3 task T8；可延後至 v6.5 |
| R6 | **v6.0 batch-dispatch API 合約變更** | 低 | 極低 | v6.0 API 已穩定上線，不預期變更；若需調整在 T5 適配 |

---

## 5. 測試策略

### Phase 1 測試重點

| 測試維度 | 方法 | 說明 |
|----------|------|------|
| Eligibility 計算正確性 | Manual + mock data | 手動驗證 7 筆 mock gateways 的 classify 結果 |
| Impact counters 反應性 | Manual interaction | 切換策略 → 確認 counters 更新 |
| Mini schedule bar 渲染 | Visual inspection | 確認色彩對應和比例正確 |
| Filter 邏輯 | Manual + 組合測試 | 多 filter 組合 → 確認結果正確 |
| Blocked row UX | Manual | 確認 checkbox disabled、conflict reason 顯示 |

### Phase 2 測試重點

| 測試維度 | 方法 | 說明 |
|----------|------|------|
| Two-step dispatch flow | Manual E2E | 確認無法繞過 modal 直接 dispatch |
| Modal 內容正確性 | Visual + data comparison | Modal 顯示的數據與 targeting table 一致 |
| POST batch-dispatch 整合 | Integration test | 真實 API call → 確認 per-gateway results |
| Error handling | Forced error | Mock API 500 → 確認 toast + button re-enable |
| Focus management | Manual | Tab through modal → 確認 danger button 不是首焦 |

### Phase 3 測試重點

| 測試維度 | 方法 | 說明 |
|----------|------|------|
| Edge cases | Automated E2E | 0 gateways, all offline, all same, incomplete arb |
| Touch events | Device testing | iPad + Android tablet |
| Responsive | Browser resize | 1100px, 800px 斷點 |

### Phase 4 覆蓋目標

- Backend (get-hems-targeting): 12 test cases → target 90% branch coverage
- Frontend E2E: 18 test cases → critical user flows covered

---

## 6. 驗證檢查清單

Maps back to REQ acceptance criteria:

### A. Product positioning acceptance

| # | REQ 驗收條件 | 驗證方法 | Phase |
|---|------------|---------|-------|
| A1 | Page 4 is clearly a control workbench, not a dashboard | Visual review: no KPI cards, no trend charts | P1 |
| A2 | No analytics widgets unrelated to dispatch | Code review: no chart library calls in p4-hems.js | P1 |
| A3 | Page identity is "batch strategy changes" | Header text + instruction line check | P1 |

### B. Workflow acceptance

| # | REQ 驗收條件 | 驗證方法 | Phase |
|---|------------|---------|-------|
| B1 | Four-step flow implemented | Visual: ①②③④ sections visible | P1 |
| B2 | Steps visually numbered and sequenced | DOM inspection: .step-num elements | P1 |
| B3 | Instruction line present | DOM: .instruction element with 先選策略→看影響→選Gateway→確認下發 | P1 |
| B4 | Strategy prerequisite gates targeting (REQ R1) | Before strategy: checkboxes disabled, bulk-select disabled, no eligibility badges | P1 |
| B5 | Selection state propagates to review (REQ R2) | Non-zero selection counters → review panel active, never dormant | P2 |
| B6 | Offline normalization (REQ R3) | All non-online statuses display as offline, filter uses all/online/offline only | P1 |
| B7 | Admin-role live validation (REQ R4) | Validated against real online gateway under admin session | P4 |

### C. Strategy acceptance

| # | REQ 驗收條件 | 驗證方法 | Phase |
|---|------------|---------|-------|
| C1 | Three strategy modes available | Click each → active state | P1 |
| C2 | SoC bounds configurable | Slider interaction → value display | P1 |
| C3 | Peak shaving grid import limit | Select peak_shaving → grid limit visible | P1 |
| C4 | Arb 24h editor with brush + templates + validation | Paint cells + apply template + check coverage | P1 |
| C5 | Arb blocks dispatch when incomplete | Incomplete arb → dispatch button disabled | P2 |

### D. Impact / targeting acceptance

| # | REQ 驗收條件 | 驗證方法 | Phase |
|---|------------|---------|-------|
| D1 | Impact strip separates eligibility from selection counters | Visual: 6 cells, first 4 vs last 2 | P1 |
| D2 | Counters update reactively | Change mode → counters update; select gw → counters update | P1 |
| D3 | Targeting table is compact grid | DOM: `<table>`, not card layout | P1 |
| D4 | Blocked/offline rows non-selectable | Checkbox .disabled on conflict/offline rows | P1 |
| D5 | Blocked rows show conflict reason | .conflict-reason element visible | P1 |
| D6 | Current and target schedule bars visible per row | Two .mini-bar elements per row | P1 |
| D7 | Schedule bar legend present | .sched-legend element visible | P1 |

### E. Safety acceptance

| # | REQ 驗收條件 | 驗證方法 | Phase |
|---|------------|---------|-------|
| E1 | Two-step dispatch: open confirmation → final confirm | Click dispatch → modal opens → click confirm → dispatch executes | P2 |
| E2 | Modal summarizes strategy, parameters, schedule, counts, blocked | Modal content inspection | P2 |
| E3 | Final dispatch button: danger styling + irreversibility language | CSS class .btn.danger, text "確認下發 — 不可撤回" | P2 |
| E4 | Blocked gateways listed in modal | Modal blocked section visible when blocked > 0 | P2 |
| E5 | Cancel easily accessible | Cancel button present, receives initial focus | P2 |

### F. Post-dispatch acceptance

| # | REQ 驗收條件 | 驗證方法 | Phase |
|---|------------|---------|-------|
| F1 | Per-gateway results visible | Review cards show pending/skipped per gateway | P2 |
| F2 | Failed gateways show details | Failure box shows reasons | P2 |
| F3 | Retry limited to retryable failures | Retry button only sends failed+retryable IDs | P2 |
| F4 | Batch history records operation | History section updates after dispatch | P2 |

### G. Anti-regression acceptance

| # | REQ 驗收條件 | 驗證方法 | Phase |
|---|------------|---------|-------|
| G1 | No fleet KPI cards | Code review: no KPI card rendering | P1 |
| G2 | No energy charts or time-series | Code review: no ECharts/chart calls | P1 |
| G3 | No device drill-down | Code review: no device-level navigation | P1 |
| G4 | No generic dashboard patterns | Visual review | P1 |
| G5 | All visible info serves dispatch workflow | Content audit | P3 |

---

## 7. 文件清單總覽

| # | 文件 | 動作 | Phase | Task |
|---|------|------|-------|------|
| 1 | `backend/src/bff/handlers/get-hems-targeting.ts` | **新建** | P1 | T1 |
| 2 | `backend/lib/bff-stack.ts` | 改 | P1 | T2 |
| 3 | `frontend-v2/js/data-source.js` | 改 | P1 | T3 |
| 4 | `frontend-v2/js/mock-data.js` | 改 | P1 | T3 |
| 5 | `frontend-v2/js/p4-hems.js` | **重寫** | P1-P3 | T4, T5, T6, T7, T8 |
| 6 | `frontend-v2/css/style.css` | 改 | P1-P3 | T4, T8 |
| 7 | `backend/test/bff/hems-targeting.test.ts` | **新建** | P4 | T9 |
| 8 | `frontend-v2/test/e2e/hems-workbench.test.js` | **新建** | P4 | T10 |

**新建文件：3 個** | **重寫文件：1 個** | **修改文件：4 個**

---

## 8. 上線檢查清單

### Pre-Deploy

- [ ] T1: targeting API 通過所有 unit test (T9)
- [ ] T4: Phase 1 frontend 通過 D1-D7 驗收
- [ ] T5: Phase 2 dispatch flow 通過 E1-E5, F1-F4 驗收
- [ ] T10: E2E tests 全部通過
- [ ] Anti-regression: G1-G5 確認
- [ ] v6.0 batch-dispatch API 不受影響

### Deploy

- [ ] 部署 BFF (T1 + T2)
- [ ] 部署 Frontend (T4-T8)

### Post-Deploy

- [ ] 確認 targeting API 回傳正確 gateway 數據
- [ ] 確認 dispatch 流程端到端正常
- [ ] 確認 batch history 正確更新
- [ ] 確認 modal 確認流程不可繞過
- [ ] 確認 non-admin org 過濾正確
- [ ] **(REQ R4)** Admin-role live validation: validated against at least one real online gateway under admin-role session — dispatchability, consistency-state, and selection flow observed

### Rollback

1. Frontend: revert to v6.0 p4-hems.js (git revert)
2. BFF: remove targeting route (不影響其他功能)
3. Existing v6.0 APIs (batch-dispatch, batch-history): 不受影響，無需回滾
