# Module 3: DR Dispatcher

> **模組版本**: v5.11
> **上層文件**: [00_MASTER_ARCHITECTURE_v5.11.md](./00_MASTER_ARCHITECTURE_v5.11.md)
> **最後更新**: 2026-03-05
> **說明**: DR 調度指令生成、MQTT 發送、SQS 逾時檢查、Retry 策略、狀態追蹤、Command Dispatcher Polling Worker、Real Async ACK Handshake、**v5.11: Dual Pool — Service Pool for Cron Jobs, App Pool for ACK Endpoint**

---

## § v5.11 Dual Pool Assignment

### 問題陳述

M3 有三個獨立元件，各有不同的 pool 需求：

| 元件 | 觸發方式 | 數據存取模式 | v5.10 Pool | 問題 |
|------|---------|------------|-----------|------|
| `command-dispatcher.ts` | Cron (每分鐘) | 讀 `trade_schedules` (RLS)、寫 `dispatch_commands` (RLS) | `getPool()` | RLS 阻擋跨租戶讀取 |
| `timeout-checker.ts` | Cron (每分鐘) | 讀/寫 `dispatch_commands` (RLS)、寫 `trade_schedules` (RLS) | `getPool()` | RLS 阻擋跨租戶讀取 |
| `collect-response.ts` | HTTP POST `/api/dispatch/ack` | 讀/寫 `dispatch_commands` (RLS) | `getPool()` | **看情況** |

### 元件 1: command-dispatcher.ts → Service Pool

**理由：** Command Dispatcher 是 cron job，每分鐘輪詢所有到期的 `trade_schedules`，不區分租戶。

查詢分析：

```sql
-- Step 1: 讀取到期排程（跨所有租戶）
SELECT id, asset_id, org_id, action, expected_volume_kwh
FROM trade_schedules
WHERE status = 'scheduled' AND planned_time <= NOW()
FOR UPDATE SKIP LOCKED;
-- ↑ trade_schedules 有 RLS → solfacil_app 需要 org_id → 空結果

-- Step 2: 推進到 executing
UPDATE trade_schedules SET status = 'executing' WHERE id = ANY($1);
-- ↑ RLS 阻擋

-- Step 3: 寫入 dispatch_commands
INSERT INTO dispatch_commands (trade_id, asset_id, org_id, action, volume_kwh, status, m1_boundary) ...
-- ↑ dispatch_commands 有 RLS → 寫入被阻擋
```

**結論：必須使用 Service Pool (BYPASSRLS)。**

### 元件 2: timeout-checker.ts → Service Pool

**理由：** Timeout Checker 是 cron job，每分鐘掃描所有逾時的 `dispatch_commands`，不區分租戶。

查詢分析：

```sql
-- Step 1: 找出逾時指令（跨所有租戶）
SELECT id, trade_id FROM dispatch_commands
WHERE status = 'dispatched' AND dispatched_at < NOW() - INTERVAL '15 minutes';
-- ↑ dispatch_commands 有 RLS → solfacil_app 需要 org_id → 空結果

-- Step 2: 批次標記 failed
UPDATE dispatch_commands SET status = 'failed' WHERE id = ANY($1);
-- ↑ RLS 阻擋

-- Step 3: 連帶更新 trade_schedules
UPDATE trade_schedules SET status = 'failed' WHERE id = ANY($1) AND status = 'executing';
-- ↑ RLS 阻擋
```

**結論：必須使用 Service Pool (BYPASSRLS)。**

### 元件 3: collect-response.ts (ACK endpoint) → App Pool

**理由：** ACK endpoint 是 HTTP POST handler，由外部設備/mock client 呼叫。
雖然目前 ACK endpoint 不使用 Cognito 認證（Internal only），
但它操作的是**特定** dispatch_command（by `dispatch_id`），不需要跨租戶讀取。

查詢分析：

```sql
-- 讀取特定 dispatch_command（by id）
SELECT id, trade_id, status FROM dispatch_commands WHERE id = $1 FOR UPDATE;
-- ↑ dispatch_commands 有 RLS，但 WHERE 條件是 id（非 org_id filter）
-- ↑ 問題：RLS 會同時過濾 org_id = current_setting('app.current_org_id')
-- ↑ 如果沒有設定 org_id → 即使 WHERE id = $1 也返回空結果
```

**設計決策：使用 App Pool，但需確保 ACK endpoint 不受 RLS 影響。**

兩種方案：

| 方案 | 描述 | 優點 | 缺點 |
|------|------|------|------|
| **A: Service Pool** | ACK endpoint 也使用 service pool | 簡單，不受 RLS 影響 | ACK 是 HTTP endpoint，使用 service pool 有安全隱患（任何 HTTP 請求都繞過 RLS） |
| **B: Service Pool (推薦)** | ACK endpoint 使用 service pool，但限制在 internal network | ACK 是 internal endpoint（不走 Cognito），service pool 合理 | 需要確保 ACK endpoint 不暴露到公網 |

**v5.11 決策：ACK endpoint 使用 Service Pool。**

理由：
1. ACK endpoint 是 internal endpoint（設備/mock client 呼叫），不走 Cognito JWT 認證
2. 它需要按 `dispatch_id` 讀取 dispatch_commands — 如果用 app pool 且不設定 org_id，RLS 會返回空結果
3. 在 ACK handler 內部額外查詢 org_id 再 `SET LOCAL` 是過度工程

### 代碼變更清單

| 文件 | 函數 | v5.10 Pool | v5.11 Pool | 理由 |
|------|------|-----------|-----------|------|
| `scripts/local-server.ts` | `startCommandDispatcher()` 呼叫處 | `getPool()` | `getServicePool()` | 跨租戶 trade_schedules + dispatch_commands |
| `scripts/local-server.ts` | `startTimeoutChecker()` 呼叫處 | `getPool()` | `getServicePool()` | 跨租戶 dispatch_commands + trade_schedules |
| `scripts/local-server.ts` | `createAckHandler()` 呼叫處 | `getPool()` | `getServicePool()` | dispatch_commands 有 RLS，ACK 不設定 org_id |
| `src/dr-dispatcher/services/command-dispatcher.ts` | — | **不變** | **不變** | 函數簽名已是 pool 注入模式 |
| `src/dr-dispatcher/handlers/timeout-checker.ts` | — | **不變** | **不變** | 函數簽名已是 pool 注入模式 |
| `src/dr-dispatcher/handlers/collect-response.ts` | — | **不變** | **不變** | 函數簽名已是 pool 注入模式 |

---

## 其他章節（v5.9 — unchanged）

§1-§11、Command Dispatcher Polling Worker、Real Async ACK Handshake — 與 v5.9 相同，不重複。
參見 `03_DR_DISPATCHER_MODULE_v5.9.md`。

---

## Document History

| Version | Date | Summary |
|---------|------|---------|
| v5.2 | 2026-02-27 | 初始版本：MQTT 調度、SQS 逾時、DynamoDB 狀態追蹤 |
| v5.6 | 2026-02-28 | Command Dispatcher Polling Worker |
| v5.9 | 2026-03-02 | Real async ACK handshake; remove bogus 15-min timer |
| **v5.11** | **2026-03-05** | **Dual Pool Assignment: (1) command-dispatcher → service pool (跨租戶 trade_schedules/dispatch_commands); (2) timeout-checker → service pool (跨租戶 dispatch_commands/trade_schedules); (3) collect-response ACK endpoint → service pool (dispatch_commands 有 RLS，ACK internal endpoint 不設定 org_id)。所有函數簽名不變（pool 注入模式）。** |

---

## 模組依賴關係

| 方向 | 模組 | 說明 |
|------|------|------|
| **依賴** | M2 (Optimization Engine) | trade_schedules DB polling |
| **依賴** | M5 (BFF) | 消費 `DRCommandIssued` 事件 |
| **依賴** | M8 (Admin Control) | AppConfig `dispatch-policies` |
| **依賴** | **Shared Layer** | **v5.11: `getServicePool()` from `shared/db`（透過 local-server.ts pool 注入）** |
| **被依賴** | M4 (Market & Billing) | 消費 `DRDispatchCompleted` |
| **被依賴** | M5 (BFF) | 消費 `DRDispatchCompleted` |
| **被依賴** | M7 (Open API) | 消費 `DRDispatchCompleted` → webhook |
