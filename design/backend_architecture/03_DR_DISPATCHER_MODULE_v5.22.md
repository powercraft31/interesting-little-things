# M3: DR 調度器 — 指令派遣與逾時管理

> **模組版本**: v5.22
> **上層文件**: [00_MASTER_ARCHITECTURE_v5.15.md](./00_MASTER_ARCHITECTURE_v5.15.md)
> **前版**: [03_DR_DISPATCHER_v5.16.md](./03_DR_DISPATCHER_v5.16.md)
> **最後更新**: 2026-03-13
> **說明**: command-dispatcher.ts 新增 M3→M1 指令派遣管線（pending→dispatched）；timeout-checker 新增 accepted 逾時偵測
> **核心主題**: PS 指令派遣、device_command_logs 管線、雙層逾時偵測

---

## 與 v5.16 的差異

| 面向 | v5.16 | v5.20 | v5.21 | v5.22 |
|------|-------|-------|-------|-------|
| PS 指令處理 | 已實作 | 不變 | 不變 | 不變 |
| Schema 對齊 | homes JOIN | **M3 schema 更新**（e658e0d） | — | — |
| M3→M1 指令管線 | 不存在 | — | **新增**: `runPendingCommandDispatcher` 輪詢 device_command_logs pending→dispatched | — |
| 逾時偵測 | dispatched commands >15min | — | **新增**: dispatched >90s + accepted >20s（於 command-dispatcher.ts） | **新增**: accepted timeout（device_write_timeout） |
| 派遣守衛 | 不存在 | — | — | BFF 端實作（非 M3） |

---

## 1. command-dispatcher.ts 函式總覽

### 檔案：`dr-dispatcher/services/command-dispatcher.ts`

v5.22 中 command-dispatcher.ts 包含 **3 個主要函式** 及 **1 個啟動函式**：

| 函式 | 觸發方式 | 用途 |
|------|----------|------|
| `startCommandDispatcher(pool)` | 系統啟動時呼叫一次 | 註冊所有定時任務 |
| `runCommandDispatcher(pool)` | cron 每分鐘 | trade_schedules → dispatch_commands（既有，SC/TOU/PS） |
| `runPendingCommandDispatcher(pool)` | setInterval 每 10 秒 | device_command_logs pending → dispatched（v5.21 新增） |
| `runTimeoutCheck(pool)` | setInterval 每 30 秒 | 逾時偵測：dispatched >90s + accepted >20s（v5.21/v5.22） |

### 啟動函式

```typescript
export function startCommandDispatcher(pool: Pool): void {
  // 既有：trade_schedules → dispatch_commands（每分鐘）
  cron.schedule("* * * * *", () => runCommandDispatcher(pool));

  // v5.21 新增：device_command_logs pending → dispatched（每 10 秒）
  setInterval(() => runPendingCommandDispatcher(pool), 10_000);

  // v5.21/v5.22：逾時偵測（每 30 秒）
  setInterval(() => runTimeoutCheck(pool), 30_000);
}
```

---

## 2. runCommandDispatcher — trade_schedules 派遣（既有）

### 流程

```
trade_schedules WHERE status = 'scheduled' AND planned_time <= NOW()
  |
  +-- FOR UPDATE SKIP LOCKED（避免併發衝突）
  +-- UPDATE status = 'executing'
  +-- INSERT INTO dispatch_commands（到 M1 邊界停止）
  +-- 若 target_mode = 'peak_shaving'：
  |     +-- 查詢 gateways.contracted_demand_kw（v5.19 schema 變更）
  |     +-- 查詢 tariff_schedules.billing_power_factor
  |     +-- 計算 peak_limit_kva = contracted_demand_kw / billing_power_factor
  |     +-- INSERT INTO dispatch_records (target_mode = 'peak_shaving')
  +-- COMMIT
```

### PS dispatch_records 寫入

> **注意**：`peak_limit_kva` 寫入 `dispatch_records` 表，非直接作為 MQTT 酬載發佈。
> 實際 MQTT 酬載由 `dispatch-command.ts`（Lambda handler）發佈，格式為 `{ targetMode, dispatchId }`。

### PS 計算邏輯

```typescript
const demandResult = await client.query(`
  SELECT g.contracted_demand_kw,
         COALESCE(ts.billing_power_factor, 0.92) AS billing_power_factor
  FROM assets a
  JOIN gateways g ON g.gateway_id = a.gateway_id
  LEFT JOIN tariff_schedules ts ON ts.org_id = a.org_id
    AND ts.effective_from <= CURRENT_DATE
    AND (ts.effective_to IS NULL OR ts.effective_to >= CURRENT_DATE)
  WHERE a.asset_id = $1
  LIMIT 1
`);

const contractedKw = demandResult.rows[0]?.contracted_demand_kw ?? 0;
const pf = demandResult.rows[0]?.billing_power_factor ?? 0.92;
const peakLimitKva = pf > 0
  ? Math.round((contractedKw / pf) * 100) / 100
  : contractedKw;
```

### MQTT 酬載範例（dispatch-command.ts Lambda handler）

```json
{
  "targetMode": "peak_shaving",
  "dispatchId": "abc-123"
}
```

由 `dispatch-command.ts` 透過 IoT Data Plane 發佈至主題 `solfacil/{orgId}/{assetId}/command/mode`。

閘道器接收後確保站點瞬時需量不超過契約需量，透過電池放電及/或觸發 DO 繼電器。

---

## 3. runPendingCommandDispatcher — M3→M1 指令管線（v5.21 新增）

### 用途

輪詢 `device_command_logs` 表中 `result = 'pending'` 的記錄，將其狀態推進至 `'dispatched'`。

### 流程

```
device_command_logs WHERE result = 'pending'
  |
  +-- ORDER BY created_at ASC（先進先出）
  +-- LIMIT 50（批次大小上限）
  +-- FOR UPDATE SKIP LOCKED（避免併發衝突）
  +-- UPDATE result = 'dispatched'
  +-- COMMIT
```

### SQL

```sql
SELECT id
FROM device_command_logs
WHERE result = 'pending'
ORDER BY created_at ASC
LIMIT 50
FOR UPDATE SKIP LOCKED
```

```sql
UPDATE device_command_logs
SET result = 'dispatched'
WHERE id = ANY($1)
```

### 設計考量

- **輪詢間隔 10 秒**：平衡即時性與資料庫負載
- **批次大小 50**：避免單次交易鎖定過多行
- **FIFO 順序**：確保先到的指令優先派遣
- **SKIP LOCKED**：支援多實例併發無衝突

---

## 4. runTimeoutCheck — 雙層逾時偵測（v5.21/v5.22）

### 用途

偵測已派遣但未收到回應的指令，依據所處狀態套用不同逾時策略。

### 逾時規則

| 層級 | 狀態 | 逾時時間 | error_message | 說明 |
|------|------|----------|---------------|------|
| 第一層 | `dispatched`（command_type = 'set'） | >90 秒 | `gateway_no_response` | 閘道器未回應（未收到 ACK） |
| 第二層 | `accepted`（command_type = 'set'）（v5.22 新增） | >20 秒 | `device_write_timeout` | 閘道器已接受但設備寫入超時 |

### SQL

```sql
-- 第一層：dispatched 超過 90 秒
UPDATE device_command_logs
SET result = 'timeout', resolved_at = NOW(), error_message = 'gateway_no_response'
WHERE result = 'dispatched' AND command_type = 'set'
  AND created_at < NOW() - INTERVAL '90 seconds'
RETURNING id

-- 第二層：accepted 超過 20 秒（v5.22）
UPDATE device_command_logs
SET result = 'timeout', resolved_at = NOW(), error_message = 'device_write_timeout'
WHERE result = 'accepted' AND command_type = 'set'
  AND device_timestamp < NOW() - INTERVAL '20 seconds'
RETURNING id
```

### 狀態機

```
pending ──(runPendingCommandDispatcher)──→ dispatched
                                              │
                                    ┌─────────┼────────────┐
                                    │         │            │
                              (gateway ACK)  (>90s)       │
                                    │         │            │
                                    v         v            │
                               accepted    timeout         │
                                    │    (gateway_no_      │
                              ┌─────┤     response)        │
                              │     │                      │
                        (device  (>20s)                    │
                         write)    │                       │
                              │    v                       │
                              v  timeout                   │
                          completed (device_write_         │
                              │     timeout)               │
                              v                            │
                           (完成)                          │
```

---

## 5. MQTT 發佈主題

沿用既有的派遣主題模式：

```
solfacil/{orgId}/{assetId}/command/mode
```

由 `dispatch-command.ts`（Lambda handler）透過 IoT Data Plane 發佈。閘道器透過 JSON 酬載中的 `targetMode` 欄位區分指令。

---

## 6. dispatch_records.target_mode

PS 指令派遣時，dispatcher 寫入 `dispatch_records`：

```sql
INSERT INTO dispatch_records
  (asset_id, dispatched_at, dispatch_type, commanded_power_kw, target_mode)
VALUES ($1, NOW(), 'peak_shaving', $2, 'peak_shaving')
```

此記錄後續由 M4 讀取，用於識別 PS 活動窗口以進行節省歸因。

---

## 7. 錯誤處理

| 場景 | 行為 |
|------|------|
| `contracted_demand_kw IS NULL` | 實際行為：fallback 為 0（`?? 0`），`peak_limit_kva` 會為 0，仍寫入 dispatch_records（**未實作跳過/失敗邏輯**） |
| `billing_power_factor IS NULL` | 透過 SQL `COALESCE` 使用預設值 0.92 |
| `billing_power_factor = 0` | 實際行為：fallback 使用 `contractedKw`（三元運算 `pf > 0 ?`），不會除以零，但**未實作跳過/記錄錯誤邏輯** |
| MQTT 發佈失敗 | `dispatch-command.ts`（Lambda handler）：回滾 DynamoDB 記錄為 FAILED，拋出錯誤 |
| 閘道器離線 | 指令在 MQTT broker 中排隊（QoS 1），重連時送達 |
| pending 指令無回應 | 90 秒後自動 timeout（gateway_no_response） |
| accepted 指令設備寫入超時 | 20 秒後自動 timeout（device_write_timeout） |

---

## 8. 連線池分配

| 元件 | 連線池 | 變更 |
|------|--------|------|
| command-dispatcher（cron） | **Service Pool** | 不變（v5.11） |
| runPendingCommandDispatcher（setInterval） | **Service Pool** | v5.21 新增，同 cron 上下文 |
| runTimeoutCheck（setInterval） | **Service Pool** | v5.21 新增，同 cron 上下文 |
| timeout-checker（cron） | **Service Pool** | 不變 |
| collect-response（HTTP） | **App Pool** | 不變 |

---

## 9. 未變更項目

| 元件 | v5.16 狀態 | v5.22 狀態 |
|------|-----------|-----------|
| SC 指令派遣 | v5.9 | 不變 |
| TOU 指令派遣 | v5.9 | 不變 |
| timeout-checker.ts（dispatch_commands >15min） | v5.11 | 不變 |
| ACK 握手（collect-response） | v5.9 | 不變 |
| 重試邏輯 | v5.9 | 不變 |
| allow_export 強制執行 | v5.15 | 不變 |
| PS 指令派遣 | v5.16 | 不變 |

---

## 10. 指令流程（完整 v5.22）

```
M2 schedule-generator
  | 插入 trade_schedules 列：
  |   target_mode = 'peak_shaving'
  |   action = 'discharge'
  |   status = 'scheduled'
  |
  v
M3 runCommandDispatcher（cron，每分鐘）
  | 讀取：trade_schedules WHERE status = 'scheduled' AND planned_time <= NOW()
  | 偵測：target_mode = 'peak_shaving'
  |
  +-- 1. 讀取 gateways.contracted_demand_kw（透過 asset → gateway JOIN）
  +-- 2. 讀取 tariff_schedules.billing_power_factor（透過 asset → org JOIN）
  +-- 3. 計算：peak_limit_kva = contracted_demand_kw / billing_power_factor
  +-- 4. INSERT dispatch_commands（到 M1 邊界停止）
  +-- 5. INSERT dispatch_records（target_mode = 'peak_shaving'）
  +-- 6. UPDATE trade_schedules SET status = 'executing'
  |
  v
M3 runPendingCommandDispatcher（每 10 秒）[v5.21 新增]
  | 讀取：device_command_logs WHERE result = 'pending'
  | 推進：UPDATE result = 'dispatched'
  |
  v
M3 runTimeoutCheck（每 30 秒）[v5.21/v5.22]
  | 偵測 1：dispatched + command_type='set' + >90s → timeout (gateway_no_response)
  | 偵測 2：accepted + command_type='set' + >20s → timeout (device_write_timeout)
  |
  v
閘道器（EMS 盒子）
  | 接收指令，進入 peak_shaving 模式
  | 維持瞬時需量 <= peak_limit_kva
  | 電池不足時觸發 DO 繼電器
```

---

## 11. 程式碼變更清單

| 檔案 | 動作 | 描述 |
|------|------|------|
| `dr-dispatcher/services/command-dispatcher.ts` | **MODIFY**（v5.21） | 新增 `runPendingCommandDispatcher`：輪詢 device_command_logs WHERE result='pending'，推進至 'dispatched'（FIFO，批次 50，SKIP LOCKED）。新增 `runTimeoutCheck`：dispatched >90s → timeout；`startCommandDispatcher` 加入 setInterval 定時器 |
| `dr-dispatcher/services/command-dispatcher.ts` | **MODIFY**（v5.22） | `runTimeoutCheck` 新增 accepted >20s → device_write_timeout 逾時偵測 |
| `dr-dispatcher/handlers/timeout-checker.ts` | **無變更** | 既有 dispatch_commands >15min 逾時（v5.11）維持不變 |
| `dr-dispatcher/handlers/collect-response.ts` | **無變更** | ACK 握手維持不變 |
| `dr-dispatcher/handlers/dispatch-command.ts` | **無變更**（自 v5.20 起） | Lambda EventBridge handler 維持不變 |

---

## 12. 測試策略

| 測試 | 輸入 | 預期結果 |
|------|------|----------|
| PS 指令已派遣 | trade_schedule target_mode='peak_shaving'，contracted=100kW，pf=0.92 | MQTT 酬載：peak_limit_kva=108.70 |
| NULL 契約容量 | contracted_demand_kw IS NULL | 派遣跳過，status='failed' |
| 預設計費功率因數 | billing_power_factor IS NULL | 使用 0.92 預設值 |
| 零計費功率因數 | billing_power_factor = 0 | 派遣跳過，記錄錯誤 |
| dispatch_records 已寫入 | PS 指令已派遣 | dispatch_records 中 target_mode = 'peak_shaving' |
| MQTT 主題正確 | orgId='org1', assetId='asset1' | 主題：solfacil/org1/asset1/command/mode |
| pending→dispatched | device_command_logs 中 3 筆 pending 記錄 | 全部更新為 dispatched |
| dispatched 逾時 | command_type='set'，created_at 超過 90 秒 | result='timeout'，error='gateway_no_response' |
| accepted 逾時 | command_type='set'，device_timestamp 超過 20 秒 | result='timeout'，error='device_write_timeout' |
| 併發安全 | 多實例同時輪詢 pending | SKIP LOCKED 確保無重複派遣 |
| 批次上限 | 100 筆 pending 記錄 | 單次僅處理 50 筆 |

---

## 文件歷史

| 版本 | 日期 | 摘要 |
|------|------|------|
| v5.2 | 2026-02-27 | 初版：DR 派遣 + SQS 逾時 |
| v5.6 | 2026-02-28 | MQTT 發送整合 |
| v5.9 | 2026-03-02 | Command Dispatcher 輪詢工作者、非同步 ACK |
| v5.11 | 2026-03-05 | 雙連線池：Service Pool 用於 cron，App Pool 用於 ACK |
| v5.16 | 2026-03-07 | PS 指令派遣：peak_shaving 模式處理；計算 peak_limit_kva（contracted_demand_kw / billing_power_factor）；MQTT 發佈 PS 酬載；dispatch_records.target_mode = 'peak_shaving'；NULL 契約容量與零 PF 的錯誤處理 |
| v5.20 | 2026-03-09 | Schema 對齊（e658e0d）：M3 schema 更新 |
| v5.21 | 2026-03-10 | M3→M1 指令派遣管線：`runPendingCommandDispatcher` 輪詢 device_command_logs pending→dispatched（FIFO，每 10 秒，批次 50，SKIP LOCKED）；`runTimeoutCheck` 偵測 dispatched >90s → timeout（gateway_no_response）；`startCommandDispatcher` 加入 setInterval 定時器 |
| **v5.22** | **2026-03-13** | **runTimeoutCheck 新增 accepted 逾時：command_type='set' 且 device_timestamp >20s → timeout（device_write_timeout）；派遣守衛於 BFF 端實作（非 M3）** |
