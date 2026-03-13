# M1: IoT Hub Module — MQTT 協議接入層

> **Module Version**: v5.22 (two-phase set_reply + backfill)
> **Parent**: [00_MASTER_ARCHITECTURE_v5.15.md](./00_MASTER_ARCHITECTURE_v5.15.md)
> **Last Updated**: 2026-03-13
> **Description**: Full Solfacil Protocol v1.2 integration — 6 subscribe + 4 publish topics, anti-corruption layer, gateway registry, command pipeline, backfill infrastructure
> **Core Theme**: Two-phase command acknowledgement, reconnect gap detection, historical data backfill

---

## Changes from v5.18

| Component | Before (v5.18) | After (v5.22) |
|-----------|---------------|---------------|
| Schema: homes/gateways | `homes` 表獨立存在；`gateways.home_id` FK → homes | `homes` 表刪除；`gateways` 吸收 `name`/`address`/`contracted_demand_kw` 欄位（v5.19） |
| gateway_id 格式 | 合成 ID（`GW-SF-001`） | 設備序號（`WKRD24070202100144F`）（v5.19） |
| assets.home_id | FK → homes | 移除，完全使用 `gateway_id` FK（v5.19） |
| device_command_logs.client_id | 獨立欄位 | 移除（= gateway_id）（v5.19） |
| M1 程式碼 | 引用 client_id / home_id | 清除所有 client_id / home_id 引用（v5.20） |
| Command dispatch | BFF 直接 MQTT publish | M3→M1 pipeline: M3 寫 `device_command_logs` result='pending'，M1 `CommandPublisher` 輪詢 pending→dispatched 並 publish MQTT config/set（v5.21） |
| SSE 通知 | 無 | `pg_notify('telemetry_update')` + `pg_notify('gateway_health')` 於 FA flush 時觸發；`pg_notify('command_status')` 於 set_reply 處理時觸發（v5.21） |
| set_reply 處理 | 單階段：pending→success/fail | 二階段：pending→dispatched→accepted→success/fail；accepted 20s 逾時（v5.22 Phase 1） |
| Dispatch guard | 無 | BFF 返回 409 若存在 pending/dispatched/accepted 命令（v5.22 Phase 1） |
| MQTT Topics (Subscribe) | 5 per gateway | 6 per gateway（+`data/missed`）（v5.22 Phase 2-3） |
| MQTT Topics (Publish) | 3 per gateway | 4 per gateway（+`data/get_missed`）（v5.22 Phase 2） |
| Backfill | 無 | `backfill_requests` 表 + `HeartbeatHandler` 斷線偵測 + `BackfillRequester` 服務 + `MissedDataHandler` + `BackfillAssembler`（v5.22 Phase 2-3） |
| FragmentAssembler | 單一用途（即時遙測） | `parseTelemetryPayload` 抽取為共用純函式，與 BackfillAssembler 共享（v5.22 Phase 3） |
| Watchdog threshold | 90s（3 次心跳遺漏） | 10 分鐘 `OFFLINE_THRESHOLD_MS = 600_000`（v5.22） |
| telemetry_history dedup | 無唯一索引 | `UNIQUE INDEX idx_telemetry_unique_asset_time ON telemetry_history(asset_id, recorded_at)`（v5.22 Phase 3） |

---

## 1. Architecture Overview

```
                  ┌────────────────────────────────────────────────┐
                  │              MQTT Broker                        │
                  │         18.141.63.142:1883                      │
                  └──┬──────┬──────┬──────┬──────┬──────┬──────────┘
                     │S1    │S2    │S3    │S4    │S5    │S6
                     ▼      ▼      ▼      ▼      ▼      ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    M1 IoT Hub (v5.22)                                │
│                                                                      │
│  ┌──────────────┐  ┌──────────────────────────────────────────────┐ │
│  │ Gateway       │  │ Anti-Corruption Layer (ACL)                  │ │
│  │ Connection    │  │                                              │ │
│  │ Manager       │  │  S1 → DeviceListHandler  → assets           │ │
│  │               │  │  S2 → TelemetryHandler   → telemetry_*      │ │
│  │  reads        │  │       ├─ FragmentAssembler (merge 5 msgs)    │ │
│  │  gateways     │  │       │   └─ parseTelemetryPayload (shared)  │ │
│  │  table        │  │       ├─ EmsListProcessor → gateways         │ │
│  │               │  │       └─ DidoProcessor    → DO0/DO1          │ │
│  │  subscribes   │  │  S3 → CommandTracker     → cmd_logs         │ │
│  │  6 topics/gw  │  │  S4 → CommandTracker     → cmd_logs         │ │
│  │               │  │       └─ two-phase: accepted→success/fail    │ │
│  │  watchdog     │  │  S5 → HeartbeatHandler   → gateways         │ │
│  │  10min        │  │       └─ reconnect gap → backfill_requests   │ │
│  └──────┬───────┘  │  S6 → MissedDataHandler  → telemetry_*      │ │
│         │          │       └─ BackfillAssembler (dedup INSERT)     │ │
│         │          │                                              │ │
│         ▼          │  P1 ← ScheduleTranslator  ← BFF              │ │
│    ┌─────────┐     │  P2 ← CommandPublisher    ← poll pending     │ │
│    │gateways │     │  P3 ← SubDevicesPoller    ← Timer/Startup    │ │
│    │  table  │     │  P4 ← BackfillRequester   ← poll backfill_*  │ │
│    └─────────┘     └──────────────────────────────────────────────┘ │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ Services                                                      │   │
│  │  CommandPublisher   — polls pending → dispatched → MQTT set   │   │
│  │  BackfillRequester  — polls backfill_requests → MQTT get_missed│   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
    ┌─────────┐         ┌──────────┐         ┌──────────┐
    │   BFF   │         │   M2     │         │   M3     │
    │ (API)   │         │ (Optim)  │         │ (DR)     │
    └─────────┘         └──────────┘         └──────────┘
```

### Module Interactions

| Caller | Direction | M1 Function | Trigger |
|--------|-----------|-------------|---------|
| BFF | → M1 | `publishConfigGet(pool, gatewayId, publish)` | 使用者開啟排程編輯器 |
| BFF | → M1 | `publishConfigSet(pool, gatewayId, schedule, publish)` | 使用者點擊「套用到網關」（409 guard） |
| M2 | → M1 | `publishConfigSet(pool, gatewayId, schedule, publish)` | 演算法自動排程 |
| M3 | → M1 | 寫入 `device_command_logs` result='pending' | DR dispatch 命令 |
| M1 | poll | `CommandPublisher` 輪詢 dispatched → MQTT publish | 每 10s 輪詢 |
| M4 | ← M1 | 讀取 `telemetry_history` | 計費計算 |
| SSE | ← M1 | `pg_notify('telemetry_update')`、`pg_notify('gateway_health')`、`pg_notify('command_status')` | FA flush / set_reply |

---

## 2. MQTT Connection Manager

### 2.1 Startup Flow

```
M1 startMqttSubscriber(pool)
  │
  ├─ SELECT * FROM gateways WHERE status != 'decommissioned'
  │
  ├─ For each gateway:
  │    ├─ mqtt.connect(broker_host:broker_port, {username, password})
  │    ├─ Subscribe to 6 topics (S1–S6)         ← v5.22: +1 data/missed
  │    ├─ Store client handle in gatewayClients Map
  │    └─ Publish subDevices/get (initial device list pull)
  │
  ├─ Start heartbeat watchdog (60s interval)
  │    └─ For each gateway: if NOW() - last_seen_at > 600s → status='offline'
  │                                                 ← v5.22: 90s → 10min
  │
  ├─ Start CommandPublisher (poll every 10s)      ← v5.21
  ├─ Start BackfillRequester (poll every 10s)     ← v5.22
  │
  └─ Start periodic publish timers:
       ├─ subDevices/get — every 1 hour
       └─ config/get     — every 1 hour
```

### 2.2 Per-Gateway Topic Subscriptions

For each gateway with `gateway_id = {cid}`:

| # | Topic Pattern | Handler |
|---|---------------|---------|
| S1 | `device/ems/{cid}/deviceList` | `handleDeviceList()` |
| S2 | `device/ems/{cid}/data` | `handleTelemetry()` |
| S3 | `device/ems/{cid}/config/get_reply` | `handleGetReply()` |
| S4 | `device/ems/{cid}/config/set_reply` | `handleSetReply()` |
| S5 | `device/ems/{cid}/status` | `handleHeartbeat()` |
| S6 | `device/ems/{cid}/data/missed` | `handleMissedData()` ← **v5.22 NEW** |

### 2.3 Per-Gateway Publish Topics

| # | Topic Pattern | Trigger | Purpose |
|---|---------------|---------|---------|
| P1 | `platform/ems/{cid}/config/get` | BFF / 每 1 小時 | 請求目前配置 |
| P2 | `platform/ems/{cid}/config/set` | CommandPublisher poll | 推送新排程（v5.21 pipeline） |
| P3 | `platform/ems/{cid}/subDevices/get` | 首次連線 + 每 1 小時 | 請求設備清單 |
| P4 | `platform/ems/{cid}/data/get_missed` | BackfillRequester poll | 請求歷史遺漏資料 ← **v5.22 NEW** |

### 2.4 Connection Configuration

```
interface GatewayConnection {
  gatewayId: string;           // v5.19: = device serial (e.g. WKRD24070202100144F)
  brokerHost: string;          // 18.141.63.142
  brokerPort: number;          // 1883
  username: string;            // xuheng
  password: string;            // xuheng8888!
  mqttClient: MqttClient;     // runtime handle
}
```

- **Reconnect**: `reconnectPeriod: 5000` (現有模式)
- **QoS**: 1 for all subscriptions
- **Clean session**: true (MVP 無需持久 session)
- **No wildcard**: 每個網關獨立訂閱（共用 broker）

> **v5.19 變更**：移除 `clientId` 欄位，`gatewayId` 即為設備序號，不再是合成 ID。

### 2.5 Dynamic Gateway Addition

MVP 方式：M1 每 60s 輪詢 `gateways` 表找新記錄。若發現新網關（不在 `gatewayClients` Map 中），訂閱其 6 個 topic。

無事件匯流排或訊息佇列 — 3 個網關直接 DB 輪詢已足夠。

---

## 3. Fragmented Payload 處理機制

### 3.1 問題：真實 MQTT 行為

每個網關每 30 秒（生產為 5 分鐘）發送 **5 條獨立 MQTT 消息**，全部走 `device/ems/{gatewayId}/data` topic，在 ~800ms 內連續到達：

| 序號 | 消息內容 | 大小 | 間隔 | 特徵 |
|------|---------|------|------|------|
| MSG#1 | `emsList`（EMS 系統狀態） | 718B | 起點 | 無 batList、無 deviceSn（用 gatewayId） |
| MSG#2 | `dido`（數字 IO） | 630B | +140ms | 無 batList、有 DI/DO 值 |
| MSG#3 | `meterList`（單相電表） | 851B | +132ms | 無 batList、有獨立 deviceSn |
| MSG#4 | `meterList`（三相電表） | 1556B | +150ms | 無 batList、有獨立 deviceSn |
| MSG#5 | `batList+gridList+loadList+flloadList+pvList` | 3278B | +357ms | 有 batList（大包） |

### 3.2 設計方案：Per-Gateway Fragment Assembler

**核心思路**：不再對單條消息獨立處理，改為 **按網關累積所有 fragment，在時間窗口結束後合併寫入**。

```
                    device/ems/{cid}/data
                           │
                    TelemetryHandler.handle()
                           │
                  ┌────────┴────────┐
                  │ Classify by     │
                  │ payload content │
                  └─┬───┬───┬───┬──┘
                    │   │   │   │
              emsList dido meter batList(大包)
                    │   │   │   │
                    ▼   ▼   ▼   ▼
              ┌─────────────────────────┐
              │  FragmentAssembler      │
              │  per-gateway cache      │
              │                         │
              │  key = payload.clientId  │  ← v5.19: clientId = gatewayId
              │  fragments: {           │
              │    ems?: EmsFragment    │
              │    dido?: DidoFragment  │
              │    meters?: MeterFrag[] │
              │    core?: CoreFragment  │  ← MSG#5 (batList 大包)
              │  }                      │
              │  firstArrival: Date     │
              │  flushTimer: Timeout    │
              └────────────┬────────────┘
                           │ flush after 3s debounce
                           ▼
              ┌─────────────────────────┐
              │  Merge & Persist        │
              │                         │
              │  1. gateways.ems_health │ ← emsList
              │  2. telemetry_history   │ ← batList 大包 + dido DO0/DO1
              │     (inverter asset)    │
              │  3. telemetry_extra     │ ← meters + per-phase detail
              │  4. pg_notify           │ ← v5.21: SSE 通知
              └─────────────────────────┘
```

**v5.22 變更**：`parseTelemetryPayload` 從 FragmentAssembler 抽取為獨立共用純函式，BackfillAssembler 亦使用。

**關鍵設計決策**：

| 決策 | 選擇 | 理由 |
|------|------|------|
| Fragment 累積方式 | Per-gateway Map with 3s debounce | 5 條消息在 ~800ms 內到齊，3s 足夠 |
| emsList 存到哪 | `gateways.ems_health` JSONB | 網關自身健康，非設備遙測，不進 telemetry_history |
| dido DO0/DO1 | 合併到 inverter 的 telemetry_history row | DO 是 Peak Shaving 切載信號，屬於調度上下文 |
| dido DI0/DI1 | 合併到 telemetry_extra.dido JSONB | 數字輸入，僅診斷用 |
| meterList（兩個電表） | 合併到 telemetry_extra JSONB，分 key 存 | `meter_single` + `meter_three`，避免額外 table |
| 如果 MSG#5 未到 | 3s 後仍然 flush 已有 fragment（ems_health 照寫，telemetry_history 不寫） | 保證 ems_health 不丟，但不寫不完整的遙測行 |
| pg_notify | flush 完成後觸發 `telemetry_update` + `gateway_health` | v5.21: SSE 即時推送 |

### 3.3 Fragment 分類邏輯

```
// FragmentAssembler.classifyAndAccumulate() — 內聯方法（非獨立函式）
// 處理所有 data 頂層 key（不使用 early-return），支援碎片化和合併負載

private classifyAndAccumulate(acc: Accumulator, data: Record<string, unknown>): boolean {
  let isCoreMessage = false;
  if (data.emsList)   → acc.ems = emsList[0]
  if (data.dido)      → acc.dido = data.dido
  if (data.meterList) → acc.meters = [...acc.meters, ...meterList]   // 追加（可能收到多個）
  if (data.batList)   → acc.core = data; isCoreMessage = true        // 大包
  return isCoreMessage;
}
```

**分類依據**：處理 data 物件中所有存在的頂層 key（非互斥，一條消息可同時包含多個 key）。

### 3.4 Debounce 與 Flush 策略

```
FragmentAssembler.receive(clientId, payload):
  1. Parse recordedAt from payload.timeStamp
  2. 取得或建立 clientId 的 accumulator
  3. classifyAndAccumulate(acc, payload.data) → isCoreMessage
  4. 若 isCoreMessage = true（MSG#5 大包）：
     - 清除 timer，立即 flush（因為 MSG#5 是最後到達的，前 4 條已在 cache）
  5. 否則：重設 3s debounce timer
  6. Timer 到期 → mergeAndPersist(clientId)
```

**選擇「收到 core 立即 flush」**：因為 MSG#5 永遠最後到達（+357ms），前 4 條已在 cache。這樣延遲最低。但仍保留 3s safety timer 以防 MSG#5 丟失。

### 3.5 mergeAndPersist 流程

```
async function mergeAndPersist(clientId, accumulator):
  const { ems, dido, meters, core, recordedAt } = accumulator

  // Step 1: emsList → gateways.ems_health（無論 core 是否存在都寫）
  if (ems) {
    await writeEmsHealth(clientId, ems, recordedAt)
    pg_notify('gateway_health', clientId)               // v5.21
  }

  // Step 2: core（MSG#5 大包）→ telemetry_history + device_state
  if (core) {
    const parsed = parseTelemetryPayload(clientId, recordedAt, core, dido, meters, ems)
    const assetId = await cache.resolve(parsed.deviceSn)
    buffer.enqueue(assetId, parsed)
    await updateDeviceState(assetId, parsed)
    pg_notify('telemetry_update', clientId)             // v5.21
  }

  // Step 3: 如果只有 ems/meters 沒有 core，僅記 log 不寫 telemetry_history
  // （防止不完整數據進入時序表）

  // Step 4: 清除 accumulator
  accumulators.delete(clientId)
```

---

## 4. Topic Handlers (Anti-Corruption Layer)

### 4.1 DeviceListHandler

**Subscribe**: `device/ems/{gatewayId}/deviceList`
**Persistence**: `assets` table UPSERT
**Status**: 自 v5.18 起未變更

```
Function Signature:
  handleDeviceList(pool: Pool, gatewayId: string, _clientId: string, payload: SolfacilMessage): Promise<void>

Input:  payload.data.deviceList[]
Output: assets table rows (INSERT or UPDATE)
```

**Processing Logic:**

1. Parse `payload.data.deviceList[]` — 每個元素是一個主設備（一級）
2. For each device in list:
   - Build `asset_id` from `deviceSn`（確定性、冪等）
   - UPSERT into `assets`:
     - `serial_number` = `deviceSn`
     - `name` = `device.name`
     - `brand` = `device.vendor`
     - `model` = `device.deviceBrand`
     - `asset_type` = map `productType` → enum（`meter` → `SMART_METER`, `inverter` → `INVERTER_BATTERY`）
     - `gateway_id` = FK to gateways table
     - `org_id` = from `gateways.org_id`
     - `is_active` = true
     - `commissioned_at` = NOW()（僅 INSERT，非 UPDATE）
3. **Soft-delete reconciliation**（鐵律）：
   - 查詢所有 `assets WHERE gateway_id = $1 AND is_active = true`
   - 與傳入的 `deviceList[].deviceSn` 比對
   - DB 中有但傳入清單中沒有的 → `UPDATE assets SET is_active = false WHERE serial_number = $sn`
   - **絕對不 DELETE** — 歷史財務紀錄必須保留

> **v5.19 變更**：移除 `home_id` 賦值（homes 表已刪除）。

**Protocol Field → Domain Mapping (deviceList):**

| Protocol Field | DB Column | Notes |
|---------------|-----------|-------|
| `deviceSn` | `assets.serial_number` | 主要查詢 key |
| `name` | `assets.name` | e.g. "GoodWe-1" |
| `vendor` | `assets.brand` | e.g. "GoodWe" |
| `deviceBrand` | `assets.model` | e.g. "inverter-goodwe-Energystore" |
| `productType` | `assets.asset_type` | meter→SMART_METER, inverter→INVERTER_BATTERY |
| `connectStatus` | `assets.is_active` | "online"→true（但 soft-delete 邏輯優先） |
| `bindStatus` | （僅記錄 log） | true/false, informational |
| `protocolAddr` | （存入 telemetry_json 或忽略） | Modbus address |
| `nodeType` | （過濾：僅處理 "major"） | major/minor |
| `subDevId` | （忽略） | 網關自動產生 |
| `fatherSn` | （用於階層關係，不直接儲存） | 父設備 SN |

### 4.2 TelemetryHandler (Fragment-Aware)

**Subscribe**: `device/ems/{gatewayId}/data`
**Persistence**: `telemetry_history`（via MessageBuffer）、`device_state`、`gateways.ems_health`

```
Function Signature:
  handleTelemetry(pool: Pool, _gatewayId: string, _clientId: string, payload: SolfacilMessage): Promise<void>

Input:  payload.data — 可能包含以下任一：
        emsList, dido, meterList, batList+gridList+loadList+flloadList+pvList
Output: 累積的 fragments → 合併的 telemetry_history row + gateways.ems_health
```

**鐵律 — TimeStamp Rule:**
所有 `recorded_at` 值必須從 `payload.timeStamp`（epoch ms 字串）解析。伺服器端 `NOW()` **禁止**用於遙測寫入。這確保回填冪等性和 M4 計費視窗準確性。

```
const recordedAt = new Date(parseInt(payload.timeStamp, 10));
```

**Processing Logic:**

1. Parse `payload.timeStamp` → `recordedAt`
2. **Classify** 消息（依頂層 `data` keys，見 §3.3）
3. **Feed** 分類後的 fragment 到此 `gatewayId` 的 `FragmentAssembler`
4. FragmentAssembler 處理合併 + debounce + flush（見 §3.4–3.5）

**所有消息類型都被接收和累積** — 無 `if (!bat) return;` 早期返回。

#### 4.2.1 emsList 處理 — EMS 系統健康（MSG#1）

**協議欄位 → 儲存位置**：`gateways.ems_health` JSONB

emsList 消息的 `data` 結構（實測）：
```json
{
  "emsList": [{
    "properties": {
      "CPU_temp": "45",
      "CPU_usage": "23",
      "disk_usage": "31",
      "memory_usage": "52",
      "ems_temp": "38",
      "humidity": "65",
      "SIM_status": "1",
      "phone_status": "1",
      "phone_signal_strength": "75",
      "wifi_status": "0",
      "wifi_signal_strength": "0",
      "hardware_time": "1772681002",
      "system_time": "1772681002",
      "system_runtime": "86400"
    },
    "deviceSn": "WKRD24070202100141I",
    ...
  }]
}
```

**emsList 數據字典映射表**：

| 協議欄位 (`properties.*`) | JSONB key (`gateways.ems_health.*`) | 類型 | 單位 | 說明 |
|---|---|---|---|---|
| `CPU_temp` | `cpu_temp` | number | ℃ | CPU 溫度 |
| `CPU_usage` | `cpu_usage` | number | % | CPU 使用率 |
| `disk_usage` | `disk_usage` | number | % | 磁碟使用率 |
| `memory_usage` | `memory_usage` | number | % | 記憶體使用率 |
| `ems_temp` | `ems_temp` | number | ℃ | EMS 設備溫度 |
| `humidity` | `humidity` | number | % | 環境濕度 |
| `SIM_status` | `sim_status` | number | - | SIM 卡狀態（1=正常, 0=異常） |
| `phone_status` | `phone_status` | number | - | 4G 模組狀態 |
| `phone_signal_strength` | `phone_signal_strength` | number | % | 4G 訊號強度 |
| `wifi_status` | `wifi_status` | number | - | WiFi 狀態（1=已連接, 0=未連接） |
| `wifi_signal_strength` | `wifi_signal_strength` | number | % | WiFi 訊號強度 |
| `hardware_time` | `hardware_time` | number | epoch s | 硬體 RTC 時間 |
| `system_time` | `system_time` | number | epoch s | 系統時間 |
| `system_runtime` | `system_runtime` | number | s | 系統運行時長 |

**SQL 持久化**：
```sql
UPDATE gateways
SET ems_health = $1::jsonb,
    ems_health_at = $2,           -- Date object from recordedAt
    updated_at = NOW()
WHERE gateway_id = $3
```

> **v5.19 變更**：WHERE 條件從 `client_id = $3` 改為 `gateway_id = $3`。

**設計理由**：emsList 是網關自身的系統監控指標（CPU、記憶體、網路），不是逆變器/電表的能源遙測。放在 `gateways` 表而非 `telemetry_history` 因為：
- 語義正確：這是網關健康，不是設備遙測
- 只需最新值：不需要時序歷史
- 查詢路徑獨立：運維看網關健康 vs 業務看能源遙測

#### 4.2.2 dido 處理 — 數字 IO（MSG#2）

**協議欄位 → 儲存位置**：DO0/DO1 → `telemetry_history.do0_active / do1_active`，DI0/DI1 → `telemetry_extra.dido`

dido 消息的 `data` 結構（實測）：
```json
{
  "dido": {
    "do": [
      { "id": "DO0", "type": "relay", "value": "1", "gpionum": "0" },
      { "id": "DO1", "type": "relay", "value": "0", "gpionum": "1" }
    ],
    "di": [
      { "id": "DI0", "type": "input", "value": "0", "gpionum": "0" },
      { "id": "DI1", "type": "input", "value": "0", "gpionum": "1" }
    ]
  }
}
```

**dido 數據字典映射表**：

| 協議欄位 (`data.dido.*`) | 儲存位置 | DB 欄位 / JSONB key | 類型 | 說明 |
|---|---|---|---|---|
| `DO0` | `telemetry_history` 實體欄位 | `do0_active` | boolean | Peak Shaving 切載信號 #0（"1"→true, "0"→false） |
| `DO1` | `telemetry_history` 實體欄位 | `do1_active` | boolean | Peak Shaving 切載信號 #1（"1"→true, "0"→false） |
| `DI0` | `telemetry_extra` JSONB | `telemetry_extra.dido.di0` | number | 數字輸入 #0（診斷用） |
| `DI1` | `telemetry_extra` JSONB | `telemetry_extra.dido.di1` | number | 數字輸入 #1（診斷用） |

**合併策略**：dido 消息沒有 `batList`，無法獨立寫入 `telemetry_history`。Fragment Assembler 將 DO0/DO1 值暫存，等 MSG#5 到達後合併到 `ParsedTelemetry.do0Active / do1Active`。

**轉換規則**：`"1"` → `true`, `"0"` → `false`（字串轉布林）

#### 4.2.3 meterList 處理 — 獨立電表（MSG#3 + MSG#4）

**兩個獨立設備**：
- MSG#3：`Meter-Chint-DTSU666Single`（單相，7 props）
- MSG#4：`Meter-Chint-DTSU666Three`（三相，32 props）

**設計決策 — Meter 數據不寫獨立 telemetry_history 行**：合併到 inverter 的 telemetry_extra JSONB（零 schema 變更、單行包含完整週期快照）。

**telemetry_extra 中的 Meter 存儲結構**：

```json
{
  "meter_single": {
    "device_sn": "Meter-Chint-DTSU666Single1772421080_WKRD24070202100141I",
    "connect_status": "online",
    "volt_a": 230,
    "current_a": 10,
    "active_power_a": 2300,
    "reactive_power_a": 20,
    "factor_a": 0.99,
    "frequency": 60
  },
  "meter_three": {
    "device_sn": "Meter-Chint-DTSU666Three1772421079_WKRD24070202100141I",
    "connect_status": "online",
    "volt_a": 230, "volt_b": 230, "volt_c": 230,
    "line_ab_volt": 398, "line_bc_volt": 398, "line_ca_volt": 398,
    "current_a": 10, "current_b": 10, "current_c": 10,
    "total_active_power": 6900,
    "active_power_a": 2300, "active_power_b": 2300, "active_power_c": 2300,
    "total_reactive_power": 60,
    "reactive_power_a": 20, "reactive_power_b": 20, "reactive_power_c": 20,
    "factor": 0.99, "factor_a": 0.99, "factor_b": 0.99, "factor_c": 0.99,
    "frequency": 60,
    "positive_energy": 1234,
    "positive_energy_a": 411, "positive_energy_b": 412, "positive_energy_c": 411,
    "net_forward_energy": 1200,
    "negative_energy_a": 10, "negative_energy_b": 10, "negative_energy_c": 10,
    "net_reverse_energy": 30
  },
  "dido": {
    "di0": 0, "di1": 0
  },
  "grid": { ... },
  "load": { ... },
  "flload": { ... },
  "pv": { ... }
}
```

**Meter 分類邏輯**：
```
if (meterItem.deviceBrand.includes('Single')) → key = 'meter_single'
if (meterItem.deviceBrand.includes('Three'))  → key = 'meter_three'
```

**單相電表完整映射（`meter_single`）**：

| 協議欄位 (`properties.*`) | JSONB key (`telemetry_extra.meter_single.*`) | 類型 | 單位 |
|---|---|---|---|
| `connectStatus` | `connect_status` | string | - |
| `grid_voltA` | `volt_a` | number | V |
| `grid_currentA` | `current_a` | number | A |
| `grid_activePowerA` | `active_power_a` | number | W |
| `grid_reactivePowerA` | `reactive_power_a` | number | Var |
| `grid_factorA` | `factor_a` | number | - |
| `grid_frequency` | `frequency` | number | Hz |

**三相電表完整映射（`meter_three`）**：

| 協議欄位 (`properties.*`) | JSONB key (`telemetry_extra.meter_three.*`) | 類型 | 單位 |
|---|---|---|---|
| `connectStatus` | `connect_status` | string | - |
| `grid_voltA` | `volt_a` | number | V |
| `grid_voltB` | `volt_b` | number | V |
| `grid_voltC` | `volt_c` | number | V |
| `grid_lineABVolt` | `line_ab_volt` | number | V |
| `grid_lineBCVolt` | `line_bc_volt` | number | V |
| `grid_lineCAVolt` | `line_ca_volt` | number | V |
| `grid_currentA` | `current_a` | number | A |
| `grid_currentB` | `current_b` | number | A |
| `grid_currentC` | `current_c` | number | A |
| `grid_totalActivePower` | `total_active_power` | number | W |
| `grid_activePowerA` | `active_power_a` | number | W |
| `grid_activePowerB` | `active_power_b` | number | W |
| `grid_activePowerC` | `active_power_c` | number | W |
| `grid_totalReactivePower` | `total_reactive_power` | number | Var |
| `grid_reactivePowerA` | `reactive_power_a` | number | Var |
| `grid_reactivePowerB` | `reactive_power_b` | number | Var |
| `grid_reactivePowerC` | `reactive_power_c` | number | Var |
| `grid_factor` | `factor` | number | - |
| `grid_factorA` | `factor_a` | number | - |
| `grid_factorB` | `factor_b` | number | - |
| `grid_factorC` | `factor_c` | number | - |
| `grid_frequency` | `frequency` | number | Hz |
| `grid_positiveEnergy` | `positive_energy` | number | kWh |
| `grid_positiveEnergyA` | `positive_energy_a` | number | kWh |
| `grid_positiveEnergyB` | `positive_energy_b` | number | kWh |
| `grid_positiveEnergyC` | `positive_energy_c` | number | kWh |
| `grid_netForwardActiveEnergy` | `net_forward_energy` | number | kWh |
| `grid_negativeEnergyA` | `negative_energy_a` | number | kWh |
| `grid_negativeEnergyB` | `negative_energy_b` | number | kWh |
| `grid_negativeEnergyC` | `negative_energy_c` | number | kWh |
| `grid_netReverseActiveEnergy` | `net_reverse_energy` | number | kWh |

#### 4.2.4 Complete Field Mappings — MSG#5 大包（batList+gridList+loadList+flloadList+pvList）

此部分邏輯已正確運行，無需修改。以下為完整對照表。

**batList (Battery) — 13 fields → telemetry_history 實體欄位：**

| Protocol Field (`properties.*`) | ParsedTelemetry Field | DB Column (`telemetry_history`) | Unit | Notes |
|------|------|------|------|------|
| `total_bat_soc` | `batterySoc` | `battery_soc` | % | |
| `total_bat_soh` | `batterySoh` | `battery_soh` | % | BMS direct |
| `total_bat_power` | `batteryPowerKw` | `battery_power` | kW | discharge=positive, charge=negative |
| `total_bat_current` | `batteryCurrent` | `battery_current` | A | positive=discharge, negative=charge |
| `total_bat_vlotage` | `batteryVoltage` | `battery_voltage` | V | **Typo in protocol: vlotage** |
| `total_bat_temperature` | `batteryTemperature` | `battery_temperature` | ℃ | |
| `total_bat_maxChargeVoltage` | `maxChargeVoltage` | (parsed, not persisted) | V | BMS limit |
| `total_bat_maxChargeCurrent` | `maxChargeCurrent` | `max_charge_current` | A | BMS limit |
| `total_bat_maxDischargeCurrent` | `maxDischargeCurrent` | `max_discharge_current` | A | BMS limit |
| `total_bat_dailyChargedEnergy` | `dailyChargeKwh` | `daily_charge_kwh` | kWh | |
| `total_bat_dailyDischargedEnergy` | `dailyDischargeKwh` | `daily_discharge_kwh` | kWh | |
| `total_bat_totalChargedEnergy` | `totalChargeKwh` | (parsed, not persisted) | kWh | Lifetime |
| `total_bat_totalDischargedEnergy` | `totalDischargeKwh` | (parsed, not persisted) | kWh | Lifetime |

**gridList (Inverter Grid-Side) — 27 fields：**

| Protocol Field | DB Location | Type | Notes |
|------|------|------|------|
| `grid_totalActivePower` | `telemetry_history.grid_power_kw` | 實體欄位 | Hot-path: M2/M3 查詢 |
| `grid_dailyBuyEnergy` | `telemetry_history.grid_import_kwh` | 實體欄位 | Hot-path: M4 計費 |
| `grid_dailySellEnergy` | `telemetry_history.grid_export_kwh` | 實體欄位 | Hot-path: M4 計費 |
| `grid_temp` | `telemetry_history.inverter_temp` | 實體欄位 | Health monitoring |
| `grid_voltA/B/C` | `telemetry_extra.grid.volt_a/b/c` | JSONB | 診斷用 |
| `grid_currentA/B/C` | `telemetry_extra.grid.current_a/b/c` | JSONB | 診斷用 |
| `grid_activePowerA/B/C` | `telemetry_extra.grid.active_power_a/b/c` | JSONB | 診斷用 |
| `grid_reactivePowerA/B/C` | `telemetry_extra.grid.reactive_power_a/b/c` | JSONB | 診斷用 |
| `grid_totalReactivePower` | `telemetry_extra.grid.total_reactive_power` | JSONB | 診斷用 |
| `grid_apparentPowerA/B/C` | `telemetry_extra.grid.apparent_power_a/b/c` | JSONB | 診斷用 |
| `grid_totalApparentPower` | `telemetry_extra.grid.total_apparent_power` | JSONB | 診斷用 |
| `grid_factorA/B/C` | `telemetry_extra.grid.factor_a/b/c` | JSONB | 診斷用 |
| `grid_frequency` | `telemetry_extra.grid.frequency` | JSONB | 診斷用 |
| `grid_totalBuyEnergy` | `telemetry_extra.grid.total_buy_kwh` | JSONB | 累計值 |
| `grid_totalSellEnergy` | `telemetry_extra.grid.total_sell_kwh` | JSONB | 累計值 |

**pvList (Solar PV) — 9 fields：**

| Protocol Field | DB Location | Type |
|------|------|------|
| `pv_totalPower` | `telemetry_history.pv_power` | 實體欄位 |
| `pv_dailyEnergy` | `telemetry_history.pv_daily_energy_kwh` | 實體欄位 |
| `pv_totalEnergy` | `ParsedTelemetry.pvTotalEnergyKwh` | 解析但未持久化 |
| `pv1_voltage/current/power` | `telemetry_extra.pv.pv1_*` | JSONB |
| `pv2_voltage/current/power` | `telemetry_extra.pv.pv2_*` | JSONB |

**loadList (Backup Load) — 13 fields：**

| Protocol Field | DB Location | Type |
|------|------|------|
| `load1_totalPower` | `telemetry_history.load_power` | 實體欄位 |
| `load1_voltA/B/C` | `telemetry_extra.load.volt_a/b/c` | JSONB |
| `load1_currentA/B/C` | `telemetry_extra.load.current_a/b/c` | JSONB |
| `load1_activePowerA/B/C` | `telemetry_extra.load.active_power_a/b/c` | JSONB |
| `load1_frequencyA/B/C` | `telemetry_extra.load.frequency_a/b/c` | JSONB |

**flloadList (Home Total Load) — 5 fields：**

| Protocol Field | DB Location | Type |
|------|------|------|
| `flload_totalPower` | `telemetry_history.flload_power` | 實體欄位 |
| `flload_dailyEnergy` | `telemetry_extra.flload.daily_energy_kwh` | JSONB |
| `flload_activePowerA/B/C` | `telemetry_extra.flload.active_power_a/b/c` | JSONB |

### 4.3 ScheduleTranslator (Bidirectional)

**Status**: 自 v5.18 起未變更

```
Function Signatures:

  // Read direction: protocol → domain model
  parseGetReply(batterySchedule: ProtocolSchedule | null | undefined): DomainSchedule | null

  // Write direction: domain model → protocol message
  buildConfigSetPayload(clientId: string, schedule: DomainSchedule, messageId?: string): Record<string, unknown>

  // Validate before publish (hard crash — throws ScheduleValidationError)
  validateSchedule(schedule: DomainSchedule): void
```

#### 4.3.1 Read Direction (get_reply → Domain Model)

| Protocol (`battery_schedule`) | Domain Model | Translation Rule |
|------|------|------|
| `soc_min_limit` (string) | `socMinLimit` (number) | `parseInt()` |
| `soc_max_limit` (string) | `socMaxLimit` (number) | `parseInt()` |
| `max_charge_current` (string) | `maxChargeCurrent` (number) | `parseInt()` |
| `max_discharge_current` (string) | `maxDischargeCurrent` (number) | `parseInt()` |
| `grid_import_limit` (string) | `gridImportLimitKw` (number) | `parseInt()` |
| `slots[]` | `slots[]` | Per-slot translation below |

**Per-Slot Translation:**

| Protocol Slot | Domain Slot | Translation |
|------|------|------|
| `purpose:"tariff"` + `direction:"charge"` | `mode: "peak_valley_arbitrage"`, `action: "charge"` | Valley charge window |
| `purpose:"tariff"` + `direction:"discharge"` | `mode: "peak_valley_arbitrage"`, `action: "discharge"` | Peak discharge window |
| `purpose:"tariff"` + `direction:"discharge"` + `export_policy:"allow"` | `mode: "peak_valley_arbitrage"`, `action: "discharge"`, `allowExport: true` | VPP export allowed |
| `purpose:"tariff"` + `direction:"discharge"` + `export_policy:"forbid"` | `mode: "peak_valley_arbitrage"`, `action: "discharge"`, `allowExport: false` | Self-use only |
| `purpose:"self_consumption"` | `mode: "self_consumption"` | Self-consumption |
| `purpose:"peak_shaving"` | `mode: "peak_shaving"` | Peak shaving |
| `start` (string) | `startMinute` (number) | `parseInt()`，從 00:00 起算的分鐘數 |
| `end` (string) | `endMinute` (number) | `parseInt()`，從 00:00 起算的分鐘數 |

#### 4.3.2 Write Direction (Domain Model → config/set)

Read direction 的反向。所有數值轉為字串。輸出消息結構：

```
{
  DS: 0,
  ackFlag: 0,
  data: {
    configname: "battery_schedule",
    battery_schedule: {
      soc_min_limit: String(schedule.socMinLimit),
      soc_max_limit: String(schedule.socMaxLimit),
      max_charge_current: String(schedule.maxChargeCurrent),
      max_discharge_current: String(schedule.maxDischargeCurrent),
      grid_import_limit: String(schedule.gridImportLimitKw),
      slots: schedule.slots.map(s => translateSlotToProtocol(s))
    }
  },
  clientId: gatewayId,
  deviceName: "EMS_N2",
  productKey: "ems",
  messageId: String(Date.now()),
  timeStamp: String(Date.now())
}
```

#### 4.3.3 Validation Rules (Hard Crash — No Publish on Failure)

| Rule | Constraint | Action on Failure |
|------|------|------|
| `soc_min_limit` | 0 ≤ val ≤ 100, val < `soc_max_limit` | Throw `ScheduleValidationError` |
| `soc_max_limit` | 0 ≤ val ≤ 100, val > `soc_min_limit` | Throw |
| `max_charge_current` | Integer, ≥ 0 | Throw |
| `max_discharge_current` | Integer, ≥ 0 | Throw |
| `grid_import_limit` | Integer, ≥ 0 | Throw |
| `slot.start` | 0–1380, multiple of 60 | Throw |
| `slot.end` | 60–1440, multiple of 60, > start | Throw |
| Slot coverage | Union of all slots must equal [0, 1440) | Throw |
| Slot overlap | No two slots may cover the same minute | Throw |

> **Note**: 目前實作僅驗證 `max_charge_current` 和 `max_discharge_current` 為非負整數，尚未實作 BMS 上限校驗（從 DB 讀取 `total_bat_maxChargeCurrent`）。

### 4.4 HeartbeatHandler (v5.22: Reconnect Detection + Backfill Queue)

**Subscribe**: `device/ems/{gatewayId}/status`
**Persistence**: `gateways.last_seen_at`、`gateways.status`、`backfill_requests`（v5.22）

```
Function Signature:
  handleHeartbeat(pool: Pool, gatewayId: string, _clientId: string, payload: SolfacilMessage): Promise<void>

Logic (v5.22):
  // Step 1: Atomic CTE — 讀取舊狀態 + 更新 last_seen_at/status
  WITH prev AS (
    SELECT last_seen_at, status FROM gateways WHERE gateway_id = $2
  )
  UPDATE gateways
  SET last_seen_at = to_timestamp($1::bigint / 1000.0),
      status = 'online',
      updated_at = NOW()
  WHERE gateway_id = $2
  RETURNING
    (SELECT last_seen_at FROM prev) AS prev_last_seen,
    (SELECT status FROM prev) AS prev_status

  // Step 2: 重連偵測（status 從 non-online → online 且 gap > 2 分鐘）
  if (prev_last_seen && prev_status !== 'online') {
    const gapMs = newTime - prevTime
    if (gapMs > 120_000) {  // RECONNECT_THRESHOLD_MS = 2 minutes
      INSERT INTO backfill_requests (gateway_id, gap_start, gap_end)
      VALUES ($1, prev_last_seen, to_timestamp($2::bigint / 1000.0))
    }
  }

  // Step 3: pg_notify('gateway_health', gatewayId)
```

**v5.22 變更重點**：
- 二步驟偵測重連間隙：CTE 更新 + 條件判斷（status 需從 non-online 切換到 online 且間隙 >2 分鐘）→ INSERT `backfill_requests`
- 心跳間隔：~90s（依協議）
- Watchdog 離線閾值：90s → **10 分鐘**（`OFFLINE_THRESHOLD_MS = 600_000`）

### 4.5 CommandTracker (v5.22: Two-Phase set_reply)

**Subscribe**: `device/ems/{gatewayId}/config/get_reply` + `device/ems/{gatewayId}/config/set_reply`
**Persistence**: `device_command_logs` table

```
Function Signatures:
  handleGetReply(pool: Pool, gatewayId: string, _clientId: string, payload: SolfacilMessage): Promise<void>
  handleSetReply(pool: Pool, gatewayId: string, _clientId: string, payload: SolfacilMessage): Promise<void>
```

**get_reply handling**（未變更）：
1. Extract `configName` from `payload.data.configname` (default: `"battery_schedule"`)
2. Extract `batterySchedule` from `payload.data.battery_schedule` (raw JSON, stored as-is)
3. Parse `deviceTimestamp` from `payload.timeStamp`
4. Insert into `device_command_logs`:
   - `command_type = 'get_reply'`
   - `config_name = configName`
   - `message_id = payload.messageId`
   - `payload_json = JSON.stringify(batterySchedule)` (raw JSON, **not** parsed via ScheduleTranslator)
   - `result = 'success'`
   - `device_timestamp` = parsed from `payload.timeStamp`
5. Update `gateways.updated_at` if batterySchedule is present

**set_reply handling（v5.22 二階段閉環鐵律）**：

```
handleSetReply(pool, gatewayId, payload):
  const result = payload.data.result   // "accepted" | "success" | "fail"
  const message = payload.data.message

  if (result === "accepted") {
    // Phase 1: 網關已接收命令，尚未執行完成
    // 注意：device_timestamp 使用 NOW() 而非設備時間戳（用於 20s 逾時計算）
    UPDATE device_command_logs
    SET result = 'accepted',
        device_timestamp = NOW()
    WHERE gateway_id = $gatewayId
      AND config_name = $configname
      AND command_type = 'set'
      AND result = 'dispatched'
    ORDER BY created_at DESC LIMIT 1

  } else if (result === "success" || result === "fail") {
    // Phase 2: 最終結果（匹配 dispatched 或 accepted）
    UPDATE device_command_logs
    SET result = $result,
        error_message = $message,
        resolved_at = NOW(),
        device_timestamp = $deviceTimestamp    -- parsed from payload.timeStamp
    WHERE gateway_id = $gatewayId
      AND config_name = $configname
      AND command_type = 'set'
      AND result IN ('dispatched', 'accepted')
    ORDER BY created_at DESC LIMIT 1
  }

  // 若找到匹配命令 → 觸發 SSE 通知
  if (updateResult.rowCount > 0) {
    pg_notify('command_status', { gatewayId, configName, result })
  } else {
    // 無匹配命令 → INSERT 獨立 set_reply 記錄（審計用）
    INSERT INTO device_command_logs (gateway_id, command_type, config_name,
      message_id, result, error_message, device_timestamp, resolved_at)
    VALUES ($gatewayId, 'set_reply', $configname,
      payload.messageId, $result, $message, $deviceTimestamp, NOW())
  }
```

**二階段狀態流轉**：
```
pending → dispatched → accepted → success
                    ↘            ↗
                      → fail
```

**Dispatch guard（BFF 端）**：若存在 `result IN ('pending', 'dispatched', 'accepted')` 的命令，BFF 返回 HTTP 409 Conflict，防止重複下發。

**Accepted 逾時**：20 秒內未收到 success/fail → 可由定期任務標記為 timeout。

### 4.6 MissedDataHandler (v5.22 NEW — Backfill Data Path)

**Subscribe**: `device/ems/{gatewayId}/data/missed`
**Source file**: `missed-data-handler.ts`
**Persistence**: `telemetry_history`（via BackfillAssembler）

```
Function Signature:
  handleMissedData(pool: Pool, gatewayId: string, clientId: string, payload: SolfacilMessage): Promise<void>

Input:  payload.data — 歷史遙測資料（與 live data 格式相同）
Output: telemetry_history rows（dedup INSERT）
```

**Processing Logic:**

1. Parse `payload.timeStamp` → `recordedAt`（歷史時間戳）
2. Classify 消息（與 live path 相同分類邏輯）
3. Feed 到 `BackfillAssembler`（非 FragmentAssembler）
4. BackfillAssembler 合併 + flush

**BackfillAssembler vs FragmentAssembler 差異**：

| 行為 | FragmentAssembler (live) | BackfillAssembler (backfill) |
|------|------------------------|----------------------------|
| Debounce | 3s | 3s |
| `pg_notify` | 觸發 `telemetry_update` + `gateway_health` | **不觸發**（避免歷史資料 SSE 風暴） |
| `updateDeviceState` | 更新 device_state | **不執行**（歷史資料 ≠ 當前狀態） |
| emsList processing | 更新 `gateways.ems_health` | **不處理**（backfill 不發送 emsList） |
| INSERT 策略 | 一般 INSERT | `INSERT ON CONFLICT (asset_id, recorded_at) DO NOTHING`（dedup） |
| 解析函式 | `parseTelemetryPayload`（共用） | `parseTelemetryPayload`（共用） |

---

## 5. Publish Functions

### 5.1 publishConfigGet

**Topic**: `platform/ems/{gatewayId}/config/get`
**Caller**: BFF（使用者開啟排程編輯器）+ 每 1 小時自動輪詢

```
Function Signature:
  publishConfigGet(pool: Pool, gatewayId: string, publish: MqttPublishFn): Promise<string>
    // Returns: messageId for tracking

Logic:
  1. Generate messageId = String(Date.now())
  2. Build message: { DS:0, ackFlag:0, data:{configname:"battery_schedule"},
     clientId:gatewayId, deviceName:"EMS_N2", productKey:"ems",
     messageId, timeStamp:String(Date.now()) }
  3. INSERT into device_command_logs: command_type='get',
     config_name='battery_schedule', result='pending'
  4. Publish to MQTT topic
  5. Return messageId
```

### 5.2 publishConfigSet (v5.21: via CommandPublisher Pipeline)

**Topic**: `platform/ems/{gatewayId}/config/set`
**Caller**: `CommandPublisher` 服務（輪詢 `device_command_logs` 中 result='dispatched' 的 set 命令）

> **v5.21 變更**：BFF/M3 不再直接 MQTT publish。改為寫入 `device_command_logs` result='pending'，由 BFF 端設為 'dispatched'，`CommandPublisher` 輪詢 dispatched 命令並 publish MQTT。

```
// BFF/M3 寫入端：
INSERT INTO device_command_logs (
  gateway_id, command_type, config_name, payload_json, result
) VALUES ($1, 'set', 'battery_schedule', $2::jsonb, 'pending')

// CommandPublisher 輪詢端：
SELECT id, gateway_id, command_type, config_name, payload_json
FROM device_command_logs
WHERE command_type = 'set' AND result = 'dispatched'
ORDER BY created_at ASC LIMIT 10
FOR UPDATE SKIP LOCKED

// 對每筆 dispatched 記錄：
1. Check gateway online via connectionManager.isGatewayConnected()
2. validateSchedule(record.payload_json)
3. Build protocol message via buildConfigSetPayload()
4. Publish to MQTT via connectionManager.publishToGateway()
5. UPDATE device_command_logs SET message_id = $messageId WHERE id = $1
```

### 5.3 publishSubDevicesGet

**Topic**: `platform/ems/{gatewayId}/subDevices/get`
**Caller**: GatewayConnectionManager（首次連線 + 每 1 小時）

```
Function Signature:
  publishSubDevicesGet(gatewayId: string, publish: MqttPublishFn): void

Logic:
  1. Build message: {
       DS: 0,
       ackFlag: 0,
       clientId: gatewayId,
       deviceName: "EMS_N2",
       productKey: "ems",
       messageId: String(Date.now()),
       timeStamp: String(Date.now()),
       data: { reason: "periodic_query" }
     }
  2. Publish to `platform/ems/${gatewayId}/subDevices/get`
  3. Log info（不寫 device_command_logs，因為回應走現有 deviceList handler）
```

**回應處理**：網關收到 `subDevices/get` 後，透過原有 `device/ems/{gatewayId}/deviceList` topic 回覆。已被 DeviceListHandler（S1）處理，無需額外 handler。

**輪詢策略**：

| Publish | 首次觸發 | 定期間隔 | 備註 |
|---------|---------|---------|------|
| `subDevices/get` | Gateway 連線成功後立即 | 每 1 小時 | 保持設備清單同步 |
| `config/get` | 不自動觸發（前端打開時觸發） | 每 1 小時 | 保持排程配置同步 |
| `config/set` | 不自動觸發 | 不輪詢 | 由 CommandPublisher pipeline 處理 |

### 5.4 publishGetMissed (v5.22 NEW — Backfill Request)

**Topic**: `platform/ems/{gatewayId}/data/get_missed`
**Caller**: `BackfillRequester` 服務（輪詢 `backfill_requests` 表）

```
Function Signature:
  publishGetMissed(gatewayId: string, chunkStart: Date, chunkEnd: Date,
                   publish: MqttPublishFn): void

Logic:
  1. Build message: {
       DS: 0,
       ackFlag: 0,
       clientId: gatewayId,
       deviceName: "EMS_N2",
       productKey: "ems",
       messageId: String(Date.now()),
       timeStamp: String(Date.now()),
       data: {
         start: String(chunkStart.getTime()),
         end: String(chunkEnd.getTime())
       }
     }
  2. Publish to `platform/ems/${gatewayId}/data/get_missed`
  3. UPDATE backfill_requests SET
       current_chunk_start = chunkStart,
       last_chunk_sent_at = NOW()
     WHERE id = $1
```

---

## 6. Services

### 6.1 CommandPublisher (v5.21 NEW)

**Source file**: `command-publisher.ts`
**Purpose**: 輪詢 `device_command_logs` 中 `result='dispatched'` 的 set 命令，publish 至 MQTT

```
CommandPublisher.start(pool, connectionManager):
  setInterval(async () => {
    const rows = await pool.query(`
      SELECT id, gateway_id, command_type, config_name, payload_json
      FROM device_command_logs
      WHERE command_type = 'set' AND result = 'dispatched'
      ORDER BY created_at ASC LIMIT 10
      FOR UPDATE SKIP LOCKED
    `)
    for (const cmd of rows) {
      // 1. Check gateway online
      if (!connectionManager.isGatewayConnected(cmd.gateway_id)) {
        UPDATE SET result = 'failed', error_message = 'gateway_offline'
        continue
      }
      // 2. Validate schedule
      validateSchedule(cmd.payload_json)
      // 3. Build protocol message
      const msg = buildConfigSetPayload(cmd.gateway_id, cmd.payload_json, messageId)
      // 4. Publish via connectionManager.publishToGateway()
      connectionManager.publishToGateway(cmd.gateway_id, topic, JSON.stringify(msg))
      // 5. Update message_id for audit trail
      UPDATE device_command_logs SET message_id = $messageId WHERE id = $1
    }
  }, 10_000)  // poll every 10s
```

### 6.2 BackfillRequester (v5.22 NEW)

**Source file**: `backfill-requester.ts`
**Purpose**: 輪詢 `backfill_requests` 表，分塊發送 `get_missed` 請求至網關

```
Constants:
  POLL_INTERVAL_MS   = 10_000   // 10 秒輪詢
  DELAY_AFTER_RECONNECT = 30_000 // 重連後 30 秒延遲（讓網關穩定）
  COOLDOWN_MS        = 20_000   // chunk 間冷卻 20 秒
  CHUNK_DURATION_MS  = 30 * 60 * 1000  // 每 chunk 30 分鐘

BackfillRequester.start(pool, gatewayClients):
  setInterval(async () => {
    const active = await pool.query(`
      SELECT * FROM backfill_requests
      WHERE status IN ('pending', 'in_progress')
        AND (last_chunk_sent_at IS NULL
             OR NOW() - last_chunk_sent_at > interval '${COOLDOWN_MS}ms')
      ORDER BY created_at ASC LIMIT 5
    `)
    for (const req of active.rows) {
      // 延遲檢查：重連後至少等 30 秒
      if (req.status === 'pending') {
        const gw = await getGateway(pool, req.gateway_id)
        if (NOW() - gw.last_seen_at < DELAY_AFTER_RECONNECT) continue
      }

      const chunkStart = req.current_chunk_start || req.gap_start
      const chunkEnd = min(chunkStart + CHUNK_DURATION_MS, req.gap_end)

      publishGetMissed(req.gateway_id, chunkStart, chunkEnd, gc.mqttClient.publish)

      if (chunkEnd >= req.gap_end) {
        // 最後一個 chunk → 標記完成
        UPDATE backfill_requests SET status = 'completed' WHERE id = req.id
      } else {
        UPDATE backfill_requests SET
          status = 'in_progress',
          current_chunk_start = chunkEnd,
          last_chunk_sent_at = NOW()
        WHERE id = req.id
      }
    }
  }, POLL_INTERVAL_MS)
```

### 6.3 FragmentAssembler (v5.22: parseTelemetryPayload Extracted)

**Source file**: `fragment-assembler.ts`

**v5.22 變更**：`parseTelemetryPayload` 從 FragmentAssembler 內的私有方法抽取為同檔案匯出的共用純函式（`services/fragment-assembler.ts`），供 `BackfillAssembler`（`missed-data-handler.ts`）`import` 共用。

```
// 共用純函式（v5.22 抽取，位於 services/fragment-assembler.ts）
export function parseTelemetryPayload(
  clientId: string,
  recordedAt: Date,
  data: Record<string, unknown>,
  dido?: DidoSnapshot,
  meters?: SolfacilListItem[],
  ems?: SolfacilListItem
): ParsedTelemetry | null

// FragmentAssembler（即時路徑）— 使用 parseTelemetryPayload
// BackfillAssembler（回填路徑）— 使用相同的 parseTelemetryPayload
```

### 6.4 GatewayConnectionManager (v5.22: +1 Topic + Watchdog 10min)

**Source file**: `gateway-connection-manager.ts`

**v5.22 變更**：
1. 每個網關訂閱 **6 個 topic**（新增 `device/ems/{cid}/data/missed`）
2. Watchdog 離線閾值從 90s 改為 **10 分鐘**（`OFFLINE_THRESHOLD_MS = 600_000`）

```
// v5.22 topic 訂閱
const topics = [
  `device/ems/${gatewayId}/deviceList`,
  `device/ems/${gatewayId}/data`,
  `device/ems/${gatewayId}/config/get_reply`,
  `device/ems/${gatewayId}/config/set_reply`,
  `device/ems/${gatewayId}/status`,
  `device/ems/${gatewayId}/data/missed`,          // v5.22 NEW
]

// v5.22 watchdog
const OFFLINE_THRESHOLD_MS = 600_000  // 10 minutes (was 90s)
```

### 6.5 Unchanged Services

| Component | Status | Notes |
|-----------|--------|-------|
| `device-asset-cache.ts` | 未變更 | 仍負責 serial_number → asset_id 解析 |
| `message-buffer.ts` | 未變更 | INSERT 欄位自 v5.18 PR 後已正確 |
| `telemetry-aggregator.ts` | 未變更 | 使用現有 hot-path 欄位 |
| `telemetry-5min-aggregator.ts` | 未變更 | 使用現有 hot-path 欄位 |

---

## 7. Parsers

所有解析器自 v5.18 起未變更：

| Parser | Purpose | Notes |
|--------|---------|-------|
| `AdapterRegistry.ts` | ACL 適配器註冊 | `resolveAdapter()` 依序嘗試 HuaweiAdapter → NativeAdapter |
| `TelemetryAdapter.ts` | ACL 契約接口 | `canHandle()` + `normalize()` |
| `StandardTelemetry.ts` | 標準遙測格式 | Business Trinity（metering/status/config）+ `castValue()` |
| `XuhengAdapter.ts` | 旭恒協議解析 | 完整 ACL: 6 Lists × all fields + emsList + dido |
| `NativeAdapter.ts` | 原生協議解析 | 扁平 MQTT 格式（deviceId + power） |
| `HuaweiAdapter.ts` | 華為協議解析 | FusionSolar 格式（devSn + dataItemMap） |
| `DynamicAdapter.ts` | 動態協議解析 | 根據 ParserRule 定義（Global Data Dictionary）轉換，支援 direct/iterator 模式 |

---

## 8. DB DDL Design (v5.22)

### 8.1 Table: `gateways`（v5.19 合併 homes 欄位）

```sql
CREATE TABLE IF NOT EXISTS gateways (
  gateway_id        VARCHAR(100) PRIMARY KEY,       -- v5.19: = device SN (e.g. WKRD24070202100144F)
  org_id            VARCHAR(50)  NOT NULL REFERENCES organizations(org_id),
  name              VARCHAR(200),                    -- v5.19: absorbed from homes
  address           TEXT,                             -- v5.19: absorbed from homes
  contracted_demand_kw DECIMAL(10,3),                -- v5.19: absorbed from homes
  mqtt_broker_host  VARCHAR(255) NOT NULL DEFAULT '18.141.63.142',
  mqtt_broker_port  INTEGER      NOT NULL DEFAULT 1883,
  mqtt_username     VARCHAR(100) NOT NULL DEFAULT 'xuheng',
  mqtt_password     VARCHAR(255) NOT NULL DEFAULT 'xuheng8888!',
  device_name       VARCHAR(100) DEFAULT 'EMS_N2',
  product_key       VARCHAR(50)  DEFAULT 'ems',
  status            VARCHAR(20)  NOT NULL DEFAULT 'online'
                      CHECK (status IN ('online', 'offline', 'decommissioned')),
  last_seen_at      TIMESTAMPTZ,
  ems_health        JSONB,                            -- emsList 系統健康快照
  ems_health_at     TIMESTAMPTZ,                      -- emsList 最後更新時間
  commissioned_at   TIMESTAMPTZ  DEFAULT NOW(),
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gateways_org ON gateways(org_id);
CREATE INDEX IF NOT EXISTS idx_gateways_status ON gateways(status);

-- RLS: tenant isolation
ALTER TABLE gateways ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_gateways_tenant ON gateways
  USING (org_id = current_setting('app.current_org_id', true));
```

> **v5.19 變更**：
> - `gateway_id` 從合成 ID 改為設備序號
> - `client_id` 欄位移除（= gateway_id）
> - `home_id` FK 移除（homes 表刪除）
> - 新增 `name`、`address`、`contracted_demand_kw`（從 homes 吸收）
> - `idx_gateways_home` 索引移除

### 8.2 Table: `device_command_logs`（v5.19 + v5.22）

```sql
CREATE TABLE IF NOT EXISTS device_command_logs (
  id                BIGSERIAL    PRIMARY KEY,
  gateway_id        VARCHAR(100) NOT NULL REFERENCES gateways(gateway_id),
  command_type      VARCHAR(20)  NOT NULL
                      CHECK (command_type IN ('get', 'get_reply', 'set', 'set_reply')),
  config_name       VARCHAR(100) NOT NULL DEFAULT 'battery_schedule',
  message_id        VARCHAR(50),
  payload_json      JSONB,
  result            VARCHAR(20),       -- 'success' | 'fail' | 'pending' | 'dispatched' | 'accepted' | 'timeout'
  error_message     TEXT,
  device_timestamp  TIMESTAMPTZ,       -- parsed from payload.timeStamp
  resolved_at       TIMESTAMPTZ,       -- when final reply received
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cmd_logs_gateway ON device_command_logs(gateway_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cmd_logs_message ON device_command_logs(gateway_id, message_id);
CREATE INDEX IF NOT EXISTS idx_cmd_logs_pending ON device_command_logs(result) WHERE result = 'pending';
CREATE INDEX IF NOT EXISTS idx_dcl_accepted_set ON device_command_logs(gateway_id, result)
  WHERE result IN ('dispatched', 'accepted');  -- v5.22 Phase 1
```

> **v5.19 變更**：`client_id` 欄位移除（= gateway_id）。
> **v5.22 變更**：`result` 新增 `'dispatched'`、`'accepted'` 狀態值；新增 `idx_dcl_accepted_set` 索引。

### 8.3 Table: `backfill_requests`（v5.22 Phase 2 NEW）

```sql
CREATE TABLE IF NOT EXISTS backfill_requests (
  id                  BIGSERIAL    PRIMARY KEY,
  gateway_id          VARCHAR(100) NOT NULL REFERENCES gateways(gateway_id),
  gap_start           TIMESTAMPTZ  NOT NULL,         -- 斷線開始時間
  gap_end             TIMESTAMPTZ  NOT NULL,         -- 重連時間
  current_chunk_start TIMESTAMPTZ,                    -- 目前處理到的 chunk 起點
  last_chunk_sent_at  TIMESTAMPTZ,                    -- 最後一個 chunk 發送時間
  status              VARCHAR(20)  NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'in_progress', 'completed', 'failed')),
  completed_at        TIMESTAMPTZ,                    -- 完成或失敗時間
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backfill_active ON backfill_requests(status)
  WHERE status IN ('pending', 'in_progress');  -- v5.22 Phase 2
```

### 8.4 `assets` Table Extension

```sql
-- gateway_id FK（v5.19: home_id 已移除）
ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS gateway_id VARCHAR(100) REFERENCES gateways(gateway_id);

CREATE INDEX IF NOT EXISTS idx_assets_gateway ON assets(gateway_id);
```

> **v5.19 變更**：`home_id` 欄位移除。

### 8.5 `telemetry_history` Table Extension

```sql
-- JSONB column for full protocol data (meter/grid/pv/load/flload per-phase detail)
ALTER TABLE telemetry_history
  ADD COLUMN IF NOT EXISTS telemetry_extra JSONB;

-- Dedicated columns for hot-path queries (used by dashboard / M2 / M3 / M4):
ALTER TABLE telemetry_history
  ADD COLUMN IF NOT EXISTS battery_soh DECIMAL(5,2);

ALTER TABLE telemetry_history
  ADD COLUMN IF NOT EXISTS battery_voltage DECIMAL(6,2);

ALTER TABLE telemetry_history
  ADD COLUMN IF NOT EXISTS battery_current DECIMAL(8,3);

ALTER TABLE telemetry_history
  ADD COLUMN IF NOT EXISTS battery_temperature DECIMAL(5,2);

ALTER TABLE telemetry_history
  ADD COLUMN IF NOT EXISTS flload_power DECIMAL(8,3);

ALTER TABLE telemetry_history
  ADD COLUMN IF NOT EXISTS inverter_temp DECIMAL(5,2);

ALTER TABLE telemetry_history
  ADD COLUMN IF NOT EXISTS pv_daily_energy_kwh DECIMAL(10,3);

-- BMS limits (used by ScheduleTranslator validation)
ALTER TABLE telemetry_history
  ADD COLUMN IF NOT EXISTS max_charge_current DECIMAL(8,3);

ALTER TABLE telemetry_history
  ADD COLUMN IF NOT EXISTS max_discharge_current DECIMAL(8,3);

-- Daily energy accumulators
ALTER TABLE telemetry_history
  ADD COLUMN IF NOT EXISTS daily_charge_kwh DECIMAL(10,3);

ALTER TABLE telemetry_history
  ADD COLUMN IF NOT EXISTS daily_discharge_kwh DECIMAL(10,3);

-- v5.22 Phase 3: Dedup index for backfill idempotency
CREATE UNIQUE INDEX IF NOT EXISTS idx_telemetry_unique_asset_time
  ON telemetry_history(asset_id, recorded_at);
```

**Design Decision — Hybrid Column + JSONB Strategy:**
- **Dedicated columns** 用於 M2/M3/M4 主動查詢的欄位（battery、grid totals、PV totals、DO state）
- **JSONB `telemetry_extra`** 用於：per-phase detail (grid/load/flload)、meter data (single + three)、dido DI、PV MPPT detail
- 避免在時序分區表上新增 60+ 欄位，同時保持 hot-path 查詢效率

### 8.6 Migration Files (v5.22)

| Migration | Content |
|-----------|---------|
| `migration_v5.22_phase1.sql` | `CREATE INDEX idx_dcl_accepted_set` on device_command_logs |
| `migration_v5.22_phase2.sql` | `CREATE TABLE backfill_requests` + `CREATE INDEX idx_backfill_active` |
| `migration_v5.22_phase3.sql` | `CREATE UNIQUE INDEX idx_telemetry_unique_asset_time ON telemetry_history(asset_id, recorded_at)` |

---

## 9. Domain Model Types

### 9.1 SolfacilMessage (Protocol Envelope)

```
interface SolfacilMessage {
  readonly DS: number;
  readonly ackFlag: number;
  readonly clientId: string;           // = gatewayId (v5.19)
  readonly deviceName: string;
  readonly productKey: string;
  readonly messageId: string;
  readonly timeStamp: string;          // epoch ms as string
  readonly data: Record<string, unknown>;
}
```

### 9.2 DomainSchedule

```
interface DomainSchedule {
  readonly socMinLimit: number;        // 0-100
  readonly socMaxLimit: number;        // 0-100
  readonly maxChargeCurrent: number;   // A, ≥0
  readonly maxDischargeCurrent: number; // A, ≥0
  readonly gridImportLimitKw: number;  // KW, ≥0
  readonly slots: ReadonlyArray<DomainSlot>;
}

interface DomainSlot {
  readonly mode: 'self_consumption' | 'peak_valley_arbitrage' | 'peak_shaving';
  readonly action?: 'charge' | 'discharge' | 'neutral';
  readonly allowExport?: boolean;
  readonly startMinute: number;        // 0-1380, multiple of 60
  readonly endMinute: number;          // 60-1440, multiple of 60
}
```

### 9.3 FragmentAssembler Types

```
// Actual type name: Accumulator (in fragment-assembler.ts)
interface Accumulator {
  readonly clientId: string;           // = gatewayId (v5.19)
  readonly recordedAt: Date;           // from first fragment's timeStamp
  ems?: SolfacilListItem;              // from emsList (raw protocol item)
  dido?: {                             // from dido
    readonly do: ReadonlyArray<{ id: string; type: string; value: string; gpionum?: string }>;
    readonly di?: ReadonlyArray<{ id: string; type: string; value: string; gpionum?: string }>;
  };
  meters: SolfacilListItem[];          // from meterList (0-2 entries)
  core?: Record<string, unknown>;      // from batList 大包 (raw data object)
  timer: NodeJS.Timeout | null;        // debounce timer
}
```

> **Note**: ems 和 meters 使用 `SolfacilListItem` 原始協議類型（包含 `deviceSn`、`name`、`deviceBrand`、`properties`），不做中間轉換。dido 使用含 `do`/`di` 陣列的結構體。

### 9.4 BackfillRequest Type (v5.22 NEW)

```
interface BackfillRequest {
  readonly id: number;
  readonly gatewayId: string;
  readonly gapStart: Date;
  readonly gapEnd: Date;
  currentChunkStart: Date | null;
  lastChunkSentAt: Date | null;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  readonly createdAt: Date;
}
```

---

## 10. Pool Assignment

| 程式 | DB Pool | 用途 |
|------|---------|------|
| GatewayConnectionManager | shared pool | 讀取 gateways 表、watchdog 更新 |
| HeartbeatHandler | shared pool | 更新 last_seen_at、INSERT backfill_requests |
| TelemetryHandler / FragmentAssembler | shared pool | INSERT telemetry_history、UPDATE device_state、UPDATE gateways.ems_health |
| MissedDataHandler / BackfillAssembler | shared pool | INSERT ON CONFLICT telemetry_history |
| CommandTracker | shared pool | UPDATE device_command_logs |
| CommandPublisher | shared pool | SELECT/UPDATE device_command_logs |
| BackfillRequester | shared pool | SELECT/UPDATE backfill_requests |
| DeviceListHandler | shared pool | UPSERT assets |
| DeviceAssetCache | shared pool | SELECT assets（快取） |
| MessageBuffer | shared pool | Batch INSERT telemetry_history |

---

## 11. Code Change List

### Handlers (handlers/)

| File | Version | Change |
|------|---------|--------|
| `mqtt-subscriber.ts` | v5.16 | 未變更（legacy 單 topic 路徑） |
| `command-tracker.ts` | **v5.22** | 二階段 set_reply：accepted→success/fail；pg_notify('command_status') |
| `heartbeat-handler.ts` | **v5.22** | 重連偵測 atomic CTE → INSERT backfill_requests |
| `missed-data-handler.ts` | **v5.22 NEW** | Backfill data path：data/missed topic handler |
| `device-list-handler.ts` | v5.18 | 未變更 |
| `telemetry-handler.ts` | v5.18 | 未變更 |
| `telemetry-webhook.ts` | v5.16 | 未變更 |
| `schedule-to-shadow.ts` | v5.16 | 未變更 |
| `schedule-translator.ts` | v5.18 | 未變更 |
| `publish-config.ts` | v5.18 | 未變更 |
| `ingest-telemetry.ts` | v5.16 | 未變更 |

### Services (services/)

| File | Version | Change |
|------|---------|--------|
| `fragment-assembler.ts` | **v5.22** | `parseTelemetryPayload` 抽取為共用純函式，與 BackfillAssembler 共享 |
| `backfill-requester.ts` | **v5.22 NEW** | 輪詢 backfill_requests → 分塊 get_missed MQTT publish |
| `gateway-connection-manager.ts` | **v5.22** | +1 topic 訂閱（data/missed）；watchdog 10 分鐘 |
| `command-publisher.ts` | v5.21 | 輪詢 device_command_logs pending→dispatched |
| `device-asset-cache.ts` | v5.16 | 未變更 |
| `message-buffer.ts` | v5.16 | 未變更 |
| `telemetry-aggregator.ts` | v5.16 | 未變更 |
| `telemetry-5min-aggregator.ts` | v5.15 | 未變更 |

### Parsers (parsers/)

| File | Version | Change |
|------|---------|--------|
| `AdapterRegistry.ts` | v5.16 | 未變更（HuaweiAdapter → NativeAdapter 順序解析） |
| `TelemetryAdapter.ts` | v5.16 | 未變更（ACL 契約接口） |
| `StandardTelemetry.ts` | v5.16 | 未變更（Business Trinity 格式 + castValue） |
| `XuhengAdapter.ts` | v5.18 | 未變更 |
| `NativeAdapter.ts` | v5.16 | 未變更 |
| `HuaweiAdapter.ts` | v5.16 | 未變更 |
| `DynamicAdapter.ts` | v5.16 | 未變更 |

---

## 12. Error Handling

| Scenario | Behavior |
|----------|----------|
| MQTT parse error（malformed JSON） | Log error, skip message, continue |
| Unknown gatewayId（not in gateways table） | Log warning, skip message |
| deviceList UPSERT failure | Log error, skip batch, continue |
| Telemetry INSERT failure | Log error（MessageBuffer 現有行為） |
| Schedule validation failure | Throw `ScheduleValidationError`, DO NOT publish |
| MQTT broker disconnect | Auto-reconnect（reconnectPeriod: 5000ms） |
| DB connection failure | Crash + systemd restart（現有行為） |
| Fragment timeout（no MSG#5 within 3s） | Flush ems_health only, discard incomplete fragments, log warning |
| emsList parse error | Log warning, skip ems_health update |
| dido parse error | Log warning, DO0/DO1 fall back to false |
| subDevices/get publish failure | Log error, continue（下次每小時輪詢重試） |
| CommandPublisher: gateway not connected | Mark as `failed` with error_message='gateway_offline' |
| BackfillRequester: gateway not connected | Mark as `failed` with completed_at=NOW() |
| BackfillAssembler: duplicate telemetry | `INSERT ON CONFLICT DO NOTHING`（靜默 dedup） |
| set_reply with no matching command | INSERT 獨立 `set_reply` 記錄（審計用），不觸發 pg_notify |
| Dispatch guard: existing pending/dispatched/accepted | BFF returns HTTP 409 Conflict |
| Accepted timeout（20s without resolution） | 定期任務標記為 `timeout` |

---

## 13. Test Strategy

### 13.1 Unit Tests

| Test Target | Coverage |
|-------------|----------|
| `parseTelemetryPayload` | 純函式：各種 fragment 組合、缺失欄位、型別轉換 |
| `classifyMessage` | 所有 data 頂層 key 組合 |
| `ScheduleTranslator` | 雙向轉換、邊界值、slot coverage/overlap |
| `CommandTracker.handleSetReply` | 二階段狀態流轉：accepted→success、accepted→fail、dispatched→success |
| `HeartbeatHandler` | 重連間隙偵測（>2min）、無間隙（正常心跳）、首次心跳 |
| `BackfillRequester` | Chunk 分割邏輯、cooldown 計算、delay_after_reconnect |
| `MissedDataHandler` | Backfill data 分類與累積 |

### 13.2 Integration Tests

| Test Target | Coverage |
|-------------|----------|
| FragmentAssembler + DB | 5 條 fragment → 合併 INSERT telemetry_history + gateways.ems_health + pg_notify |
| BackfillAssembler + DB | INSERT ON CONFLICT DO NOTHING dedup 驗證 |
| CommandPublisher pipeline | pending → dispatched → MQTT publish 驗證 |
| HeartbeatHandler → backfill_requests | 斷線 >2min → INSERT backfill_requests |
| Dispatch guard | 重複 set 命令 → 409 |

### 13.3 E2E Tests

| Test Flow | Steps |
|-----------|-------|
| Live telemetry cycle | MQTT 5-msg burst → FragmentAssembler → telemetry_history row + SSE notify |
| Command round-trip | BFF set → CommandPublisher dispatch → gateway accepted → success → SSE notify |
| Backfill cycle | Gateway offline 5min → reconnect → backfill_requests created → chunks sent → missed data received → dedup INSERT |
| Dispatch guard | Send duplicate set while accepted → verify 409 |

---

## Document History

| Version | Date | Summary |
|---------|------|---------|
| v5.2 | 2026-02-27 | Initial: IoT Hub Lambda + IoT Core |
| v5.13 | 2026-03-05 | Block 1: mqtt-subscriber + XuhengAdapter |
| v5.14 | 2026-03-06 | XuhengAdapter +9 bat.properties |
| v5.15 | 2026-03-07 | 5-min aggregator |
| v5.16 | 2026-03-07 | DO telemetry |
| v5.18 | 2026-03-09 | Full Solfacil Protocol v1.1: 5 subscribe + 2 publish, DeviceListHandler, TelemetryHandler (6 Lists full fields), ScheduleTranslator (bidirectional), HeartbeatHandler, CommandTracker, gateways table, device_command_logs table, hybrid column+JSONB telemetry storage |
| v5.18-hotfix | 2026-03-09 | Fragmented Payload handling: FragmentAssembler for MSG#1-5 merge, emsList→gateways.ems_health, dido DO0/DO1→telemetry_history, dual meterList→telemetry_extra, Protocol v1.2: +subDevices/get publish + hourly polling |
| v5.19 | 2026-03-10 | Schema consolidation: homes→gateways merge, gateway_id=SN, assets.home_id removed, device_command_logs.client_id removed |
| v5.20 | 2026-03-10 | Gateway-level: M1 code purged of client_id/home_id references |
| v5.21 | 2026-03-11 | SSE + Command Pipeline: M3→M1 CommandPublisher (pending→dispatched), pg_notify for telemetry_update/gateway_health/command_status |
| **v5.22** | **2026-03-13** | **Two-phase set_reply (accepted→success/fail, 20s timeout, 409 guard), backfill infrastructure (backfill_requests table, HeartbeatHandler reconnect detection, BackfillRequester chunked get_missed, MissedDataHandler + BackfillAssembler with dedup INSERT ON CONFLICT DO NOTHING), parseTelemetryPayload extracted as shared pure function, +1 subscribe topic (data/missed) + 1 publish topic (data/get_missed), watchdog threshold 90s→10min, UNIQUE INDEX on telemetry_history(asset_id, recorded_at)** |
