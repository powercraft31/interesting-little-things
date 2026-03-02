# Module 3: DR Dispatcher

> **模組版本**: v5.9
> **上層文件**: [00_MASTER_ARCHITECTURE_v5.9.md](./00_MASTER_ARCHITECTURE_v5.9.md)
> **最後更新**: 2026-03-02
> **說明**: DR 調度指令生成、MQTT 發送、SQS 逾時檢查、Retry 策略、狀態追蹤、Command Dispatcher Polling Worker、Real Async ACK Handshake

---

## 1. 模組職責

M3 負責將優化引擎（M2）的排程決策和操作員（M5）的手動指令，轉化為實際的 MQTT 控制指令發送到邊緣設備。

核心職責：
- 接收 EventBridge 事件（`DRCommandIssued`、`ScheduleGenerated`）
- 生成 `DispatchCommand` 並通過 MQTT 發送到設備
- 使用 DynamoDB 追蹤每個設備的調度狀態
- SQS Delay Queue 實現逾時檢查機制
- 聚合結果後發佈 `DRDispatchCompleted` / `DISPATCH_FAILED`

---

## 2. CDK Stack: `DrDispatcherStack`

| Resource | AWS Service | Purpose |
|----------|-------------|---------|
| Command Handler | Lambda (Node.js 20) | Process dispatch commands |
| MQTT Publisher | IoT Core (iotdata) | Publish commands to device topics |
| Status Tracker | DynamoDB | Track per-asset dispatch status & latency |
| Response Collector | Lambda (Node.js 20) | IoT Rule on response topic → aggregate |
| Timeout Queue | SQS (Delay Queue) | 15-min delayed message for offline device timeout |
| Timeout Checker | Lambda (Node.js 20) | Mark timed-out devices as FAILED |

### IAM Grants

```
DrDispatcherStack Lambda functions:
  ├─ iot:Publish               → solfacil/*/command/mode-change topics
  ├─ dynamodb:PutItem/Query    → dispatch_tracker table
  ├─ sqs:SendMessage           → timeout delay queue
  ├─ events:PutEvents          → solfacil-vpp-events bus
  └─ ssm:GetParameter          → /solfacil/dr/* parameters
```

---

## 3. EventBridge Integration

| Direction | Event | Source/Target |
|-----------|-------|---------------|
| **Publishes** | `DRDispatchCompleted` | → M4 (financial settlement), M5 (dashboard), M7 (webhooks) |
| **Publishes** | `AssetModeChanged` | → M4 (record mode change) |
| **Consumes** | `DRCommandIssued` | ← M5 (user-initiated dispatch) |
| **Consumes** | `ScheduleGenerated` | ← M2 (execute immediate mode changes) |

---

## 4. DispatchCommand 結構

### MQTT Topic Format

```
solfacil/{org_id}/{region}/{asset_id}/command/mode-change
```

### bat_workStatus 命令

| Command | Description |
|---------|-------------|
| `charge` | 強制充電 |
| `discharge` | 強制放電 |
| `idle` | 待機（停止充放電） |

---

## 5. DynamoDB Table: `dispatch_tracker`

```
Table: dispatch_tracker
PK: dispatch_id (ULID)
SK: asset_id
Attributes:
  - org_id (String, required)
  - command_type (BATCH_DISPATCH | DR_TEST)
  - target_mode (self_consumption | peak_valley_arbitrage | peak_shaving)
  - status (PENDING | EXECUTING | SUCCESS | FAILED)
  - requested_power_kw
  - actual_power_kw
  - response_latency_sec
  - accuracy_pct
  - timestamp
  - error_reason (null | "DEVICE_ERROR" | "TIMEOUT" | "MQTT_DELIVERY_FAILED")

GSI: status-index    (PK=dispatch_id, SK=status)
GSI: org-dispatch-index (PK=org_id, SK=dispatch_id)
```

---

## 6. DR 指令生成流程

### 完整流程

```
Step  Component              Action
----- ---------------------- -------------------------------------------------
 1    M5/M2                  Publish DRCommandIssued / ScheduleGenerated to EventBridge
 2    EventBridge            Route to M3 Lambda (dispatch-command)
 3    DR Dispatcher          For each asset_id in parallel:
                               a. Write PENDING to DynamoDB (with org_id)
                               b. MQTT publish: solfacil/{org_id}/{region}/{asset_id}/command/mode-change
                               c. Update status → EXECUTING
                               d. Enqueue SQS delayed message (15 min timeout)
 4    IoT Core               Delivers to edge devices (QoS 1, ~50-200ms)
 5    Edge Devices           Execute mode change → publish response to response topic
 6    IoT Core Rule          SELECT * FROM 'solfacil/+/+/+/response/mode-change'
                             → M3 Lambda (collect-response)
 7    DR Dispatcher          Updates DynamoDB: status → SUCCESS, metrics recorded
      (collect-response)     When all assets complete → publish DRDispatchCompleted
```

---

## 7. Timeout Mechanism (SQS Delay Queue)

```
DR Dispatcher Lambda                       SQS (Delay Queue)
(dispatch-command)                         delay = 15 minutes
      │                                          │
      ├── 1. Write PENDING to DynamoDB           │
      ├── 2. Publish MQTT command to device      │
      ├── 3. Update status → EXECUTING           │
      └── 4. Send delayed message to SQS ────────┤
                                                  │
           ┌──────────── 15 min later ────────────┘
           ▼
  Timeout Checker Lambda
      ├── Query DynamoDB for dispatch_id
      ├── Find records still in EXECUTING
      ├── Mark as FAILED (reason: "TIMEOUT")
      └── If all assets resolved:
           └── Publish "DRDispatchCompleted" to EventBridge
               (status: PARTIAL_SUCCESS or FAILED)
```

**Key Invariant:** A `DRDispatchCompleted` event **must** be published after timeout resolution, ensuring M4 can perform financial settlement even when devices are partially unreachable.

---

## 8. Retry 策略

Retry parameters from AppConfig `dispatch-policies` profile:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `max_retry_count` | 3 | Maximum retry attempts |
| `retry_backoff_seconds` | 60 | Backoff interval |
| `max_concurrent_dispatches` | 10 | Max concurrent operations per org |
| `timeout_minutes` | 15 | SQS delay queue timeout |

---

## 9. 調度確認機制

When edge devices execute mode changes, they publish to:
```
solfacil/{org_id}/{region}/{asset_id}/response/mode-change
```

The IoT Core Rule routes these to `collect-response` Lambda, which:
1. Updates DynamoDB: status → SUCCESS, records latency and accuracy
2. Calculates accuracy: `accuracy_pct = actual_power_kw / requested_power_kw * 100`
3. When all assets in a dispatch are resolved → publishes `DRDispatchCompleted`

### DRDispatchCompleted Payload

```json
{
  "source": "solfacil.dr-dispatcher",
  "detail-type": "DRDispatchCompleted",
  "detail": {
    "org_id": "ORG_ENERGIA_001",
    "dispatch_id": "01HWXYZ...",
    "command_type": "DR_TEST",
    "resolution": "TIMEOUT",
    "results": [
      { "asset_id": "ASSET_SP_001", "status": "SUCCESS", "latency": 1.73, "accuracy": 96.4 },
      { "asset_id": "ASSET_MG_003", "status": "FAILED", "error_reason": "TIMEOUT" }
    ],
    "aggregate": {
      "success_count": 2, "failed_count": 2, "timeout_count": 2,
      "avg_latency": 1.94, "total_power": 9.64, "avg_accuracy": 95.1,
      "status": "PARTIAL_SUCCESS"
    }
  }
}
```

| Scenario | `aggregate.status` |
|----------|-------------------|
| All devices respond | `SUCCESS` |
| Mixed results | `PARTIAL_SUCCESS` |
| All devices timeout | `FAILED` |

---

## 10. org_id Integration

- `dispatch_tracker` table includes `org_id` on every item
- GSI `org-dispatch-index` (PK=org_id, SK=dispatch_id) for tenant-scoped queries
- MQTT topics include org_id: `solfacil/{org_id}/{region}/{asset_id}/command/mode-change`
- All published events include `org_id` in detail

---

## 11. Lambda Handlers

```
src/dr-dispatcher/
├── handlers/
│   ├── dispatch-command.ts       # EventBridge DRCommandIssued → IoT Core MQTT + SQS delay
│   ├── collect-response.ts       # v5.9: Rewritten as Express handler (was AWS Lambda); ACK aggregation
│   ├── dr-test-orchestrator.ts   # DR test: select all → dispatch → report
│   └── timeout-checker.ts        # SQS trigger: check & mark timeouts
├── services/
│   ├── mqtt-publisher.ts         # IoT Core MQTT publish (batch fan-out)
│   ├── response-aggregator.ts    # Collect acks, compute latency & accuracy
│   ├── dispatch-tracker.ts       # DynamoDB: track dispatch status per asset
│   ├── command-dispatcher.ts     # v5.6: Polling Worker — 狀態機推進 + dispatch_commands 寫入; v5.9: timeout→failed
│   └── timeout-queue.ts          # SQS delayed message enqueue helper
├── routes/
│   └── dispatch-ack.ts           # v5.9: POST /api/dispatch/ack — Real ACK endpoint
└── __tests__/
    ├── dispatch-command.test.ts
    ├── command-dispatcher.test.ts  # v5.6; v5.9: timeout→failed tests
    ├── dispatch-ack.test.ts        # v5.9: ACK handshake tests
    └── response-aggregator.test.ts
```

---

## § v5.6 Command Dispatcher — Polling Worker Design

> **重要聲明：** 此 Worker 為 v5.6 內部管線實作，指令寫入 `dispatch_commands` 後即停止。
> v6.0 將接通真實 M1 IoT Hub MQTT 通道。

### 機制

| 項目 | 說明 |
|------|------|
| 觸發方式 | node-cron，每分鐘執行一次（`* * * * *`） |
| 並發保護 | DB 層 `SELECT ... FOR UPDATE SKIP LOCKED`，避免多實例競爭 |
| 執行環境 | Express server 內嵌 cron task |

### 狀態機流轉（本段核心）

```
trade_schedules 狀態流：

  ┌─────────────┐
  │  scheduled   │  （M2 Schedule Generator 寫入）
  └──────┬───────┘
         │ planned_time <= NOW()
         ▼
  ┌─────────────┐
  │  executing   │  （M3 Command Dispatcher 推進）
  └──────┬───────┘
         │ 執行窗口結束（planned_time + 15 min）
         ▼
  ┌─────────────┐
  │  executed    │  （正常完成）  ← v5.9: 只有收到 ACK 才標記
  └──────────────┘

  例外路徑：
  executing → failed  （超時未完成 / 異常）← v5.9: 15 min 無 ACK 則自動 failed
```

### 每次輪詢流程

```
每分鐘執行一次：

Step 1: 撈取到期排程
  SELECT id, asset_id, org_id, action, power_kw
  FROM trade_schedules
  WHERE status = 'scheduled'
    AND scheduled_at <= NOW()
  FOR UPDATE SKIP LOCKED;

Step 2: 批次推進狀態
  UPDATE trade_schedules
  SET status = 'executing', updated_at = NOW()
  WHERE id IN ($selected_ids);

Step 3: 生成調度指令
  FOR EACH executing trade:
    INSERT INTO dispatch_commands (
      trade_id, asset_id, org_id, action, power_kw,
      status, m1_boundary
    ) VALUES (
      $trade_id, $asset_id, $org_id, $action, $power_kw,
      'dispatched', true
    );

Step 4: 檢查過期調度指令（v5.9 修正）
  -- ❌ REMOVED (v5.9): bogus auto-execute
  -- UPDATE trade_schedules SET status = 'executed' WHERE status = 'executing'
  --   AND scheduled_at + INTERVAL '15 minutes' <= NOW();

  -- ✅ NEW (v5.9): mark as 'failed' if no ACK received within 15 minutes
  UPDATE dispatch_commands
  SET status = 'failed'
  WHERE status = 'dispatched'
    AND dispatched_at + INTERVAL '15 minutes' <= NOW();

  -- Also fail the parent trade_schedule
  UPDATE trade_schedules
  SET status = 'failed', updated_at = NOW()
  WHERE status = 'executing'
    AND id IN (
      SELECT trade_id FROM dispatch_commands
      WHERE status = 'failed'
        AND dispatched_at + INTERVAL '15 minutes' <= NOW()
    );
```

### dispatch_commands 表結構（v5.6 新增）

```sql
CREATE TABLE dispatch_commands (
  id              BIGSERIAL PRIMARY KEY,
  trade_id        BIGINT NOT NULL REFERENCES trade_schedules(id),
  asset_id        VARCHAR(50) NOT NULL,
  org_id          VARCHAR(50) NOT NULL,
  dispatched_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  action          TEXT NOT NULL,       -- charge / discharge / hold
  power_kw        NUMERIC(10,2) NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'dispatched',  -- dispatched / completed / failed
  m1_boundary     BOOLEAN NOT NULL DEFAULT true,       -- v5.6 永遠為 true（到邊界停止）
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 索引
CREATE INDEX idx_dispatch_commands_trade ON dispatch_commands(trade_id);
CREATE INDEX idx_dispatch_commands_asset ON dispatch_commands(asset_id, dispatched_at);
CREATE INDEX idx_dispatch_commands_org   ON dispatch_commands(org_id);
```

> **v5.9 status 值變更：** `dispatched` | `completed` | `failed`（取代舊的 `dispatched` | `acknowledged` | `failed`）

### v5.6 邊界限制（明確標註）

| 限制 | 說明 |
|------|------|
| 指令到邊界停止 | 寫入 `dispatch_commands` 後即停止，不做任何後續動作 |
| 不發送 MQTT | 不發送任何 MQTT 訊號到邊緣設備 |
| 不呼叫 M1 | 不呼叫 M1 IoT Hub 的任何 handler |
| m1_boundary 欄位 | v5.6 永遠為 `true`；v6.0 改為 `false` 並接通真實 MQTT 通道 |
| 不發送 EventBridge | 不發佈 `DRDispatchCompleted` 事件（因為沒有真實設備回應） |
| ~~狀態推進為 mock~~ | ~~`executing → executed` 基於時間窗口自動推進，非真實設備確認~~ **v5.9: 已移除，改為 ACK-based 狀態推進** |

---

## § Real Async ACK Handshake (v5.9)

### 問題陳述

當前 `command-dispatcher.ts` 在 Step 4 中包含以下邏輯：

```sql
-- ❌ BOGUS: 自動將超過 15 分鐘的 executing 標記為 'executed'
UPDATE trade_schedules
SET status = 'executed', updated_at = NOW()
WHERE status = 'executing'
  AND scheduled_at + INTERVAL '15 minutes' <= NOW();
```

**問題：** 這是假成功（bogus success）——沒有任何真實設備回報，僅基於時間窗口自動標記為「已執行」。
下游 M4 財務結算會基於這些假 `executed` 記錄計算收益，造成帳單數字與現實脫節。

### Fix 1 — 移除 Bogus Timer

**刪除** `command-dispatcher.ts` 中的自動標記 `executed` SQL 區塊。

**替換為** 逾時自動標記 `failed`：

```sql
-- v5.9: 超過 15 分鐘無 ACK → 標記為 failed（非 executed）
UPDATE dispatch_commands
SET status = 'failed'
WHERE status = 'dispatched'
  AND dispatched_at + INTERVAL '15 minutes' <= NOW();
```

**連帶更新 trade_schedules：**

```sql
UPDATE trade_schedules
SET status = 'failed', updated_at = NOW()
WHERE status = 'executing'
  AND id IN (
    SELECT trade_id FROM dispatch_commands
    WHERE status = 'failed'
      AND dispatched_at + INTERVAL '15 minutes' <= NOW()
  );
```

### Fix 2 — 新 ACK 端點：`POST /api/dispatch/ack`

#### 端點規格

| 項目 | 說明 |
|------|------|
| Method | `POST` |
| Path | `/api/dispatch/ack` |
| Authentication | Internal (device/mock-client only; no Cognito JWT required) |
| Content-Type | `application/json` |

#### Request Payload

```json
{
  "dispatch_id": 1,
  "status": "completed",
  "asset_id": "ASSET_SP_001"
}
```

| Field | Type | Required | Values |
|-------|------|----------|--------|
| `dispatch_id` | number | Yes | dispatch_commands.id |
| `status` | string | Yes | `"completed"` \| `"failed"` |
| `asset_id` | string | Yes | Must match dispatch_commands.asset_id |

#### Response

**Success (200):**
```json
{
  "ok": true,
  "dispatch_id": 1,
  "status": "completed"
}
```

**Not Found (404):**
```json
{
  "ok": false,
  "error": "dispatch_id not found"
}
```

**Conflict (409) — Already terminal:**
```json
{
  "ok": false,
  "error": "dispatch already in terminal status",
  "current_status": "completed"
}
```

#### DB Operation

```sql
-- 僅更新處於 'dispatched' 狀態的記錄（冪等保護）
UPDATE dispatch_commands
SET status = $status
WHERE id = $dispatch_id
  AND asset_id = $asset_id
  AND status = 'dispatched'
RETURNING id, status;

-- 若 RETURNING 無結果：
--   檢查是否存在 → 不存在 = 404
--   檢查當前 status → 已是 terminal = 409（冪等，不報錯）
```

**連帶更新 trade_schedules（當 ACK 為 completed 時）：**

```sql
-- 當 dispatch_command 被 ACK 為 completed，推進對應的 trade_schedule
UPDATE trade_schedules
SET status = 'executed', updated_at = NOW()
WHERE id = (SELECT trade_id FROM dispatch_commands WHERE id = $dispatch_id)
  AND status = 'executing';
```

#### Implementation Note

`collect-response.ts` 原為 AWS Lambda handler（接收 IoT Core Rule 觸發），
v5.9 改寫為標準 Express route handler，掛載於 `/api/dispatch/ack`。
不再依賴 IoT Core Rule 觸發，改為 HTTP POST 直接呼叫。

```typescript
// src/dr-dispatcher/routes/dispatch-ack.ts
import { Router, Request, Response } from 'express';
import { pool } from '../../shared/db';

const router = Router();

router.post('/api/dispatch/ack', async (req: Request, res: Response) => {
  const { dispatch_id, status, asset_id } = req.body;

  // Validate input
  if (!dispatch_id || !status || !asset_id) {
    return res.status(400).json({ ok: false, error: 'missing required fields' });
  }
  if (!['completed', 'failed'].includes(status)) {
    return res.status(400).json({ ok: false, error: 'status must be completed or failed' });
  }

  // Attempt update
  const result = await pool.query(
    `UPDATE dispatch_commands
     SET status = $1
     WHERE id = $2 AND asset_id = $3 AND status = 'dispatched'
     RETURNING id, status`,
    [status, dispatch_id, asset_id]
  );

  if (result.rowCount === 0) {
    // Check if record exists at all
    const existing = await pool.query(
      'SELECT id, status FROM dispatch_commands WHERE id = $1',
      [dispatch_id]
    );
    if (existing.rowCount === 0) {
      return res.status(404).json({ ok: false, error: 'dispatch_id not found' });
    }
    // Already in terminal status — idempotent 409
    return res.status(409).json({
      ok: false,
      error: 'dispatch already in terminal status',
      current_status: existing.rows[0].status
    });
  }

  // If completed, also update parent trade_schedule
  if (status === 'completed') {
    await pool.query(
      `UPDATE trade_schedules
       SET status = 'executed', updated_at = NOW()
       WHERE id = (SELECT trade_id FROM dispatch_commands WHERE id = $1)
         AND status = 'executing'`,
      [dispatch_id]
    );
  }

  return res.status(200).json({ ok: true, dispatch_id, status });
});

export default router;
```

### Acceptance Criteria

| Scenario | Input | Expected Result |
|----------|-------|-----------------|
| Happy path ACK | `POST /api/dispatch/ack {dispatch_id:1, status:'completed', asset_id:'ASSET_SP_001'}` | 200 `{ok:true, dispatch_id:1, status:'completed'}`; `dispatch_commands.status = 'completed'`; `trade_schedules.status = 'executed'` |
| Failed ACK | `POST /api/dispatch/ack {dispatch_id:2, status:'failed', asset_id:'ASSET_SP_002'}` | 200 `{ok:true, dispatch_id:2, status:'failed'}`; `dispatch_commands.status = 'failed'` |
| Timeout (no ACK) | dispatch_command with `dispatched_at > 15min` | Cron auto-marks `dispatch_commands.status = 'failed'`, `trade_schedules.status = 'failed'` |
| Not found | `POST /api/dispatch/ack {dispatch_id:999, ...}` | 404 `{ok:false, error:'dispatch_id not found'}` |
| Already terminal | `POST /api/dispatch/ack {dispatch_id:1, status:'completed', ...}` (second call) | 409 `{ok:false, error:'dispatch already in terminal status', current_status:'completed'}` |
| Missing fields | `POST /api/dispatch/ack {}` | 400 `{ok:false, error:'missing required fields'}` |

---

## 模組依賴關係

| 方向 | 模組 | 說明 |
|------|------|------|
| **依賴** | M1 (IoT Hub) | IoT Core MQTT publish（發送指令到設備）— v5.6 停在邊界 |
| **依賴** | M2 (Optimization Engine) | 消費 `ScheduleGenerated` 事件；v5.6: 讀取 trade_schedules DB |
| **依賴** | M5 (BFF) | 消費 `DRCommandIssued` 事件 |
| **依賴** | M8 (Admin Control) | AppConfig `dispatch-policies` 讀取 |
| **被依賴** | M4 (Market & Billing) | 消費 `DRDispatchCompleted` 進行結算；v5.6: M4 讀取 trade_schedules status=executed；**v5.9: status 僅在真實 ACK 後才變為 executed** |
| **被依賴** | M5 (BFF) | 消費 `DRDispatchCompleted` 更新儀表板 |
| **被依賴** | M7 (Open API) | 消費 `DRDispatchCompleted` → webhook |
| **被依賴** | Mock Hardware Client | **v5.9: 輪詢 dispatch_commands → 模擬執行 → POST /api/dispatch/ack** |

---

## Document History

| Version | Date | Summary |
|---------|------|---------|
| v5.2 | 2026-02-27 | 初始版本：MQTT 調度、SQS 逾時、DynamoDB 狀態追蹤 |
| v5.6 | 2026-02-28 | Command Dispatcher Polling Worker：狀態機 scheduled→executing→executed、dispatch_commands 表、M1 邊界停止 |
| v5.9 | 2026-03-02 | Real async ACK handshake; remove bogus 15-min timer |
