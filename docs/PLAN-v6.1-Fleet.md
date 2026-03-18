# PLAN-v6.1-Fleet

**Version:** 6.1
**Date:** 2026-03-17
**REQ:** REQ-v6.1-Fleet.md
**DESIGN:** DESIGN-v6.1-Fleet.md
**Status:** Draft

---

## 1. 任務拆解

### Phase 1：基礎設施 + IoT Pipeline 調整

#### T1: DDL — 新建 gateway_outage_events 表

| 項目 | 內容 |
|------|------|
| **文件** | `db-init/02_schema.sql`（末尾追加） |
| **改動** | CREATE TABLE gateway_outage_events + 3 索引 + COMMENT |
| **預計行數** | +20 行 |
| **前置** | 無 |
| **可並行** | 是（DDL 獨立） |

**詳細步驟：**
1. 在 `02_schema.sql` 末尾加 `gateway_outage_events` 表定義（見 DESIGN §5.1）
2. 加 3 個索引：`idx_goe_gateway_started`、`idx_goe_org_started`、`idx_goe_open`
3. 加表註釋

---

#### T2: IoT — gateway-connection-manager.ts 調整 heartbeat threshold + outage 寫入

| 項目 | 內容 |
|------|------|
| **文件** | `backend/src/iot-hub/services/gateway-connection-manager.ts` |
| **改動** | (1) HEARTBEAT_TIMEOUT_MS 600000 → 900000；(2) watchdog offline 時寫入 gateway_outage_events（含 5min flap consolidation） |
| **預計行數** | ~+30 行 |
| **前置** | T1 (DDL) |
| **可並行** | 與 T3 並行 |

**詳細步驟：**
1. 修改 `HEARTBEAT_TIMEOUT_MS` 為 `900_000`
2. 在 watchdog UPDATE `status = 'offline'` 後，增加 outage event 邏輯：
   ```
   a. SELECT 最近一筆 ended_at IS NOT NULL 且 ended_at > NOW() - INTERVAL '5 min' 的 outage
   b. 找到 → UPDATE ended_at = NULL（重新打開，flap consolidation）
   c. 未找到 → INSERT 新 gateway_outage_events (gateway_id, org_id, started_at = NOW())
   ```
3. 取 org_id 可從同次 UPDATE 的 RETURNING 子句獲取

---

#### T3: IoT — heartbeat-handler.ts outage 關閉

| 項目 | 內容 |
|------|------|
| **文件** | `backend/src/iot-hub/handlers/heartbeat-handler.ts` |
| **改動** | reconnect 時關閉 open outage event |
| **預計行數** | ~+10 行 |
| **前置** | T1 (DDL) |
| **可並行** | 與 T2、T3.5 並行 |

**詳細步驟：**
1. 在 heartbeat handler 的 reconnect 路徑（prev_status != 'online' → status = 'online'）中增加：
   ```sql
   UPDATE gateway_outage_events SET ended_at = NOW()
   WHERE gateway_id = $1 AND ended_at IS NULL
   ```
2. 保持 heartbeat-handler 僅負責 connectivity recovery，不承擔 backfill trigger 語義

#### T3.5: IoT — telemetry-handler.ts primary telemetry gap backfill trigger

| 項目 | 內容 |
|------|------|
| **文件** | `backend/src/iot-hub/handlers/telemetry-handler.ts` |
| **改動** | 以 Gateway primary telemetry stream 實作 backfill trigger：gap > 5 min → INSERT backfill_requests |
| **預計行數** | ~+20 行 |
| **前置** | T1 (DDL) |
| **可並行** | 與 T2、T3 並行 |

**詳細步驟：**
1. 在 telemetry-handler 中取得同一 Gateway 上一筆 primary telemetry timestamp
2. 比較 `current_ts - previous_ts`
3. 若 gap > `300_000 ms`，INSERT `backfill_requests`：
   - `gateway_id`
   - `gap_start = previous_ts`
   - `gap_end = current_ts`
   - `status = 'not_started'`
4. 更新該 Gateway 的 recent primary telemetry timestamp
5. 如現有 runtime 仍有 heartbeat-based backfill trigger，於本 task 內移除或停用，避免重複建立 backfill_requests

---

### Phase 2：BFF Handler 重寫

#### T4: BFF — get-fleet-overview.ts 重寫（gateway-first KPI）

| 項目 | 內容 |
|------|------|
| **文件** | `backend/src/bff/handlers/get-fleet-overview.ts` |
| **改動** | 完全重寫：device-first → gateway-first KPI，加 backfill pressure |
| **預計行數** | ~80 行（取代現有 ~60 行） |
| **前置** | T1 (DDL) |
| **可並行** | 與 T5, T6, T7 並行 |

**詳細步驟：**
1. 移除現有 device-count 和 device-online-rate 查詢
2. 改用 DESIGN §3.1 的 SQL：gateways LEFT JOIN backfill_requests，單次查詢取得全部 6 個 KPI
3. 回傳 `FleetOverviewResponse` 格式
4. 保持現有 auth middleware（SOLFACIL_ADMIN, ORG_MANAGER, ORG_OPERATOR, ORG_VIEWER）
5. 非 admin 角色透過 `queryWithOrg` 做 org 過濾

---

#### T5: BFF — get-fleet-integradores.ts 重寫（gateway-first org table）

| 項目 | 內容 |
|------|------|
| **文件** | `backend/src/bff/handlers/get-fleet-integradores.ts` |
| **改動** | 完全重寫：device count → gateway count + GW online rate + backfill + last commissioning |
| **預計行數** | ~100 行（取代現有 ~50 行） |
| **前置** | T1 (DDL) |
| **可並行** | 與 T4, T6, T7 並行 |

**詳細步驟：**
1. 移除現有 device count + device online rate 邏輯
2. 改用 DESIGN §3.2 的 SQL：organizations INNER JOIN gateways，含 backfill JOIN 和 LATERAL first telemetry
3. 確保 `HAVING COUNT > 0`（不顯示 0-gateway 組織）
4. 排序：gateway_online_rate ASC, gateway_count DESC
5. 回傳 `FleetIntegradoresResponse` 格式

---

#### T6: BFF — get-fleet-offline-events.ts 重寫（gateway outage events）

| 項目 | 內容 |
|------|------|
| **文件** | `backend/src/bff/handlers/get-fleet-offline-events.ts` |
| **改動** | 完全重寫：device offline_events → gateway_outage_events + backfill status JOIN |
| **預計行數** | ~90 行（取代現有 ~50 行） |
| **前置** | T1 (DDL), T2/T3（有 outage 數據） |
| **可並行** | 與 T4, T5, T7 並行 |

**詳細步驟：**
1. 查詢 `gateway_outage_events`（最近 7 天）
2. JOIN `gateways` 取 gateway name
3. JOIN `organizations` 取 org name
4. LEFT JOIN `backfill_requests` 取 backfill status（匹配條件：同 gateway_id 且 gap_start/gap_end 與 outage 時間窗重疊）
5. 計算 durationMinutes：`EXTRACT(EPOCH FROM COALESCE(ended_at, NOW()) - started_at) / 60`
6. 排序：started_at DESC
7. 回傳 `FleetOfflineEventsResponse` 格式

---

#### T7: BFF — get-fleet-charts.ts 新增（圖表數據）

| 項目 | 內容 |
|------|------|
| **文件** | `backend/src/bff/handlers/get-fleet-charts.ts`（新建） |
| **改動** | 新 handler：gateway status distribution + inverter brand distribution |
| **預計行數** | ~70 行 |
| **前置** | 無（查詢現有表） |
| **可並行** | 與 T4, T5, T6 並行 |

**詳細步驟：**
1. Gateway status 查詢：gateways 表 COUNT + FILTER（見 DESIGN §3.4）
2. Inverter brand 查詢：assets JOIN gateways WHERE asset_type='INVERTER_BATTERY'，GROUP BY brand
3. 兩次查詢可並行（Promise.all）
4. 回傳 `FleetChartsResponse` 格式

---

#### T8: BFF — bff-stack.ts 註冊 Fleet 路由

| 項目 | 內容 |
|------|------|
| **文件** | `backend/lib/bff-stack.ts` |
| **改動** | 註冊 4 條 Fleet routes + 4 個 handler 定義 |
| **預計行數** | +20 行 |
| **前置** | T4, T5, T6, T7 handler 就緒 |
| **可並行** | 否（依賴全部 handler） |

**詳細步驟：**
1. 在 handler 定義區加 4 個 createHandler
2. 在 route 區加 4 條 `this.addRoute(httpApi, "GET", "/api/fleet/...", handler)`

---

### Phase 3：前端 Fleet Dashboard

#### T9: Frontend — data-source.js 加 Fleet API 方法

| 項目 | 內容 |
|------|------|
| **文件** | `frontend-v2/js/data-source.js` |
| **改動** | 新增 `fleet.overview()`, `fleet.charts()`, `fleet.integradores()`, `fleet.offlineEvents(limit)` |
| **預計行數** | +30 行 |
| **前置** | 無（可用 mock 先行） |
| **可並行** | 與 Phase 2 並行 |

---

#### T10: Frontend — p5-fleet.js Fleet Dashboard 頁面

| 項目 | 內容 |
|------|------|
| **文件** | `frontend-v2/js/p5-fleet.js`（新建或重寫現有） |
| **改動** | 完整 Fleet dashboard：KPI strip + 雙圖表 + org table + outage table |
| **預計行數** | ~500 行 |
| **前置** | T9 (data-source API)；T8 (routes 就緒) 用於真實測試 |
| **可並行** | 否（需 API 方法就緒） |

**詳細步驟：**

**KPI Strip**
1. `_buildKpiStrip(data)` — 6 張 KPI 卡片，按 REQ 順序排列
2. 顏色邏輯：offline → risk, online → healthy, backfill → warning/risk（依 hasFailure）
3. Online rate 顯示整數百分比（無小數、無趨勢）

**圖表區**
4. `_buildCharts(data)` — 左右並排佈局
5. 左圖：Gateway status donut（online/offline，2 segments）
6. 右圖：Inverter brand donut/bar（N segments）
7. 空狀態佔位：0 gateways 或 0 inverters 時顯示 placeholder

**Organization Table**
8. `_buildOrgTable(data)` — 5 列：Org / GW Count / GW Online Rate / Backfill P/F / Last Commissioning
9. 排序由後端處理，前端直接渲染
10. Last Commissioning 格式化為瀏覽器本地時區

**Outage Table**
11. `_buildOutageTable(data)` — 5 列：GW Name / Org / Offline Start / Duration / Backfill Status
12. Duration 格式化：`< 1h` 顯示分鐘，`>= 1h` 顯示 `Xh Ym`，ongoing 顯示 "Ongoing"
13. Backfill status 文字 + 顏色標籤
14. 空狀態訊息

**頁面載入**
15. `init()` — Promise.all 並行呼叫 4 個 API
16. 錯誤處理：單個 API 失敗不阻塞其他區塊

---

### Phase 4：測試

#### T11: 後端測試 — IoT Pipeline

| 項目 | 內容 |
|------|------|
| **文件** | `backend/test/iot-hub/gateway-outage-events.test.ts`（新建） |
| **改動** | 測試 heartbeat threshold、telemetry-gap backfill trigger、outage event 寫入/關閉/flap consolidation |
| **預計行數** | ~200 行 |
| **前置** | T2, T3, T3.5 |
| **可並行** | 與 T12 並行 |

**測試用例：**

| # | 測試用例 | 類型 |
|---|---------|------|
| 1 | Gateway heartbeat > 15 min → status = offline | Unit |
| 2 | Gateway heartbeat < 15 min → status stays online | Unit |
| 3 | Gateway offline → gateway_outage_events INSERT | Integration |
| 4 | Gateway reconnect → outage ended_at set | Integration |
| 5 | Flap < 5 min → same outage reopened (ended_at = NULL) | Integration |
| 6 | Flap > 5 min → new outage created | Integration |
| 7 | Backfill trigger: telemetry gap > 5 min on Gateway primary stream → backfill_requests INSERT | Unit |
| 8 | Backfill trigger: telemetry gap < 5 min → no backfill request | Unit |

---

#### T12: 後端測試 — BFF Handlers

| 項目 | 內容 |
|------|------|
| **文件** | `backend/test/bff/fleet-v6.1-handlers.test.ts`（新建） |
| **改動** | 測試 4 個 Fleet BFF handlers |
| **預計行數** | ~300 行 |
| **前置** | T4, T5, T6, T7 |
| **可並行** | 與 T11 並行 |

**測試用例：**

| # | 測試用例 | Handler | 類型 |
|---|---------|---------|------|
| 9 | KPI 全部為 gateway 計數（非 device） | overview | Unit |
| 10 | Online rate 為整數百分比 | overview | Unit |
| 11 | Backfill pressure 去重計算（同 GW 多筆 backfill） | overview | Unit |
| 12 | Backfill hasFailure 正確反映 failed 狀態 | overview | Unit |
| 13 | 0 gateways → 全部 KPI 為 0 | overview | Unit |
| 14 | DB 中存在的全部 gateway 都計入 KPI 分母 | overview | Unit |
| 15 | Org table 不顯示 0-gateway 組織 | integradores | Unit |
| 16 | Org table 排序：online rate ASC, gateway count DESC | integradores | Unit |
| 17 | Last commissioning fallback to first telemetry | integradores | Unit |
| 18 | Last commissioning 使用 commissioned_at（優先） | integradores | Unit |
| 19 | Outage events 限 7 天 | offline-events | Unit |
| 20 | Outage duration 計算正確（ongoing = null） | offline-events | Unit |
| 21 | Outage backfill status JOIN 正確 | offline-events | Integration |
| 22 | Gateway status chart 只有 2 categories | charts | Unit |
| 23 | Brand distribution 按 inverter device count 統計（以 DB 內現存 gateway 關聯資產為準） | charts | Unit |
| 24 | Brand = NULL → 'Unknown' | charts | Unit |
| 25 | 非 admin 角色 org 過濾正確 | all handlers | Unit |
| 26 | 未授權角色 → 403 | all handlers | Unit |

---

#### T13: 前端 E2E 測試

| 項目 | 內容 |
|------|------|
| **文件** | `frontend-v2/test/e2e/fleet-dashboard.test.js`（新建） |
| **預計行數** | ~150 行 |
| **前置** | T10 |

**測試用例：**

| # | 測試用例 | 類型 |
|---|---------|------|
| 27 | 頁面載入顯示 6 個 KPI 卡片 | E2E |
| 28 | 空狀態：0 gateways → 正確顯示空佔位 | E2E |
| 29 | Org table 不出現 0-gateway 組織 | E2E |
| 30 | Outage table 空狀態訊息正確 | E2E |
| 31 | 時間戳顯示為瀏覽器本地時區 | E2E |

---

## 2. 執行順序圖

```
                    Phase 1: 基礎設施
                    ------------------

Timeline:   Day 1        Day 2
            |            |
    T1 DDL  [====]
    T2 IoT  [============]       (依賴 T1)
    T3 IoT  [============]       (依賴 T1；與 T2 並行)

                    Phase 2: BFF Handlers
                    ---------------------

Timeline:   Day 2        Day 3        Day 4
            |            |            |
    T4 BFF  [============]                    (與 T5/T6/T7 並行)
    T5 BFF  [============]
    T6 BFF  [============]
    T7 BFF  [============]
    T8 Route              [====]              (依賴 T4-T7)

                    Phase 3: Frontend
                    -----------------

Timeline:   Day 3        Day 4        Day 5
            |            |            |
    T9 DS   [====]                            (可提前，用 mock)
    T10 FE  [============================]    (依賴 T9)

                    Phase 4: Testing
                    ----------------

Timeline:   Day 4        Day 5        Day 6
            |            |            |
    T11 IoT [============]                    (與 T12 並行)
    T12 BFF [============]
    T13 E2E              [============]       (依賴 T10)
```

### 並行分組

| 分組 | 任務 | 並行策略 |
|------|------|---------|
| **Batch A（Day 1）** | T1 | DDL 最先 |
| **Batch B（Day 1-2）** | T2 + T3 | 兩個 IoT 改動獨立，可並行；都依賴 T1 |
| **Batch C（Day 2-3）** | T4 + T5 + T6 + T7 | 4 個 BFF handler 完全獨立，可並行 |
| **Batch D（Day 3）** | T8 | 串行：依賴 Batch C 全部完成 |
| **Batch E（Day 3-5）** | T9 + T10 | T9 可提前（mock），T10 依賴 T9 |
| **Batch F（Day 4-6）** | T11 + T12 + T13 | T11/T12 並行；T13 依賴 T10 |

---

## 3. 驗證計畫

### 語義正確性驗證（最高優先級）

| # | 驗證項 | 方法 | 說明 |
|---|--------|------|------|
| V1 | KPI 全部為 gateway 計數，非 device 計數 | 比對 `SELECT COUNT(*) FROM gateways` vs KPI totalGateways | 核心語義轉換正確性 |
| V2 | Online rate = gateway online / total gateways | 手動計算對比 | 非 device online rate |
| V3 | Backfill pressure 按 gateway 去重 | 插入同一 GW 兩筆 backfill → 確認 count = 1 | 避免重複計算 |
| V4 | Org table 不含 0-gateway 組織 | 建立無 gateway 的 org → 確認不出現 | REQ 明確排除 |
| V5 | Gateway status chart 不含 backfill 狀態 | 確認 chart data 只有 online/offline 兩個 key | REQ 明確排除 |
| V6 | Outage table 為 gateway-level，非 device-level | 製造 device offline（gateway 仍 online）→ 確認不出現在 outage table | REQ 明確排除 |

### Threshold 驗證

| # | 驗證項 | 方法 |
|---|--------|------|
| V7 | Heartbeat timeout = 15 min | 停止 gateway heartbeat，等 14 min 確認仍 online，等 16 min 確認 offline |
| V8 | Backfill trigger = 5 min telemetry gap on Gateway primary stream | 製造 4 min telemetry gap → 無 backfill；製造 6 min telemetry gap → 有 backfill |
| V9 | Outage flap consolidation = 5 min | 製造快速斷線-重連-斷線（recovery < 5 min）→ 確認只有 1 筆 outage event |

### Timestamp 驗證

| # | 驗證項 | 方法 |
|---|--------|------|
| V10 | API 不回傳 naive datetime | 檢查所有 timestamp 欄位含 timezone offset 或為 epoch |
| V11 | 前端顯示為瀏覽器本地時區 | 在不同時區瀏覽器中驗證 |

### 回歸驗證

| # | 驗證項 | 方法 |
|---|--------|------|
| V12 | 現有 gateway detail API 不受影響 | 呼叫 GET /api/gateways/{id}/detail → 回傳格式不變 |
| V13 | 現有 schedule API 不受影響 | PUT + GET schedule → 功能正常 |
| V14 | Backfill requester 仍正常運行 | 製造 telemetry gap > 5 min → 確認 backfill_requests 仍被建立並處理 |
| V15 | 現有 device offline_events 表不受影響 | 確認 offline_events 仍由原有邏輯寫入（如有） |

---

## 4. 回歸風險

| # | 風險 | 嚴重度 | 概率 | 降級方案 |
|---|------|--------|------|---------|
| R1 | **Heartbeat threshold 從 10→15 min 導致 offline 延遲感知** | 中 | 中 | 可配置化 threshold，預留環境變數覆蓋 |
| R2 | **Backfill trigger 改為 telemetry gap > 5 min 導致短 gap 不回填** | 中 | 中 | 業務確認：< 5 min gap 不需回填是可接受的（REQ 明確定義） |
| R3 | **watchdog 寫 outage event 增加 DB 寫入量** | 低 | 低 | watchdog 每 60s 一次，只對新增 offline gateway 寫入；數量級低 |
| R4 | **BFF handler 重寫破壞現有前端** | 高 | 中 | 現有 Fleet 前端尚未上線（routes 未註冊），風險僅在內部測試用途 |
| R5 | **LATERAL subquery（last commissioning fallback）效能** | 中 | 低 | 查詢 telemetry_history MIN(recorded_at) 可能慢；加索引或改用 materialized 欄位 |
| R6 | **Outage flap consolidation 邏輯錯誤導致事件丟失** | 高 | 低 | flap consolidation 僅在 watchdog→offline 路徑觸發；加完整 integration test |
| R7 | **backfill_requests 大量 not_started 導致 overview KPI 查詢慢** | 低 | 低 | backfill_requests 表行數有限（按 gateway×gap 計）；必要時加索引 |

### R5 效能降級方案

如果 LATERAL first telemetry 查詢過慢（> 500ms for > 50 orgs）：

**方案 A（優先）：** 在 `gateways` 表加 `first_telemetry_at TIMESTAMPTZ` 快取欄位，由 telemetry handler 首次寫入時更新。

**方案 B：** 對 `telemetry_history` 加 `(asset_id, recorded_at ASC)` 索引（如不存在）。

---

## 5. 上線檢查清單

### Pre-Deploy

- [ ] T1: DDL migration 在 staging 執行成功，不影響現有表
- [ ] T2/T3/T3.5: IoT pipeline 修改後，staging 環境 heartbeat + telemetry-gap backfill 行為正確
- [ ] T4-T7: 4 個 BFF handler 通過所有 unit test（T12）
- [ ] T11: IoT pipeline outage event test 通過
- [ ] 測試覆蓋率 >= 80%

### Deploy

- [ ] DDL migration 先行（`gateway_outage_events` 表）
- [ ] 部署 IoT Hub（T2 + T3 改動）
- [ ] 部署 BFF（T4-T8 改動）
- [ ] 部署 Frontend（T10）

### Post-Deploy

- [ ] 確認 gateway heartbeat watchdog 使用 15 min threshold
- [ ] 確認 backfill trigger 使用 5 min telemetry gap threshold（由 telemetry-handler.ts 實作）
- [ ] 確認 Fleet overview API 回傳 gateway-first KPI
- [ ] 確認 Org table 不含 0-gateway 組織
- [ ] 確認 Outage table 顯示 gateway-level events（非 device-level）
- [ ] 確認 timestamp 格式為 ISO 8601 with timezone
- [ ] 確認前端顯示為瀏覽器本地時區
- [ ] 確認現有 gateway detail / schedule API 不受影響

### Rollback

回滾策略（如需）：
1. BFF handler 回滾：還原為 device-first 版本（git revert）
2. IoT threshold 回滾：還原 10 min / 2 min（git revert）
3. DDL：`gateway_outage_events` 為新增表，回滾 = DROP TABLE（無數據依賴）
4. Frontend：還原為 pre-v6.1 Fleet 頁面（git revert）

---

## 6. 文件清單總覽

| # | 文件 | 動作 | Phase | Task |
|---|------|------|-------|------|
| 1 | `db-init/02_schema.sql` | 改（追加） | P1 | T1 |
| 2 | `backend/src/iot-hub/services/gateway-connection-manager.ts` | 改 | P1 | T2 |
| 3 | `backend/src/iot-hub/handlers/heartbeat-handler.ts` | 改 | P1 | T3 |
| 3.5 | `backend/src/iot-hub/handlers/telemetry-handler.ts` | 改 | P1 | T3.5 |
| 4 | `backend/src/bff/handlers/get-fleet-overview.ts` | 重寫 | P2 | T4 |
| 5 | `backend/src/bff/handlers/get-fleet-integradores.ts` | 重寫 | P2 | T5 |
| 6 | `backend/src/bff/handlers/get-fleet-offline-events.ts` | 重寫 | P2 | T6 |
| 7 | `backend/src/bff/handlers/get-fleet-charts.ts` | **新建** | P2 | T7 |
| 8 | `backend/lib/bff-stack.ts` | 改 | P2 | T8 |
| 9 | `frontend-v2/js/data-source.js` | 改 | P3 | T9 |
| 10 | `frontend-v2/js/p5-fleet.js` | **新建/重寫** | P3 | T10 |
| 11 | `backend/test/iot-hub/gateway-outage-events.test.ts` | **新建** | P4 | T11 |
| 12 | `backend/test/bff/fleet-v6.1-handlers.test.ts` | **新建** | P4 | T12 |
| 13 | `frontend-v2/test/e2e/fleet-dashboard.test.js` | **新建** | P4 | T13 |

**新建文件：4 個** | **重寫文件：3 個** | **修改文件：4 個** | **不動文件：** get-fleet-uptime-trend.ts, get-gateways.ts, get-gateways-summary.ts, offline_events table
