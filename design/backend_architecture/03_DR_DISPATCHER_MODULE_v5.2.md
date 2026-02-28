# Module 3: DR Dispatcher

> **模組版本**: v5.2
> **上層文件**: [00_MASTER_ARCHITECTURE_v5.2.md](./00_MASTER_ARCHITECTURE_v5.2.md)
> **最後更新**: 2026-02-27
> **說明**: DR 調度指令生成、MQTT 發送、SQS 逾時檢查、Retry 策略、狀態追蹤

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
│   ├── collect-response.ts       # IoT Rule → aggregate device responses
│   ├── dr-test-orchestrator.ts   # DR test: select all → dispatch → report
│   └── timeout-checker.ts        # SQS trigger: check & mark timeouts
├── services/
│   ├── mqtt-publisher.ts         # IoT Core MQTT publish (batch fan-out)
│   ├── response-aggregator.ts    # Collect acks, compute latency & accuracy
│   ├── dispatch-tracker.ts       # DynamoDB: track dispatch status per asset
│   └── timeout-queue.ts          # SQS delayed message enqueue helper
└── __tests__/
    ├── dispatch-command.test.ts
    └── response-aggregator.test.ts
```

---

## 模組依賴關係

| 方向 | 模組 | 說明 |
|------|------|------|
| **依賴** | M1 (IoT Hub) | IoT Core MQTT publish（發送指令到設備） |
| **依賴** | M2 (Optimization Engine) | 消費 `ScheduleGenerated` 事件 |
| **依賴** | M5 (BFF) | 消費 `DRCommandIssued` 事件 |
| **依賴** | M8 (Admin Control) | AppConfig `dispatch-policies` 讀取 |
| **被依賴** | M4 (Market & Billing) | 消費 `DRDispatchCompleted` 進行結算 |
| **被依賴** | M5 (BFF) | 消費 `DRDispatchCompleted` 更新儀表板 |
| **被依賴** | M7 (Open API) | 消費 `DRDispatchCompleted` → webhook |
