# DESIGN-v6.0-P4-batch-dispatch

**Version:** 6.0
**Date:** 2026-03-14
**REQ:** REQ-v6.0-P4-batch-dispatch.md
**Status:** Draft

---

## 1. 模塊影響矩陣

| 模塊 | 文件路徑 | 動作 | 風險 | 依賴 | 說明 |
|------|----------|------|------|------|------|
| **DB — device_command_logs** | `db-init/02_schema.sql` | **改** | 低 | 無 | 加 `batch_id`、`source` 欄位 + 索引 |
| **DB — assets** | `db-init/02_schema.sql` | **改** | 低 | Phase 2 | 加 `rated_*` 四欄位 |
| **BFF — post-hems-batch-dispatch** | `backend/src/bff/handlers/post-hems-batch-dispatch.ts` | **新增** | 高 | F4 DDL 先行 | 取代舊 post-hems-dispatch.ts；寫 device_command_logs |
| **BFF — get-hems-batch-history** | `backend/src/bff/handlers/get-hems-batch-history.ts` | **新增** | 中 | F4 DDL 先行 | 按 batch_id 聚合查詢 |
| **BFF — bff-stack.ts** | `backend/lib/bff-stack.ts` | **改** | 低 | 新 handler 就緒 | 註冊兩條新路由 |
| **BFF — put-gateway-schedule.ts** | `backend/src/bff/handlers/put-gateway-schedule.ts` | **改** | 中 | Phase 2 (F5, F6) | Phase 2 加硬體功率校驗 |
| **BFF — post-hems-batch-dispatch** | （同上 Phase 2 增強） | **改** | 中 | Phase 2 (F5, F6) | Phase 2 加硬體功率校驗（與 P2 一致） |
| **M1 — device-list-handler.ts** | `backend/src/iot-hub/handlers/device-list-handler.ts` | **改** | 中 | Phase 2 (F5) | UPSERT 補 rated_* 欄位 |
| **M1 — command-publisher.ts** | `backend/src/iot-hub/services/command-publisher.ts` | **不動** | — | — | dispatched→MQTT 邏輯不變 |
| **M3 — command-dispatcher.ts** | `backend/src/dr-dispatcher/services/command-dispatcher.ts` | **不動** | — | — | pending→dispatched 邏輯不變（runPendingCommandDispatcher 自動撈新筆）|
| **M1 — command-tracker.ts** | `backend/src/iot-hub/handlers/command-tracker.ts` | **不動** | — | — | ACK 處理不變 |
| **M1 — schedule-translator.ts** | `backend/src/iot-hub/handlers/schedule-translator.ts` | **不動** | — | — | validateSchedule / buildConfigSetPayload 不變 |
| **Frontend — p4-hems.js** | `frontend-v2/js/p4-hems.js` | **改（重寫）** | 高 | F2, F3 API 就緒 | 三步流程取代 DemoStore mock |
| **Frontend — data-source.js** | `frontend-v2/js/data-source.js` | **改** | 低 | F2, F3 API 就緒 | 新增 hems.batchDispatch / hems.batchHistory 方法 |
| **Frontend — mock-data.js** | `frontend-v2/js/mock-data.js` | **改** | 低 | 無 | 新增 batch-history mock 數據 |
| **Frontend — p2-devices.js** | `frontend-v2/js/p2-devices.js` | **改** | 低 | Phase 2 (F5) | Phase 2 加 `_ratedMaxPowerKw` 校驗 |

### 風險等級定義

| 等級 | 定義 |
|------|------|
| 高 | 涉及核心數據管線或大範圍重寫，錯誤會導致指令無法下發 |
| 中 | 局部改動，影響可控但需仔細測試邊界情況 |
| 低 | 增量式加法，不影響現有行為 |

---

## 2. 數據流矩陣

### Phase 1：P4 批量調度完整數據流

```
┌─────────┐    POST /api/hems/batch-dispatch     ┌──────────────────────────┐
│ P4 前端  │ ──────────────────────────────────▶  │ post-hems-batch-dispatch │
│ Step 3   │    {mode, soc*, arbSlots, gwIds[]}   │         (BFF)            │
└─────────┘                                       └──────────┬───────────────┘
                                                             │
                              ┌───────────────────────────────┤
                              │ 批量查詢（非 per-gateway loop）│
                              ▼                               │
                   ┌──────────────────────────┐               │
                   │ 1. 批量 RLS 校驗          │               │
                   │    SELECT gateways        │               │
                   │    WHERE gateway_id =      │               │
                   │    ANY($1)                │               │
                   └────────┬─────────────────┘               │
                            ▼                                 │
                   ┌──────────────────────────┐               │
                   │ 2. 批量讀最新成功排程     │               │
                   │    DISTINCT ON(gateway_id)│               │
                   │    WHERE gateway_id =      │               │
                   │    ANY($1) AND result      │               │
                   │    IN ('success',          │               │
                   │    'accepted')             │               │
                   └────────┬─────────────────┘               │
                            ▼                                 │
                   ┌──────────────────────────┐               │
                   │ 3. 批量檢查 active cmd    │               │
                   │    WHERE gateway_id =      │               │
                   │    ANY($1) AND result      │               │
                   │    IN ('pending',          │               │
                   │    'dispatched','accepted')│               │
                   └────────┬─────────────────┘               │
                            ▼                                 │
                   ┌──────────────────────────┐               │
                   │ 4. for each gateway:      │               │
                   │    合併 DomainSchedule    │               │
                   │    → validateSchedule()   │               │
                   │    → INSERT (pending)     │               │
                   │    batch_id, source='p4'  │               │
                   └──────────────────────────┘               │
                                                              │
                   回傳 {batchId, results[]}  ◀───────────────┘
                              │
                              ▼  (10 秒後)
                   ┌──────────────────────────┐
                   │ M3: runPendingCommand     │
                   │ Dispatcher (10s poll)     │
                   │ pending → dispatched      │
                   └────────┬─────────────────┘
                            ▼  (10 秒後)
                   ┌──────────────────────────┐
                   │ M1: CommandPublisher      │
                   │ (10s poll)                │
                   │ dispatched → validate →   │
                   │ buildConfigSetPayload →   │
                   │ MQTT publish              │
                   └────────┬─────────────────┘
                            ▼
                   ┌──────────────────────────┐
                   │ MQTT topic:              │
                   │ platform/ems/{gwId}/     │
                   │ config/set               │
                   └────────┬─────────────────┘
                            ▼  (Gateway ACK)
                   ┌──────────────────────────┐
                   │ M1: CommandTracker        │
                   │ Phase 1: accepted         │
                   │ Phase 2: success/fail     │
                   └──────────────────────────┘
```

### 每步輸入/輸出/格式

| 步驟 | 來源 → 目標 | 輸入 | 輸出 | 格式 |
|------|-------------|------|------|------|
| 1 | P4 前端 → BFF | 用戶選擇的 mode, soc, arbSlots, gatewayIds | HTTP POST body | JSON (BatchDispatchRequest) |
| 2 | BFF → DB (read) | gatewayId | 最新成功排程的 payload_json | DomainSchedule (JSONB) |
| 3 | BFF (merge) | P4 新值 + 歷史功率 | 完整 DomainSchedule | TypeScript object |
| 4 | BFF → DB (read) | gatewayId | active command 存在與否 | boolean |
| 5 | BFF → DB (write) | DomainSchedule + batch_id + source | device_command_logs row (pending) | INSERT |
| 6 | M3 → DB (update) | pending rows | result='dispatched' | UPDATE |
| 7 | M1 → DB (read) | dispatched rows | command + payload_json | SELECT |
| 8 | M1 → MQTT | DomainSchedule → ProtocolSchedule | config/set message | Solfacil Protocol JSON |
| 9 | Gateway → M1 | set_reply topic | ACK (accepted/rejected) | Solfacil Protocol JSON |
| 10 | M1 → DB (update) | ACK result | result='accepted'/'fail' | UPDATE |

### 批量查詢策略（W4 修正）

**設計原則：** 預設使用批量查詢，避免 per-gateway loop 造成 N×4 次 DB 往返。100 台 Gateway 只需 3 次批量查詢 + N 次 INSERT。

**Step 1 — 批量 RLS 校驗：**
```sql
SELECT gateway_id FROM gateways WHERE gateway_id = ANY($1)
-- rlsOrgId != null 時自動走 RLS policy
```

**Step 2 — 批量讀最新成功排程：**
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
→ 結果放入 `Map<gatewayId, payloadJson>`

**Step 3 — 批量檢查 active command：**
```sql
SELECT DISTINCT gateway_id
FROM device_command_logs
WHERE gateway_id = ANY($1)
  AND command_type = 'set'
  AND config_name = 'battery_schedule'
  AND result IN ('pending', 'dispatched', 'accepted')
```
→ 結果放入 `Set<gatewayId>`（有 active command 的）

**Step 4 — 逐台合併 + 寫入（純計算 + INSERT，無額外 SELECT）：**
```
for each gatewayId:
  if not in validGateways → skip (not_found)
  if in activeSet → skip (active_command)
  historical = historyMap.get(gatewayId) ?? SAFE_DEFAULTS
  schedule = merge(P4 params, historical)
  validateSchedule(schedule)
  INSERT device_command_logs
```

**效能：** 3 次 SELECT + N 次 INSERT ≈ 100 台 ~500ms，遠低於 Lambda 10s timeout。

---

## 3. DomainSchedule 生成矩陣

### 三種模式的 slots 生成規則

| 模式 | slots 數量 | 生成規則 | 前端編輯器 |
|------|-----------|---------|-----------|
| **自發自用** (self_consumption) | 1 | `[{mode:'self_consumption', startMinute:0, endMinute:1440}]` | 無（自動） |
| **削峰填谷** (peak_shaving) | 1 | `[{mode:'peak_shaving', startMinute:0, endMinute:1440}]` | 無（自動） |
| **峰谷套利** (peak_valley_arbitrage) | N (用戶定義) | arbSlots → merge consecutive same-action → DomainSlot[] | 24h 塗色時間軸 |

### 套利 arbSlots → DomainSlot 轉換規則

```
輸入: arbSlots = [{startHour:0, endHour:6, action:'charge'}, {startHour:6, endHour:24, action:'discharge'}]

轉換:
1. 每段 startMinute = startHour × 60, endMinute = endHour × 60
2. mode = 'peak_valley_arbitrage' (固定)
3. action = arbSlot.action ('charge' | 'discharge')
4. 合併相鄰同 action 段（optional optimization）

輸出: [{mode:'peak_valley_arbitrage', action:'charge', startMinute:0, endMinute:360},
        {mode:'peak_valley_arbitrage', action:'discharge', startMinute:360, endMinute:1440}]
```

### 每欄位參數來源矩陣

| DomainSchedule 欄位 | 自發自用 | 削峰填谷 | 峰谷套利 | 來源說明 |
|---------------------|---------|---------|---------|---------|
| `socMinLimit` | P4 新值 | P4 新值 | P4 新值 | 用戶在 Step 1 設定 (range 5-50%) |
| `socMaxLimit` | P4 新值 | P4 新值 | P4 新值 | 用戶在 Step 1 設定 (range 70-100%) |
| `maxChargeCurrent` | **歷史值** | **歷史值** | **歷史值** | 從 device_command_logs 最新成功排程讀取 |
| `maxDischargeCurrent` | **歷史值** | **歷史值** | **歷史值** | 從 device_command_logs 最新成功排程讀取 |
| `gridImportLimitKw` | **歷史值** | **P4 新值** | **歷史值** | 僅削峰模式使用 P4 的 gridImportLimitKw |
| `slots` | 自動生成 | 自動生成 | arbSlots 轉換 | 見上方 slots 生成規則 |

### 歷史值回退邏輯

```sql
-- 讀取最新成功排程
SELECT payload_json
FROM device_command_logs
WHERE gateway_id = $1
  AND command_type = 'set'
  AND config_name = 'battery_schedule'
  AND result IN ('success', 'accepted')
ORDER BY created_at DESC
LIMIT 1
```

| 場景 | maxChargeCurrent | maxDischargeCurrent | gridImportLimitKw |
|------|-----------------|--------------------|--------------------|
| 有歷史排程 | `payload_json.maxChargeCurrent` | `payload_json.maxDischargeCurrent` | `payload_json.gridImportLimitKw` |
| **無歷史排程** | **100**（安全預設） | **100**（安全預設） | **3000**（安全預設） |

---

## 4. 衝突處理矩陣

| 邊界情況 | 偵測條件 | 處理策略 | 回傳 | 說明 |
|----------|---------|---------|------|------|
| **Active command 衝突** | `SELECT ... WHERE result IN ('pending','dispatched','accepted') LIMIT 1` 有結果 | **跳過該 gateway** | `{status:'skipped', reason:'active_command'}` | 不阻塞其他 gateway，不 rollback 已成功的 |
| **無歷史排程** | SELECT 最新成功排程回 0 rows | **用安全預設值** | 正常 pending | maxChargeCurrent=100, maxDischargeCurrent=100, gridImportLimitKw=3000 |
| **rated_max_power_kw 為 NULL** | Phase 2：`inv.rated_max_power_kw IS NULL` | **跳過校驗** | 正常通過 | 向後兼容，不阻塞未回報額定值的設備 |
| **Gateway 不存在 / RLS 失敗** | `SELECT gateway_id FROM gateways WHERE gateway_id=$1` 回 0 rows | **跳過** | `{status:'skipped', reason:'gateway_not_found'}` | RLS 確保只能操作自己 org 的 gateway |
| **Gateway 離線** | BFF 不檢查（M1 負責） | **正常寫入 pending** | 正常 pending | M1 CommandPublisher 發現離線時設 result='failed', error='gateway_offline' |
| **validateSchedule 失敗** | `validateSchedule()` throws ScheduleValidationError | **跳過** | `{status:'skipped', reason:'validation_failed'}` | 理論上不應發生（BFF 自己組的 schedule），但防禦性處理 |
| **套利 arbSlots 未覆蓋 0-24h** | 前端驗證 + BFF 驗證 | **400 拒絕整個請求** | HTTP 400 | 輸入驗證錯誤，非 per-gateway 錯誤 |
| **socMinLimit >= socMaxLimit** | BFF 參數驗證 | **400 拒絕整個請求** | HTTP 400 | 同上 |
| **mode 不合法** | BFF 參數驗證 | **400 拒絕整個請求** | HTTP 400 | 同上 |
| **gatewayIds 為空** | BFF 參數驗證 | **400 拒絕整個請求** | HTTP 400 | 至少選一台 |
| **batch 部分成功** | 部分 gateway skipped | **回傳混合結果** | 200 + results[] | 前端根據 results 顯示成功/跳過數量 |
| **歷史排程 payload_json 格式異常** | payload_json 缺少必要欄位 | **用安全預設值回退** | 正常 pending | 防禦性：try-catch 解析，失敗則用預設 |

### 錯誤優先級

```
1. 請求層級驗證 (mode, soc, arbSlots) → 400 拒絕整個請求
2. Per-gateway 處理 → 各自獨立，skipped 不影響其他
3. M3/M1 管線層級 → 非同步，BFF 不等待
```

---

## 5. DDL 變更清單

### Phase 1：device_command_logs 加欄位

```sql
-- Migration: 006_batch_dispatch_columns.sql

ALTER TABLE device_command_logs
  ADD COLUMN IF NOT EXISTS batch_id VARCHAR(50),
  ADD COLUMN IF NOT EXISTS source  VARCHAR(10) DEFAULT 'p2';

CREATE INDEX IF NOT EXISTS idx_dcl_batch
  ON device_command_logs (batch_id)
  WHERE batch_id IS NOT NULL;

COMMENT ON COLUMN device_command_logs.batch_id
  IS 'P4 批量操作 ID，null = 單筆操作（P2/自動）';
COMMENT ON COLUMN device_command_logs.source
  IS '指令來源：p2=手動單台, p4=批量, auto=M2自動排程';
```

**影響分析：**
- `batch_id` 預設 NULL → 現有 P2 寫入不受影響
- `source` 預設 `'p2'` → 現有 P2 寫入自動標記為 p2
- 部分索引只對 batch_id IS NOT NULL 建索引 → 不影響現有查詢性能
- M3 `runPendingCommandDispatcher` 撈 `result='pending'` → 不受新欄位影響
- M1 `CommandPublisher` 撈 `result='dispatched'` → 不受新欄位影響

### Phase 2：assets 加額定參數欄位

```sql
-- Migration: 007_rated_capacity_columns.sql

ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS rated_max_power_kw   REAL,
  ADD COLUMN IF NOT EXISTS rated_max_current_a   REAL,
  ADD COLUMN IF NOT EXISTS rated_min_power_kw   REAL,
  ADD COLUMN IF NOT EXISTS rated_min_current_a   REAL;

COMMENT ON COLUMN assets.rated_max_power_kw
  IS 'Gateway MQTT deviceList 回報的額定最大功率 (kW)，硬體銘牌值';
COMMENT ON COLUMN assets.rated_max_current_a
  IS 'Gateway MQTT deviceList 回報的額定最大電流 (A)，硬體銘牌值';
COMMENT ON COLUMN assets.rated_min_power_kw
  IS 'Gateway MQTT deviceList 回報的額定最小功率 (kW)';
COMMENT ON COLUMN assets.rated_min_current_a
  IS 'Gateway MQTT deviceList 回報的額定最小電流 (A)';
```

**語義區分：**
- `max_charge_rate_kw` / `max_discharge_rate_kw` = 用戶/管理員設定的操作上限
- `rated_max_power_kw` = 硬體銘牌天花板（不可超越）
- 兩者獨立，rated_* 為 NULL 時跳過校驗

---

## 6. API 契約

### 6.1 POST /api/hems/batch-dispatch

**權限：** SOLFACIL_ADMIN, ORG_MANAGER, ORG_OPERATOR

**Request:**
```typescript
interface BatchDispatchRequest {
  mode: 'self_consumption' | 'peak_shaving' | 'peak_valley_arbitrage';
  socMinLimit: number;        // 5-50, integer
  socMaxLimit: number;        // 70-100, integer, > socMinLimit
  gridImportLimitKw?: number; // >= 0, 僅削峰模式必填
  arbSlots?: Array<{          // 僅套利模式必填
    startHour: number;        // 0-23, integer
    endHour: number;          // 1-24, integer, > startHour
    action: 'charge' | 'discharge';
  }>;
  gatewayIds: string[];       // 至少 1 個，最多 100 個
}
```

**Response 200:**
```typescript
interface BatchDispatchResponse {
  success: true;
  data: {
    batchId: string;          // "batch-1710400000000-a1b2"
    results: Array<{
      gatewayId: string;
      status: 'pending' | 'skipped';
      commandId?: number;     // device_command_logs.id (status=pending 時)
      reason?: string;        // status=skipped 時的原因
    }>;
    summary: {
      total: number;
      pending: number;
      skipped: number;
    };
  };
}
```

**Response 400 (驗證失敗):**
```json
{
  "success": false,
  "error": "socMinLimit must be less than socMaxLimit"
}
```

**Response 403 (權限不足):**
```json
{
  "success": false,
  "error": "Forbidden: insufficient role"
}
```

### 6.2 GET /api/hems/batch-history

**權限：** 所有已登入角色（ORG_VIEWER+）

**Request:** `GET /api/hems/batch-history?limit=20`

| 參數 | 類型 | 預設 | 說明 |
|------|------|------|------|
| limit | number | 20 | 最多回傳筆數，上限 100 |

**Response 200:**
```typescript
interface BatchHistoryResponse {
  success: true;
  data: {
    batches: Array<{
      batchId: string;
      source: string;           // 'p4'
      dispatchedAt: string;     // ISO 8601
      total: number;
      successCount: number;
      failedCount: number;
      gateways: Array<{
        gatewayId: string;
        result: string;         // 'pending'|'dispatched'|'accepted'|'success'|'failed'|'timeout'
      }>;
      samplePayload: {         // 第一筆的 payload，用於顯示模式/參數摘要
        socMinLimit: number;
        socMaxLimit: number;
        gridImportLimitKw: number;
        slots: DomainSlot[];
      };
    }>;
  };
}
```

**SQL (帶 org 過濾)：**
```sql
SELECT
  dcl.batch_id,
  dcl.source,
  MIN(dcl.created_at)                                          AS dispatched_at,
  COUNT(*)                                                     AS total,
  COUNT(*) FILTER (WHERE dcl.result IN ('success','accepted')) AS success_count,
  COUNT(*) FILTER (WHERE dcl.result = 'failed')                AS failed_count,
  jsonb_agg(jsonb_build_object(
    'gatewayId', dcl.gateway_id,
    'result',    dcl.result
  ))                                                           AS gateways,
  (array_agg(dcl.payload_json ORDER BY dcl.id)
    FILTER (WHERE dcl.payload_json IS NOT NULL))[1]            AS sample_payload
FROM device_command_logs dcl
JOIN gateways g ON g.gateway_id = dcl.gateway_id
WHERE dcl.batch_id IS NOT NULL
  AND dcl.command_type = 'set'
  AND ($2::VARCHAR IS NULL OR g.org_id = $2)
GROUP BY dcl.batch_id, dcl.source
ORDER BY MIN(dcl.created_at) DESC
LIMIT $1;
```

> **設計決策：** device_command_logs 無 org_id 欄位且無 RLS policy。
> 透過 JOIN gateways 表做 org 過濾（gateways 有 RLS），而非加 org_id 到 device_command_logs。
> SOLFACIL_ADMIN 傳 orgId=NULL 跳過 org 過濾。

---

## 7. Phase 1 vs Phase 2 依賴圖

```
Phase 1                                          Phase 2
--------                                         --------

F4: DDL (batch_id, source)                       F5: DDL (rated_* columns)
  |                                                |
  |--- 必須先完成 --> F2: POST batch-dispatch       |--- 必須先完成 --> F6: device-list-handler
  |                    |                           |                    UPSERT rated_*
  |                    |                           |
  |--- 必須先完成 --> F3: GET batch-history          |--- 必須先完成 --> F7: put-gateway-schedule
  |                    |                           |                    硬體校驗 (P2)
  |                    |                           |
  |                    |                           |--- 必須先完成 --> F7b: batch-dispatch
  |                    |                           |                    硬體校驗 (P4)
  |                    |                           |
  |                    v                           '--- 必須先完成 --> F8: P2 前端校驗增強
  |              Route Registration
  |              (bff-stack.ts)
  |                    |
  |                    v
  '---------------> F1: P4 前端重寫
                  (依賴 F2, F3 API)
```

### 並行 vs 串行分析

| 任務組合 | 關係 | 原因 |
|----------|------|------|
| F4 (DDL) | **最先** | F2、F3 都依賴 batch_id、source 欄位存在 |
| F2 + F3 | **可並行** | 兩個獨立 handler，無互相依賴 |
| F2 → bff-stack.ts | **串行** | 路由註冊需 handler 檔案存在 |
| F1 → F2, F3 | **串行** | 前端依賴 API 就緒（但可用 mock 開發） |
| F5 (DDL Phase 2) | **獨立** | Phase 2 DDL，可在 Phase 1 完成後執行 |
| F6 → F5 | **串行** | UPSERT 需欄位存在 |
| F7 → F5 + F6 | **串行** | 校驗需 rated_* 有數據 |
| F8 → F7 | **可並行** | 前端/後端校驗獨立，但邏輯對齊 |
| **Phase 1 vs Phase 2** | **串行** | Phase 2 建立在 Phase 1 基礎上 |

### 建議執行順序

```
Week 1:
  Day 1-2:  F4 (DDL) ---- Gate
            F2 (batch-dispatch handler)  --+-- 可並行
            F3 (batch-history handler)   --+
  Day 3:    Route registration + 整合測試
  Day 4-5:  F1 (P4 前端重寫)

Week 2:
  Day 1:    F5 (DDL Phase 2)
  Day 2:    F6 (device-list-handler) + F7 (put-gateway-schedule)  可並行
  Day 3:    F8 (P2 前端校驗)
  Day 4-5:  E2E 測試 + 驗收
```

---

## 8. 安全性考量

| 項目 | 設計決策 | 說明 |
|------|---------|------|
| RLS | batch-dispatch 透過 `queryWithOrg` 確保 org 隔離 | Admin 用 service pool 跳過 RLS |
| RBAC | POST batch-dispatch: SOLFACIL_ADMIN + ORG_MANAGER + ORG_OPERATOR | 與現有 post-hems-dispatch 一致 |
| RBAC | GET batch-history: 所有角色 (ORG_VIEWER+) | 只讀，低風險 |
| 輸入驗證 | mode enum 白名單、soc 範圍檢查、arbSlots 覆蓋度驗證 | BFF 入口處驗證 |
| SQL 注入 | 全部使用參數化查詢 ($1, $2...) | 現有 queryWithOrg 已強制 |
| 批量限制 | gatewayIds 最大 100 | 防止單次請求過載 |
| batch_id 生成 | `batch-${Date.now()}-${randomHex(4)}` | 伺服器端生成，不接受客戶端輸入 |

---

## 9. 現有 P2 行為不變性保證

| P2 操作 | 改動前 | 改動後 | 影響 |
|---------|--------|--------|------|
| PUT /gateways/:id/schedule | 寫 device_command_logs，無 batch_id、無 source | batch_id=NULL, source='p2' (DEFAULT) | **零影響** |
| P2 讀排程 | SELECT 最新 device_command_logs | 不變 | 零影響 |
| P2 進入 P4 推過的 gateway | 讀 device_command_logs 最新成功排程 | 讀到 P4 寫的排程（同一張表） | **正確行為** |
| M3 runPendingCommandDispatcher | WHERE result='pending' | 不變（新欄位不在 WHERE 條件） | 零影響 |
| M1 CommandPublisher | WHERE result='dispatched' | 不變 | 零影響 |
| M1 CommandTracker | UPDATE result= | 不變 | 零影響 |
