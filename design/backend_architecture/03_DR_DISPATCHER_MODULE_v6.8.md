# Module 3: DR Dispatcher (M3)

> **Module Version**: v6.8
> **Git HEAD**: `b94adf3`
> **Parent Document**: [00_MASTER_ARCHITECTURE_v6.8.md](./00_MASTER_ARCHITECTURE_v6.8.md)
> **Last Updated**: 2026-04-02
> **Description**: Demand response dispatch execution pipeline -- converts trade schedules into device commands, tracks execution lifecycle, and handles timeouts
> (**说明**: 需量响应调度执行管线 -- 将交易排程转化为设备指令、追踪执行生命周期、处理超时)

---

## 1. Module Overview

M3 is the execution arm of the VPP platform. It bridges the gap between M2's optimization decisions and M1's device control layer. The module contains four TypeScript source files implementing two distinct dispatch paths:

1. **EventBridge-triggered dispatch** (`dispatch-command.ts`) -- Lambda handler that receives `DRCommandIssued` events from M5/BFF, writes to DynamoDB, publishes MQTT commands via IoT Data Plane, and enqueues timeout tracking to SQS.
   (EventBridge触发的调度：Lambda接收来自M5/BFF的事件，写入DynamoDB、发布MQTT指令、入队超时追踪)

2. **Cron-driven dispatch** (`command-dispatcher.ts`) -- three background jobs that promote scheduled trades to dispatched commands, process pending device commands, and detect timeouts.
   (定时驱动的调度：三个后台任务，推进排程→指令、处理待发送指令、检测超时)

3. **ACK collection** (`collect-response.ts`) -- Express endpoint receiving hardware acknowledgements with idempotency guard and cascading status updates.
   (ACK收集：Express端点接收硬件确认，幂等保护与级联状态更新)

4. **Timeout checker** (`timeout-checker.ts`) -- minutely cron detecting stale dispatched commands.
   (超时检查器：每分钟检测滞留指令)

### Source Layout

```
src/dr-dispatcher/
├── handlers/
│   ├── dispatch-command.ts     # Lambda: EventBridge → DynamoDB + IoT MQTT + SQS
│   ├── collect-response.ts     # POST /api/dispatch/ack — hardware ACK handler
│   └── timeout-checker.ts      # Cron 1min: stale dispatched → failed
└── services/
    └── command-dispatcher.ts   # 3 background jobs: trade→dispatch, pending, timeout
```

---

## 2. dispatch-command.ts (Lambda Handler)

**Trigger**: EventBridge rule matching `DRCommandIssued` events from M5/BFF
**Purpose**: Execute the quasi-transactional dispatch flow: DynamoDB write, MQTT publish, SQS enqueue
(执行准事务调度流程：DynamoDB写入、MQTT发布、SQS入队)

### 2.1 Event Input

```typescript
interface DRCommandDetail {
  readonly dispatchId: string;
  readonly assetId: string;
  readonly targetMode: string;
  readonly orgId: string;
  readonly traceId?: string;
}
```

### 2.2 Three-Step Execution Flow

| Step | Action | AWS Service | Failure Handling |
|------|--------|-------------|------------------|
| 1 | Write dispatch record (`status: EXECUTING`) | DynamoDB (`PutCommand`) | Throw error (Lambda retry) |
| 2 | Publish MQTT command to device | IoT Data Plane (`PublishCommand`) | Mark record FAILED, then throw |
| 3 | Enqueue timeout tracking message | SQS (`SendMessageCommand`) | Throw error (Lambda retry) |

**MQTT topic pattern**: `solfacil/{orgId}/{assetId}/command/mode`
**MQTT payload**: `{ targetMode, dispatchId }`
**MQTT QoS**: 1 (at least once)

### 2.3 Environment Variables

| Env Var | Purpose |
|---------|----------|
| `TABLE_NAME` | DynamoDB table for dispatch records (DynamoDB调度记录表) |
| `QUEUE_URL` | SQS queue URL for timeout tracking (SQS超时追踪队列) |
| `IOT_ENDPOINT` | IoT Data Plane endpoint (IoT数据平面端点) |

### 2.4 Rollback on MQTT Failure

If MQTT publish fails, the DynamoDB record is updated to `FAILED` via `markFailed()` before re-throwing the error. This prevents orphaned `EXECUTING` records.
(MQTT发布失败时，DynamoDB记录回滚为FAILED状态，防止孤立的EXECUTING记录)

---

## 3. collect-response.ts (ACK Handler)

**Route**: `POST /api/dispatch/ack`
**Purpose**: Receive hardware ACK/NACK and cascade status to parent trade schedule
(接收硬件ACK/NACK并级联状态至父级交易排程)

### 3.1 Request Payload

```typescript
interface AckPayload {
  dispatch_id: number;
  status: "completed" | "failed";
  asset_id: string;
}
```

### 3.2 Processing Flow

1. **Validate payload**: `dispatch_id`, `status` (must be `completed` or `failed`), `asset_id` required -> 400 if invalid
2. **Lock dispatch record**: `SELECT id, trade_id, status FROM dispatch_commands WHERE id = $1 FOR UPDATE`
3. **404 check**: Dispatch command not found -> 404
4. **Idempotency guard**: If `status !== 'dispatched'` (already terminal) -> **409 Conflict**
   (幂等保护：已终态的指令返回409)
5. **Update dispatch_commands**: Set status to `completed` or `failed`
6. **Cascade to trade_schedules**:
   - `completed` -> `UPDATE trade_schedules SET status = 'executed' WHERE id = $1 AND status = 'executing'`
   - `failed` -> `UPDATE trade_schedules SET status = 'failed' WHERE id = $1 AND status = 'executing'`
7. **COMMIT** transaction

### 3.3 Response Codes

| Code | Condition |
|------|----------|
| 200 | ACK processed successfully (处理成功) |
| 400 | Missing or invalid fields (字段缺失或无效) |
| 404 | Dispatch command not found (指令不存在) |
| 409 | Already in terminal state (已为终态 -- 幂等保护) |
| 500 | Internal server error |

---

## 4. timeout-checker.ts (Minutely Cron)

**Schedule**: `* * * * *` (every minute)
**Purpose**: Detect dispatched commands stuck for > 15 minutes and mark them (and parent trade schedules) as `failed`
(检测滞留超过15分钟的已调度指令，标记为失败)

### 4.1 Logic

```sql
-- Find stale dispatched commands (查找滞留指令)
SELECT id, trade_id FROM dispatch_commands
WHERE status = 'dispatched'
  AND dispatched_at < NOW() - INTERVAL '15 minutes'
```

Then batch-update:
1. `UPDATE dispatch_commands SET status = 'failed' WHERE id = ANY($1) AND status = 'dispatched'`
2. `UPDATE trade_schedules SET status = 'failed' WHERE id = ANY($1) AND status = 'executing'`

All within a single transaction. No-op if no stale commands found.
(单一事务内执行。无滞留指令时为空操作)

---

## 5. command-dispatcher.ts (3 Background Jobs)

**Purpose**: Three concurrent background jobs handling the cron-driven dispatch path (PostgreSQL-based, not EventBridge)
(三个并发后台任务处理定时驱动的调度路径，基于PostgreSQL)

### 5.1 Job 1: Trade Schedule Dispatcher (每分钟)

**Schedule**: `* * * * *` (every minute via `node-cron`)

Promotes due `trade_schedules` into `dispatch_commands`:

1. **SELECT** `trade_schedules WHERE status = 'scheduled' AND planned_time <= NOW() FOR UPDATE SKIP LOCKED`
2. **UPDATE** matched rows to `status = 'executing'`
3. **INSERT** into `dispatch_commands` for each trade: `(trade_id, asset_id, org_id, action, volume_kwh, status='dispatched', m1_boundary=true)`
4. **Peak Shaving**: If `target_mode = 'peak_shaving'`, also writes to `dispatch_records` with computed `peak_limit_kva`

**Peak Shaving `peak_limit_kva` calculation** (需量管理限值计算):

```typescript
const contractedKw = demandResult.rows[0]?.contracted_demand_kw ?? 0;
const pf = demandResult.rows[0]?.billing_power_factor ?? 0.92;
const peakLimitKva = pf > 0 ? Math.round((contractedKw / pf) * 100) / 100 : contractedKw;
```

The `billing_power_factor` is read from `tariff_schedules` (default: 0.92). The formula: `peak_limit_kva = contracted_demand_kw / billing_power_factor`.
(billing_power_factor从tariff_schedules读取，默认0.92。公式：peak_limit_kva = contracted_demand_kw / billing_power_factor)

### 5.2 Job 2: Pending Command Dispatcher (每10秒)

**Schedule**: `setInterval(10_000)` (every 10 seconds)

Processes `device_command_logs` entries stuck in `pending` state:

1. **SELECT** up to 50 rows `WHERE result = 'pending' ORDER BY created_at ASC FOR UPDATE SKIP LOCKED`
2. **UPDATE** to `result = 'dispatched'`

### 5.3 Job 3: Device Timeout Check (每30秒)

**Schedule**: `setInterval(30_000)` (every 30 seconds)

Two timeout tiers for `device_command_logs`:

| Timeout Tier | Condition | Timeout Duration | Error Message |
|-------------|-----------|------------------|---------------|
| **Dispatched commands** | `result = 'dispatched'` AND `command_type = 'set'` | 90 seconds from `created_at` | `gateway_no_response` (网关无响应) |
| **Accepted commands** | `result = 'accepted'` AND `command_type = 'set'` | 20 seconds from `device_timestamp` | `device_write_timeout` (设备写入超时) |

Both use `UPDATE ... SET result = 'timeout', resolved_at = NOW()` with `RETURNING id` for logging.

---

## 6. State Machine (状态机)

### 6.1 trade_schedules Status Flow

```
scheduled ──(planned_time <= NOW())──> executing ──(ACK completed)──> executed
                                           │
                                           ├──(ACK failed)──> failed
                                           └──(15min timeout)──> failed
```

### 6.2 dispatch_commands Status Flow

```
dispatched ──(ACK completed)──> completed
     │
     ├──(ACK failed)──> failed
     └──(15min timeout)──> failed
```

### 6.3 device_command_logs Status Flow

```
pending ──(10s poll)──> dispatched ──(gateway ACK)──> accepted ──(device confirm)──> success
                             │                            │
                             └──(90s timeout)──> timeout  └──(20s timeout)──> timeout
```

### 6.4 DynamoDB Dispatch Record (Lambda Path)

```
EXECUTING ──(MQTT success)──> (awaiting SQS timeout check)
     │
     └──(MQTT failure)──> FAILED
```

---

## 7. DB Tables (数据库表)

### 7.1 `dispatch_commands` (PostgreSQL)

| Column | Type | Description |
|--------|------|-------------|
| `id` | `SERIAL` | Primary key |
| `trade_id` | `INT` | FK to `trade_schedules.id` (父级交易排程) |
| `asset_id` | `VARCHAR` | Target asset (目标资产) |
| `org_id` | `VARCHAR` | Organization (组织) |
| `action` | `VARCHAR` | `charge` / `discharge` |
| `volume_kwh` | `NUMERIC` | Expected energy volume (预期能量) |
| `status` | `VARCHAR` | `dispatched` / `completed` / `failed` |
| `m1_boundary` | `BOOLEAN` | Marks M1 integration boundary (M1集成边界标记) |
| `dispatched_at` | `TIMESTAMPTZ` | Timestamp for timeout calculation |

### 7.2 `trade_schedules` (PostgreSQL)

| Column | Type | Description |
|--------|------|-------------|
| `id` | `SERIAL` | Primary key |
| `asset_id` | `VARCHAR` | Target asset |
| `org_id` | `VARCHAR` | Organization |
| `planned_time` | `TIMESTAMPTZ` | Scheduled execution time (计划执行时间) |
| `action` | `VARCHAR` | `charge` / `discharge` |
| `expected_volume_kwh` | `NUMERIC` | Expected energy volume |
| `target_pld_price` | `NUMERIC` | Target PLD price (0 for PS) |
| `status` | `VARCHAR` | `scheduled` / `executing` / `executed` / `failed` |
| `target_mode` | `VARCHAR` | `peak_shaving` / NULL (普通排程) |

### 7.3 `dispatch_records` (PostgreSQL)

| Column | Type | Description |
|--------|------|-------------|
| `asset_id` | `VARCHAR` | Target asset |
| `dispatched_at` | `TIMESTAMPTZ` | Dispatch timestamp |
| `dispatch_type` | `VARCHAR` | `peak_shaving` |
| `commanded_power_kw` | `NUMERIC` | `peak_limit_kva` value (限值) |
| `target_mode` | `VARCHAR` | `peak_shaving` |

### 7.4 `device_command_logs` (PostgreSQL)

| Column | Type | Description |
|--------|------|-------------|
| `id` | `SERIAL` | Primary key |
| `command_type` | `VARCHAR` | `set` / other |
| `result` | `VARCHAR` | `pending` / `dispatched` / `accepted` / `success` / `timeout` |
| `created_at` | `TIMESTAMPTZ` | Creation timestamp |
| `device_timestamp` | `TIMESTAMPTZ` | Device acknowledgement time |
| `resolved_at` | `TIMESTAMPTZ` | Final resolution time |
| `error_message` | `VARCHAR` | `gateway_no_response` / `device_write_timeout` / NULL |

---

## 8. Peak Shaving Detail (需量管理细节)

The peak shaving flow spans M2 (schedule generation) and M3 (dispatch execution):

1. **M2 schedule-generator** writes `trade_schedules` rows with `target_mode = 'peak_shaving'` for BRT 18:00-22:00
2. **M3 command-dispatcher** (Job 1) picks up due PS trades and:
   - Queries `contracted_demand_kw` from `gateways` via `assets`
   - Queries `billing_power_factor` from `tariff_schedules` (default 0.92)
   - Computes: `peak_limit_kva = contracted_demand_kw / billing_power_factor`
   - Writes `dispatch_records` with `commanded_power_kw = peak_limit_kva`

This ensures the device knows the maximum apparent power (kVA) it should maintain at the grid connection point.
(确保设备知道其在并网点应维持的最大视在功率kVA)

---

## 9. Integration Points (集成接口)

| Direction | Module | Description |
|-----------|--------|-------------|
| **Consumes** | M5 (BFF), M2 (Optimization Engine) | `DRCommandIssued` via EventBridge from BFF; `trade_schedules` via PostgreSQL from M2 |
| **Publishes to** | M1 (IoT Hub) | MQTT commands via IoT Data Plane (`dispatch-command.ts`) |
| **Reads from** | M1 (IoT Hub) | `device_command_logs` written by MQTT ACK flow |
| **Reads from** | DB | `gateways`, `assets`, `tariff_schedules` for peak shaving computation |
| **Exposes** | M5 (BFF) | `POST /api/dispatch/ack` endpoint |

---

## V2.4 Protocol Impact

**No code changes required.** M3 reads from `device_command_logs` (`result`, `created_at`, `device_timestamp`) and `tariff_schedules` (`billing_power_factor`) — none of these are affected by the V2.4 protocol changes. The `device_timestamp` column stores `TIMESTAMPTZ` values regardless of how M1 parsed the original protocol timestamp, so M3's timeout logic works identically.

---

## Document History

| Version | Date | Summary |
|---------|------|----------|
| v5.2 | 2026-02-27 | Initial: EventBridge-triggered Lambda dispatch with DynamoDB + MQTT + SQS |
| v5.9 | 2026-03-02 | Added PostgreSQL-based dispatch path: command-dispatcher.ts, collect-response.ts, timeout-checker.ts |
| v5.16 | 2026-03-07 | Peak shaving dispatch: compute peak_limit_kva from contracted_demand_kw / billing_power_factor; write dispatch_records |
| v6.6 | 2026-03-31 | Code-aligned rewrite: document all 4 source files, state machines, timeout tiers (90s/20s for device_command_logs), peak shaving kVA computation, DB table schemas |
| **v6.8** | **2026-04-02** | **Version bump for V2.4 protocol upgrade. No M3 code changes — upstream timestamp handling and value scaling are transparent to dispatch logic.** |
