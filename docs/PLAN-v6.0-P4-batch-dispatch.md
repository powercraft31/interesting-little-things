# PLAN-v6.0-P4-batch-dispatch

**Version:** 6.0
**Date:** 2026-03-14
**REQ:** REQ-v6.0-P4-batch-dispatch.md
**DESIGN:** DESIGN-v6.0-P4-batch-dispatch.md
**Status:** Draft

---

## 1. 任務拆解

### Phase 1：P4 核心（批量調度）

#### T1: DDL — device_command_logs 加欄位 [F4]

| 項目 | 內容 |
|------|------|
| **文件** | `db-init/02_schema.sql` (末尾追加) |
| **改動** | 在 device_command_logs 表定義中加 `batch_id VARCHAR(50)`, `source VARCHAR(10) DEFAULT 'p2'`；加部分索引 `idx_dcl_batch`；加 COMMENT |
| **預計行數** | +12 行 |
| **前置** | 無 |
| **可並行** | 是（DDL 獨立） |

**詳細步驟：**
1. 在 `02_schema.sql` 的 `device_command_logs` CREATE TABLE 中加入兩個欄位
2. 在索引區加 `CREATE INDEX idx_dcl_batch`
3. 在 COMMENT 區加欄位註釋
4. 如果有獨立 migration 目錄，另建 `006_batch_dispatch_columns.sql`

---

#### T2: BFF — POST /api/hems/batch-dispatch 新 handler [F2]

| 項目 | 內容 |
|------|------|
| **文件** | `backend/src/bff/handlers/post-hems-batch-dispatch.ts`（新建） |
| **改動** | 全新 handler：輸入驗證 → 生成 batch_id → 生成 slots → 批量查詢歷史+衝突 → 逐台合併寫入 device_command_logs |
| **預計行數** | ~200 行 |
| **前置** | T1 (DDL) |
| **可並行** | 與 T3 並行 |

**詳細步驟：**
1. 導入 `extractTenantContext`, `requireRole`, `apiError` from auth middleware
2. 導入 `validateSchedule` from schedule-translator
3. 導入 `queryWithOrg` from shared/db
4. 實現 `handler(event)`:
   - 解析 body: `{mode, socMinLimit, socMaxLimit, gridImportLimitKw, arbSlots, gatewayIds}`
   - 請求層級驗證：mode 白名單、soc 範圍、arbSlots 覆蓋度（套利模式）、gatewayIds 非空且 <= 100
   - 生成 batch_id: `batch-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
   - 生成 slots: 根據 mode 生成 DomainSlot[]（見 DESIGN §3）
   - **批量查詢（3 次 SELECT 取代 N×4 per-gateway loop）：**
     - a. 批量 RLS 校驗：`SELECT gateway_id FROM gateways WHERE gateway_id = ANY($1)` → validSet
     - b. 批量讀歷史排程：`SELECT DISTINCT ON (gateway_id) ... WHERE gateway_id = ANY($1) AND result IN ('success','accepted')` → historyMap
     - c. 批量查 active command：`SELECT DISTINCT gateway_id ... WHERE gateway_id = ANY($1) AND result IN ('pending','dispatched','accepted')` → activeSet
   - for each gatewayId（純計算 + INSERT，無額外 SELECT）：
     - if not in validSet → skip (not_found)
     - if in activeSet → skip (active_command)
     - historical = historyMap.get(gatewayId) ?? SAFE_DEFAULTS
     - 合併 DomainSchedule（P4 新值 + 歷史功率）
     - validateSchedule()
     - INSERT device_command_logs (batch_id, source='p4')
   - 回傳 `{batchId, results[], summary}`

**關鍵函數拆解：**
- `generateSlots(mode, arbSlots)` → DomainSlot[] (~30 行)
- `batchReadHistoricalSchedules(gatewayIds, rlsOrgId)` → Map<gwId, payload> (~25 行)
- `batchCheckActiveCommands(gatewayIds, rlsOrgId)` → Set<gwId> (~15 行)
- `buildDomainSchedule(mode, request, historical)` → DomainSchedule (~25 行)

---

#### T3: BFF — GET /api/hems/batch-history 新 handler [F3]

| 項目 | 內容 |
|------|------|
| **文件** | `backend/src/bff/handlers/get-hems-batch-history.ts`（新建） |
| **改動** | 全新 handler：按 batch_id 分組聚合查詢 device_command_logs |
| **預計行數** | ~80 行 |
| **前置** | T1 (DDL) |
| **可並行** | 與 T2 並行 |

**詳細步驟：**
1. 導入 auth middleware + queryWithOrg
2. 解析 query param `limit`（預設 20，上限 100）
3. 執行聚合 SQL（JOIN gateways 做 org 過濾，見 DESIGN §6.2）
4. 格式化回傳 `{batches: [...]}`

---

#### T4: BFF — 路由註冊 [bff-stack.ts]

| 項目 | 內容 |
|------|------|
| **文件** | `backend/lib/bff-stack.ts` |
| **改動** | 加 2 個 handler 定義 + 2 條 route |
| **預計行數** | +20 行 |
| **前置** | T2, T3 handler 就緒 |
| **可並行** | 否（依賴 T2, T3） |

**詳細步驟：**
1. 在 handler 定義區加：
   ```typescript
   const postHemsBatchDispatch = this.createHandler(
     "PostHemsBatchDispatch", handlersDir,
     "post-hems-batch-dispatch.handler", stage,
   );
   const getHemsBatchHistory = this.createHandler(
     "GetHemsBatchHistory", handlersDir,
     "get-hems-batch-history.handler", stage,
   );
   ```
2. 在 route 區加：
   ```typescript
   this.addRoute(httpApi, "POST", "/api/hems/batch-dispatch", postHemsBatchDispatch);
   this.addRoute(httpApi, "GET",  "/api/hems/batch-history",  getHemsBatchHistory);
   ```

---

#### T5: Frontend — data-source.js 加 API 方法

| 項目 | 內容 |
|------|------|
| **文件** | `frontend-v2/js/data-source.js` |
| **改動** | 在 `hems` 模塊加 `batchDispatch(params)` 和 `batchHistory(limit)` |
| **預計行數** | +25 行 |
| **前置** | 無（可用 mock 先行） |
| **可並行** | 與 T2, T3 並行 |

**詳細步驟：**
1. 在 `hems` 對象中加：
   ```javascript
   batchDispatch: function(params) {
     return withFallback(
       function() { return apiPost('/api/hems/batch-dispatch', params); },
       { success: true, data: { batchId: 'mock-batch-1', results: [], summary: {total:0,pending:0,skipped:0} } }
     );
   },
   batchHistory: function(limit) {
     return withFallback(
       function() { return apiGet('/api/hems/batch-history?limit=' + (limit || 20)); },
       MOCK_DATA.BATCH_HISTORY || { success: true, data: { batches: [] } }
     );
   },
   ```

---

#### T6: Frontend — mock-data.js 加 batch mock

| 項目 | 內容 |
|------|------|
| **文件** | `frontend-v2/js/mock-data.js` |
| **改動** | 加 BATCH_HISTORY mock 數據 |
| **預計行數** | +30 行 |
| **前置** | 無 |
| **可並行** | 與所有任務並行 |

---

#### T7: Frontend — p4-hems.js 重寫 [F1]

| 項目 | 內容 |
|------|------|
| **文件** | `frontend-v2/js/p4-hems.js` (現有 931 行，重寫核心區) |
| **改動** | 三步流程 UI：Step 1 模式選擇+參數、Step 2 Gateway 選擇、Step 3 預覽+推送+歷史 |
| **預計行數** | ~800 行（重寫大部分，總行數相近） |
| **前置** | T5 (data-source API 方法) |
| **可並行** | 否（需 API 方法就緒） |

**詳細步驟：**

**Step 1 UI — 模式選擇 + 參數**
1. `_buildStep1()` — 三張模式卡片（自耗/削峰/套利）
2. `_buildSocParams()` — socMinLimit / socMaxLimit 滑桿
3. `_buildPeakShavingParams()` — gridImportLimitKw 輸入（削峰模式顯示）
4. `_buildArbEditor()` — 24h 塗色時間軸（套利模式顯示）
5. `_buildArbTemplates()` — 快速模板按鈕（Enel SP / 夜間充電 / 雙充雙放 / 清空）
6. `_validateStep1()` — 驗證套利是否塗滿 24h

**Step 2 UI — Gateway 選擇**
7. `_buildStep2()` — Gateway 多選表格
8. `_buildGatewayRow(gw)` — 單行：checkbox + ID + 家庭 + 狀態 + 設備數 + 當前模式 + mini bar + 最後同步
9. `_buildFilterBar()` — 篩選器（家庭、狀態）
10. `_loadGateways()` — 從 DataSource 載入 gateway 列表 + 當前排程

**Step 3 UI — 預覽 + 推送**
11. `_buildStep3()` — 預覽面板：新舊排程並排、配置摘要
12. `_buildComparisonBar(oldSchedule, newSchedule)` — 新舊 mini bar 對比
13. `_buildBatchHistory()` — 操作歷史列表（調用 batchHistory API）
14. `_handleDispatch()` — 確認 modal → 調用 batchDispatch API → 進度 → toast

**導航與狀態**
15. `_currentStep` 狀態管理（1/2/3）
16. `_nextStep()` / `_prevStep()` — 步驟切換 + 驗證
17. `_setupStepListeners()` — 各步驟事件綁定

---

#### T8: 整合測試 — Phase 1

| 項目 | 內容 |
|------|------|
| **文件** | `backend/test/bff/post-hems-batch-dispatch.test.ts`（新建） |
| **改動** | 完整測試套件：輸入驗證、三種模式、active command 衝突、無歷史回退、batch_id 聚合 |
| **預計行數** | ~350 行 |
| **前置** | T2 handler 完成 |
| **可並行** | 與 T7 前端並行 |

**測試用例清單（見下方 §3）**

---

### Phase 2：設備額定參數增強

#### T9: DDL — assets 加額定參數欄位 [F5]

| 項目 | 內容 |
|------|------|
| **文件** | `db-init/02_schema.sql` |
| **改動** | assets 表加 `rated_max_power_kw`, `rated_max_current_a`, `rated_min_power_kw`, `rated_min_current_a` |
| **預計行數** | +10 行 |
| **前置** | Phase 1 完成 |
| **可並行** | 是 |

---

#### T10: M1 — device-list-handler.ts 補 MQTT 欄位 [F6]

| 項目 | 內容 |
|------|------|
| **文件** | `backend/src/iot-hub/handlers/device-list-handler.ts` |
| **改動** | UPSERT 語句加 rated_* 四欄位，從 MQTT payload 的 device.maxPower/maxCurrent/minPower/minCurrent 映射 |
| **預計行數** | +15 行（修改現有 SQL） |
| **前置** | T9 (DDL) |
| **可並行** | 與 T11 並行 |

**詳細步驟：**
1. 在 UPSERT INSERT 的 columns 加四欄位
2. 在 VALUES 中用 `NULLIF($x, '')::REAL` 轉換
3. 在 ON CONFLICT DO UPDATE SET 中加對應更新
4. 從 `device` 對象提取 `.maxPower`, `.maxCurrent`, `.minPower`, `.minCurrent`

---

#### T11: BFF — put-gateway-schedule.ts 加硬體校驗 [F7]

| 項目 | 內容 |
|------|------|
| **文件** | `backend/src/bff/handlers/put-gateway-schedule.ts` |
| **改動** | 在 validateSchedule() 之後、INSERT 之前，加 rated_max_power_kw 校驗 |
| **預計行數** | +25 行 |
| **前置** | T9 (DDL), T10 (有數據) |
| **可並行** | 與 T12 並行 |

**詳細步驟：**
1. 在 validateSchedule() 調用後加查詢：
   ```sql
   SELECT rated_max_power_kw, rated_max_current_a
   FROM assets
   WHERE gateway_id = $1 AND asset_type = 'INVERTER_BATTERY' AND is_active = true
   LIMIT 1
   ```
2. 如果 rated_max_power_kw != null：
   - 校驗 maxChargeCurrent <= rated_max_power_kw
   - 校驗 maxDischargeCurrent <= rated_max_power_kw
   - 違反 → apiError(400, ...)
3. 如果 rated_max_power_kw == null → 跳過（向後兼容）

---

#### T11b: BFF — post-hems-batch-dispatch.ts 加硬體校驗 [F7b]

| 項目 | 內容 |
|------|------|
| **文件** | `backend/src/bff/handlers/post-hems-batch-dispatch.ts` |
| **改動** | 批量查詢 rated_max_power_kw，在合併 DomainSchedule 時校驗歷史功率不超過硬體額定值 |
| **預計行數** | +20 行 |
| **前置** | T9 (DDL), T10 (有數據), T2 (handler 已存在) |
| **可並行** | 與 T11, T12 並行 |

**詳細步驟：**
1. 在批量查詢階段增加一次查詢：
   ```sql
   SELECT gateway_id, rated_max_power_kw
   FROM assets
   WHERE gateway_id = ANY($1) AND asset_type = 'INVERTER_BATTERY' AND is_active = true
   ```
   → ratedMap: `Map<gatewayId, number | null>`
2. 在 for-each 合併階段，取出 historical maxChargeCurrent/maxDischargeCurrent 後：
   - 如果 ratedMap.get(gwId) != null：
     - 校驗 maxChargeCurrent <= rated_max_power_kw
     - 校驗 maxDischargeCurrent <= rated_max_power_kw
     - 違反 → 自動 clamp 到 rated 值（不 skip，因為功率是歷史值非用戶輸入）
   - 如果 rated 為 NULL → 跳過（向後兼容）

> **設計決策：** P4 的功率來自歷史排程（P2 設定的），不是用戶在 P4 輸入的。如果歷史功率超過硬體額定（可能是 Phase 2 之前設的），P4 不應拒絕整個 gateway，而是自動 clamp 到額定值。這跟 P2 的「400 拒絕」行為不同，因為 P2 是用戶正在輸入可以修改，P4 無法讓用戶逐台修改功率。

---

#### T12: Frontend — P2 前端校驗增強 [F8]

| 項目 | 內容 |
|------|------|
| **文件** | `frontend-v2/js/p2-devices.js` |
| **改動** | `_validateSchedule` 加 rated 功率上限校驗；gateway detail 載入時 fetch rated_max_power_kw |
| **預計行數** | +20 行 |
| **前置** | T9 (DDL), T10 (有數據) |
| **可並行** | 與 T11 並行 |

**詳細步驟：**
1. 在 `_openLayer3GW(gatewayId)` 中，載入 gateway detail 後額外查詢 asset rated_max_power_kw
2. 存入 `this._ratedMaxPowerKw`
3. 在 `_validateSchedule(cfg)` 中加判斷：
   ```javascript
   if (self._ratedMaxPowerKw != null) {
     if (cfg.maxChargeCurrent > self._ratedMaxPowerKw)
       return "Corrente de carga excede capacidade do equipamento (" + self._ratedMaxPowerKw + " kW)";
     if (cfg.maxDischargeCurrent > self._ratedMaxPowerKw)
       return "Corrente de descarga excede capacidade do equipamento (" + self._ratedMaxPowerKw + " kW)";
   }
   ```

---

#### T13: 整合測試 — Phase 2

| 項目 | 內容 |
|------|------|
| **文件** | `backend/test/iot-hub/device-list-handler.test.ts`（新建或追加）, `backend/test/bff/put-gateway-schedule-rated.test.ts`（新建） |
| **改動** | rated_* UPSERT 測試 + 硬體校驗測試 |
| **預計行數** | ~150 行 |
| **前置** | T10, T11 |
| **可並行** | 部分 |

---

## 2. 執行順序圖

```
                    Phase 1
                    -------

Timeline:   Day 1        Day 2        Day 3        Day 4        Day 5
            |            |            |            |            |
    T1 DDL  [====]
    T6 Mock [====]
    T5 DS   [====]
    T2 BFF  [============]
    T3 BFF  [============]
    T4 Route              [====]
    T8 Test               [============]
    T7 FE                              [========================]

                    Phase 2
                    -------

Timeline:   Day 6        Day 7        Day 8        Day 9        Day 10
            |            |            |            |            |
    T9 DDL  [====]
    T10 M1  [============]
    T11 BFF [============]
    T12 FE               [============]
    T13 Test             [============]
    E2E                               [========================]
```

### 並行分組

| 分組 | 任務 | 並行策略 |
|------|------|---------|
| **Batch A（Day 1）** | T1 + T5 + T6 | 三者完全獨立，可並行 |
| **Batch B（Day 1-2）** | T2 + T3 | 兩個 BFF handler 獨立，可並行；但都依賴 T1 DDL |
| **Batch C（Day 2）** | T4 | 串行：依賴 T2 + T3 完成 |
| **Batch D（Day 2-3）** | T8 | 可與 T7 並行：後端測試不依賴前端 |
| **Batch E（Day 3-5）** | T7 | 串行：依賴 T5 (API 方法)，但可用 mock 提前啟動 |
| **Batch F（Day 6）** | T9 + T10 + T11 | T10, T11 依賴 T9；T10 與 T11 可並行 |
| **Batch G（Day 7-8）** | T12 + T13 | 可並行 |

---

## 3. 測試計畫

### Phase 1 測試用例

#### T8: `post-hems-batch-dispatch.test.ts`

| # | 測試用例 | 對應任務 | 測試類型 |
|---|---------|---------|---------|
| 1 | 自耗模式批量下發 2 台 → device_command_logs 2 筆 pending, batch_id 一致 | T2 | Unit |
| 2 | 削峰模式 + gridImportLimitKw → payload_json.gridImportLimitKw = P4 新值 | T2 | Unit |
| 3 | 套利模式 arbSlots 覆蓋 0-24h → DomainSlot[] 正確轉換，每段 mode='peak_valley_arbitrage' | T2 | Unit |
| 4 | 套利模式 arbSlots 未滿 24h → 400 拒絕 | T2 | Unit |
| 5 | socMinLimit >= socMaxLimit → 400 拒絕 | T2 | Unit |
| 6 | mode 不合法 → 400 拒絕 | T2 | Unit |
| 7 | gatewayIds 為空 → 400 拒絕 | T2 | Unit |
| 8 | gatewayIds > 100 → 400 拒絕 | T2 | Unit |
| 9 | gateway 不存在 / RLS 失敗 → skipped (gateway_not_found) | T2 | Unit |
| 10 | 有 active command 的 gateway → skipped (active_command) | T2 | Unit |
| 11 | 無歷史排程 → 安全預設值填入 (maxChargeCurrent=100) | T2 | Unit |
| 12 | 有歷史排程 → 正確讀取歷史功率值 | T2 | Unit |
| 13 | 混合結果：2 台 pending + 1 台 skipped → summary 正確 | T2 | Unit |
| 14 | 權限不足 (ORG_VIEWER) → 403 | T2 | Unit |
| 15 | 各角色成功 (ADMIN, MANAGER, OPERATOR) → 200 | T2 | Unit |

#### `get-hems-batch-history.test.ts`

| # | 測試用例 | 對應任務 | 測試類型 |
|---|---------|---------|---------|
| 16 | batch_id 分組查詢 → 正確聚合 total, successCount, failedCount | T3 | Unit |
| 17 | limit 參數生效 | T3 | Unit |
| 18 | limit > 100 → 截斷為 100 | T3 | Unit |
| 19 | 無 batch 記錄 → 空陣列 | T3 | Unit |
| 20 | org 過濾：非 admin 只看到自己 org 的 batch | T3 | Unit |

#### 跨模塊整合驗證

| # | 測試用例 | 涉及模塊 | 測試類型 |
|---|---------|---------|---------|
| 21 | P4 下發後 P2 讀同一 gateway → 看到 P4 排程 | T2 + put-gateway-schedule | Integration |
| 22 | batch_id + source='p4' 正確寫入 | T2 + T1 DDL | Integration |
| 23 | 現有 P2 寫入 → source='p2', batch_id=NULL (DEFAULT) | put-gateway-schedule | Regression |

### Phase 2 測試用例

#### T13: rated capacity 測試

| # | 測試用例 | 對應任務 | 測試類型 |
|---|---------|---------|---------|
| 24 | MQTT deviceList 帶 maxPower → assets.rated_max_power_kw 正確 UPSERT | T10 | Unit |
| 25 | MQTT deviceList maxPower 為空字串 → rated_max_power_kw = NULL | T10 | Unit |
| 26 | P2 提交 maxChargeCurrent > rated_max_power_kw → 400 拒絕 | T11 | Unit |
| 27 | P2 提交 maxChargeCurrent <= rated_max_power_kw → 通過 | T11 | Unit |
| 28 | rated_max_power_kw 為 NULL → 跳過校驗，正常通過 | T11 | Unit |
| 29 | maxDischargeCurrent > rated_max_power_kw → 400 拒絕 | T11 | Unit |

---

## 4. 風險清單

| # | 風險 | 嚴重度 | 概率 | 降級方案 |
|---|------|--------|------|---------|
| R1 | **batch-dispatch 寫入失敗但部分已成功** | 高 | 低 | per-gateway 獨立 try-catch；回傳已成功的 results + 失敗原因；不做跨 gateway 事務 |
| R2 | **大批量（100台）導致 BFF timeout** | 高 | 中 | Lambda 10s timeout；每台 gateway 3 次 DB 查詢 = 300 次 query。對策：(1) 複用 DB connection (2) 批量查詢替代逐台查詢 (3) 必要時拆分為子批次 |
| R3 | **歷史排程 payload_json 格式不一致** | 中 | 低 | try-catch 解析，失敗回退安全預設值；記 warn log |
| R4 | **DDL 遷移破壞現有數據** | 高 | 極低 | ADD COLUMN IF NOT EXISTS + DEFAULT 值確保無破壞性；先在 staging 執行 |
| R5 | **P4 前端重寫範圍大，回歸風險** | 中 | 中 | 保留 DemoStore fallback（USE_MOCK=true 可切回）；分步交付 Step 1→2→3 |
| R6 | **套利 arbSlots 轉換邊界錯誤** | 中 | 中 | 重用 validateSchedule() 做最終校驗；加完整的套利轉換 unit test |
| R7 | **device_command_logs 無 RLS 導致跨 org 數據洩漏** | 高 | 中 | batch-history 查詢 JOIN gateways（有 RLS）做 org 過濾；batch-dispatch 透過 queryWithOrg 查 gateways 確保 org 隔離 |
| R8 | **M3/M1 因 payload 新欄位（batch_id, source）而異常** | 中 | 極低 | M3 只讀 result 欄位；M1 只讀 id, gateway_id, command_type, config_name, payload_json → 新欄位不在其 SELECT 中 |

### R2 性能優化策略

如果 100 台批量出現 timeout：

**方案 A（優先）：批量查詢**
```sql
-- 一次查所有 gateway 的最新成功排程
SELECT DISTINCT ON (gateway_id) gateway_id, payload_json
FROM device_command_logs
WHERE gateway_id = ANY($1)
  AND command_type = 'set' AND config_name = 'battery_schedule'
  AND result IN ('success', 'accepted')
ORDER BY gateway_id, created_at DESC;

-- 一次查所有 gateway 的 active command
SELECT gateway_id
FROM device_command_logs
WHERE gateway_id = ANY($1)
  AND command_type = 'set' AND config_name = 'battery_schedule'
  AND result IN ('pending', 'dispatched', 'accepted');
```

**方案 B（必要時）：** 拆分為 25 台一批，前端輪詢進度

---

## 5. 驗收標準

### Phase 1 驗收

| # | 標準 | 驗證方法 |
|---|------|---------|
| A1 | P4 自耗模式選擇 2 台 gateway → 2 筆 pending 寫入 device_command_logs，batch_id 一致 | API 測試 + DB 查詢 |
| A2 | P4 削峰模式 gridImportLimitKw=50 → payload_json.gridImportLimitKw=50 | API 測試 |
| A3 | P4 套利模式 arbSlots 覆蓋 0-24h → DomainSlot[] 生成正確，validateSchedule 通過 | Unit 測試 |
| A4 | 有 active command 的 gateway → status='skipped', reason='active_command' | API 測試 |
| A5 | 無歷史排程 → maxChargeCurrent=100, maxDischargeCurrent=100, gridImportLimitKw=3000 | Unit 測試 |
| A6 | M3 每 10s 撈到新 pending → 更新為 dispatched | 手動驗證 / E2E |
| A7 | M1 發 MQTT → Gateway 收到 config/set | 手動驗證 / E2E |
| A8 | P2 進入剛推過的 gateway → 讀到 P4 的排程（source='p4'） | 手動驗證 |
| A9 | GET /api/hems/batch-history → 正確按 batch_id 聚合，顯示成功/失敗數 | API 測試 |
| A10 | 現有 P2 PUT /gateways/:id/schedule → 不受影響，source='p2', batch_id=NULL | 回歸測試 |
| A11 | 測試覆蓋率 >= 80% | Jest --coverage |
| A12 | P4 前端三步流程可走通（Step 1 選模式 → Step 2 選 gateway → Step 3 預覽推送） | 手動 E2E |

### Phase 2 驗收

| # | 標準 | 驗證方法 |
|---|------|---------|
| B1 | MQTT deviceList 帶 maxPower=5.0 → assets.rated_max_power_kw=5.0 | Unit 測試 |
| B2 | P2 提交 maxChargeCurrent=200, rated_max_power_kw=100 → 400 拒絕 | API 測試 |
| B3 | rated_max_power_kw=NULL → 跳過校驗，正常通過 | API 測試 |
| B4 | P2 前端輸入超過額定功率 → 顯示葡語錯誤提示 | 手動驗證 |
| B5 | 現有無 rated_* 的設備 → 所有現有操作不受影響 | 回歸測試 |

---

## 6. 文件清單總覽

| # | 文件 | 動作 | Phase | Task |
|---|------|------|-------|------|
| 1 | `db-init/02_schema.sql` | 改 | P1 + P2 | T1, T9 |
| 2 | `backend/src/bff/handlers/post-hems-batch-dispatch.ts` | **新建** | P1 | T2 |
| 3 | `backend/src/bff/handlers/get-hems-batch-history.ts` | **新建** | P1 | T3 |
| 4 | `backend/lib/bff-stack.ts` | 改 | P1 | T4 |
| 5 | `frontend-v2/js/data-source.js` | 改 | P1 | T5 |
| 6 | `frontend-v2/js/mock-data.js` | 改 | P1 | T6 |
| 7 | `frontend-v2/js/p4-hems.js` | 改（重寫） | P1 | T7 |
| 8 | `backend/test/bff/post-hems-batch-dispatch.test.ts` | **新建** | P1 | T8 |
| 9 | `backend/test/bff/get-hems-batch-history.test.ts` | **新建** | P1 | T8 |
| 10 | `backend/src/iot-hub/handlers/device-list-handler.ts` | 改 | P2 | T10 |
| 11 | `backend/src/bff/handlers/put-gateway-schedule.ts` | 改 | P2 | T11 |
| 12 | `frontend-v2/js/p2-devices.js` | 改 | P2 | T12 |
| 13 | `backend/test/bff/put-gateway-schedule-rated.test.ts` | **新建** | P2 | T13 |
| 14 | `backend/test/iot-hub/device-list-handler-rated.test.ts` | **新建** | P2 | T13 |

**新建文件：6 個** | **修改文件：8 個** | **不動文件：4 個** (command-publisher, command-dispatcher, command-tracker, schedule-translator)
