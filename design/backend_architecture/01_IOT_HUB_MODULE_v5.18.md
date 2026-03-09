# M1: IoT Hub Module — MQTT 協議接入層

> **Module Version**: v5.18 (hotfix)
> **Parent**: [00_MASTER_ARCHITECTURE_v5.15.md](./00_MASTER_ARCHITECTURE_v5.15.md)
> **Last Updated**: 2026-03-09
> **Description**: Full Solfacil Protocol v1.2 integration — 5 subscribe + 3 publish topics, anti-corruption layer, gateway registry
> **Core Theme**: Replace single-topic Xuheng bridge with complete protocol-aware IoT Hub

---

## Changes from v5.16

| Component | Before (v5.16) | After (v5.18) |
|-----------|---------------|---------------|
| MQTT Topics | 1 wildcard `xuheng/+/+/data` | 5 subscribe + 3 publish per gateway (Solfacil Protocol v1.2) |
| Connection | Single broker, single subscription | Per-gateway subscriptions read from `gateways` table |
| XuhengAdapter | Parses batList partial fields | Full ACL: 6 Lists × all fields + emsList + dido |
| Device Discovery | None (manual assets insert) | `DeviceListHandler`: deviceList → assets UPSERT |
| Config Management | None | `ScheduleTranslator`: battery_schedule ↔ domain model bidirectional |
| Heartbeat | None | `HeartbeatHandler`: status → gateways.last_seen_at |
| Command Tracking | None | `CommandTracker`: set_reply → device_command_logs |
| DB | assets + telemetry_history | +gateways table, +device_command_logs table, assets +gateway_id |

---

## 1. Architecture Overview

```
                  ┌────────────────────────────────────────────┐
                  │              MQTT Broker                    │
                  │         18.141.63.142:1883                  │
                  └──┬──────┬──────┬──────┬──────┬─────────────┘
                     │S1    │S2    │S3    │S4    │S5
                     ▼      ▼      ▼      ▼      ▼
┌─────────────────────────────────────────────────────────────────┐
│                    M1 IoT Hub (v5.18)                            │
│                                                                  │
│  ┌──────────────┐  ┌──────────────────────────────────────────┐ │
│  │ Gateway       │  │ Anti-Corruption Layer (ACL)              │ │
│  │ Connection    │  │                                          │ │
│  │ Manager       │  │  S1 → DeviceListHandler  → assets       │ │
│  │               │  │  S2 → TelemetryHandler   → telemetry_*  │ │
│  │  reads        │  │       ├─ FragmentAssembler (merge 5 msgs)│ │
│  │  gateways     │  │       ├─ EmsListProcessor → gateways    │ │
│  │  table        │  │       └─ DidoProcessor    → DO0/DO1     │ │
│  └──────┬───────┘  │  S3 → CommandTracker     → cmd_logs     │ │
│         │          │  S4 → CommandTracker     → cmd_logs     │ │
│         │          │  S5 → HeartbeatHandler   → gateways     │ │
│         ▼          │                                          │ │
│    ┌─────────┐     │  P1 ← ScheduleTranslator  ← BFF         │ │
│    │gateways │     │  P2 ← ScheduleTranslator  ← BFF/M2      │ │
│    │  table  │     │  P3 ← SubDevicesPoller     ← Timer/Startup│ │
│    └─────────┘     └──────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
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
| BFF | → M1 | `publishConfigGet(clientId)` | User opens schedule editor |
| BFF | → M1 | `publishConfigSet(clientId, schedule)` | User clicks "Apply to Gateway" |
| M2 | → M1 | `publishConfigSet(clientId, schedule)` | Algorithm auto-schedule |
| M3 | → M1 | Reads `gateways` + `device_state` | DR dispatch decisions |
| M4 | ← M1 | Reads `telemetry_history` | Billing calculations |

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
  │    ├─ Subscribe to 5 topics (S1–S5)
  │    ├─ Store client handle in gatewayClients Map
  │    └─ [v1.2] Publish subDevices/get (initial device list pull)
  │
  ├─ Start heartbeat watchdog (60s interval)
  │    └─ For each gateway: if NOW() - last_seen_at > 90s → status='offline'
  │
  └─ [v1.2] Start periodic publish timers:
       ├─ subDevices/get — every 1 hour
       └─ config/get     — every 1 hour
```

### 2.2 Per-Gateway Topic Subscriptions

For each gateway with `client_id = {cid}`:

| # | Topic Pattern | Handler |
|---|---------------|---------|
| S1 | `device/ems/{cid}/deviceList` | `DeviceListHandler.handle()` |
| S2 | `device/ems/{cid}/data` | `TelemetryHandler.handle()` |
| S3 | `device/ems/{cid}/config/get_reply` | `CommandTracker.handleGetReply()` |
| S4 | `device/ems/{cid}/config/set_reply` | `CommandTracker.handleSetReply()` |
| S5 | `device/ems/{cid}/status` | `HeartbeatHandler.handle()` |

### 2.3 Per-Gateway Publish Topics (v1.2)

| # | Topic Pattern | Trigger | Purpose |
|---|---------------|---------|---------|
| P1 | `platform/ems/{cid}/config/get` | BFF / 每 1 小時 | Request current config |
| P2 | `platform/ems/{cid}/config/set` | BFF / M2 | Push new schedule |
| P3 | `platform/ems/{cid}/subDevices/get` | 首次連線 + 每 1 小時 | Request device list |

### 2.4 Connection Configuration

```
interface GatewayConnection {
  gatewayId: string;
  clientId: string;           // MQTT clientId (device serial)
  brokerHost: string;         // 18.141.63.142
  brokerPort: number;         // 1883
  username: string;           // xuheng
  password: string;           // xuheng8888!
  mqttClient: MqttClient;     // runtime handle
}
```

- **Reconnect**: `reconnectPeriod: 5000` (existing pattern)
- **QoS**: 1 for all subscriptions
- **Clean session**: true (no persistent sessions needed for MVP)
- **No wildcard**: Each gateway subscribes individually (shared broker with other services)

### 2.5 Dynamic Gateway Addition

MVP approach: M1 polls `gateways` table every 60s for new records. If a new gateway is found (not in `gatewayClients` Map), subscribe to its 5 topics.

No event bus or message queue — direct DB polling is sufficient for 3 gateways.

---

## 3. Fragmented Payload 處理機制

### 3.1 問題：真實 MQTT 行為

每個網關每 30 秒（生產為 5 分鐘）發送 **5 條獨立 MQTT 消息**，全部走 `device/ems/{clientId}/data` topic，在 ~800ms 內連續到達：

| 序號 | 消息內容 | 大小 | 間隔 | 特徵 |
|------|---------|------|------|------|
| MSG#1 | `emsList`（EMS 系統狀態） | 718B | 起點 | 無 batList、無 deviceSn（用 clientId） |
| MSG#2 | `dido`（數字 IO） | 630B | +140ms | 無 batList、有 DI/DO 值 |
| MSG#3 | `meterList`（單相電表） | 851B | +132ms | 無 batList、有獨立 deviceSn |
| MSG#4 | `meterList`（三相電表） | 1556B | +150ms | 無 batList、有獨立 deviceSn |
| MSG#5 | `batList+gridList+loadList+flloadList+pvList` | 3278B | +357ms | 有 batList（大包） |

**原始 Bug**：`TelemetryHandler` 有 `if (!bat) return;` early return，MSG#1-4 因為沒有 `batList` 被直接丟棄。

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
              │  key = clientId         │
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
              └─────────────────────────┘
```

**關鍵設計決策**：

| 決策 | 選擇 | 理由 |
|------|------|------|
| Fragment 累積方式 | Per-gateway Map with 3s debounce | 5 條消息在 ~800ms 內到齊，3s 足夠 |
| emsList 存到哪 | `gateways.ems_health` JSONB | 網關自身健康，非設備遙測，不進 telemetry_history |
| dido DO0/DO1 | 合併到 inverter 的 telemetry_history row | DO 是 Peak Shaving 切載信號，屬於調度上下文 |
| dido DI0/DI1 | 合併到 telemetry_extra.dido JSONB | 數字輸入，僅診斷用 |
| meterList（兩個電表） | 合併到 telemetry_extra JSONB，分 key 存 | `meter_single` + `meter_three`，避免額外 table |
| 如果 MSG#5 未到 | 3s 後仍然 flush 已有 fragment（ems_health 照寫，telemetry_history 不寫） | 保證 ems_health 不丟，但不寫不完整的遙測行 |

### 3.3 Fragment 分類邏輯

```
function classifyMessage(data: Record<string, unknown>):
  | { type: 'ems', payload: EmsListItem }
  | { type: 'dido', payload: DidoItem }
  | { type: 'meter', payload: MeterListItem[] }
  | { type: 'core', payload: CorePayload }  // batList 大包

  if (data.emsList)           → type = 'ems'
  if (data.dido)              → type = 'dido'
  if (data.meterList)         → type = 'meter'
  if (data.batList)           → type = 'core'
  // 理論上 batList 大包同時含 gridList/loadList/flloadList/pvList
```

**分類依據**：每條消息的 `data` 物件頂層 key 互斥，可以直接判斷。

### 3.4 Debounce 與 Flush 策略

```
FragmentAssembler.receive(clientId, messageType, fragment):
  1. 取得或建立 clientId 的 accumulator
  2. 將 fragment 合併到 accumulator 對應欄位
  3. 重設 3s debounce timer
  4. 若收到 'core' type（MSG#5 大包）：
     - 可立即 flush（因為 MSG#5 是最後到達的，前 4 條已在 cache）
     - 或仍等 timer 到期（更安全，防止亂序）
  5. Timer 到期 → mergeAndPersist(clientId)
```

**選擇「收到 core 立即 flush」**：因為 MSG#5 永遠最後到達（+357ms），前 4 條已在 cache。這樣延遲最低。但仍保留 3s safety timer 以防 MSG#5 丟失。

### 3.5 mergeAndPersist 流程

```
async function mergeAndPersist(clientId, accumulator):
  const { ems, dido, meters, core } = accumulator

  // Step 1: emsList → gateways.ems_health（無論 core 是否存在都寫）
  if (ems) {
    await updateGatewayEmsHealth(pool, clientId, ems)
  }

  // Step 2: core（MSG#5 大包）→ telemetry_history + device_state
  if (core) {
    const parsed = buildParsedTelemetry(core, dido, meters)
    // dido.DO0/DO1 合併到 parsed.do0Active / do1Active
    // meters 合併到 parsed.telemetryExtra
    const assetId = await cache.resolve(parsed.deviceSn)
    buffer.enqueue(assetId, parsed)
    await updateDeviceState(pool, assetId, parsed)
  }

  // Step 3: 如果只有 meters 沒有 core，僅記 log 不寫 telemetry_history
  // （防止不完整數據進入時序表）

  // Step 4: 清除 accumulator
  clearAccumulator(clientId)
```

---

## 4. Topic Handlers (Anti-Corruption Layer)

### 4.1 DeviceListHandler

**Subscribe**: `device/ems/{clientId}/deviceList`
**Persistence**: `assets` table UPSERT

```
Function Signature:
  handleDeviceList(pool: Pool, gatewayId: string, payload: SolfacilMessage): Promise<void>

Input:  payload.data.deviceList[]
Output: assets table rows (INSERT or UPDATE)
```

**Processing Logic:**

1. Parse `payload.data.deviceList[]` — each element is a major (一級) sub-device
2. For each device in list:
   - Build `asset_id` from `deviceSn` (deterministic, idempotent)
   - UPSERT into `assets`:
     - `serial_number` = `deviceSn`
     - `name` = `device.name`
     - `brand` = `device.vendor`
     - `model` = `device.deviceBrand`
     - `asset_type` = map `productType` → enum (`meter` → `SMART_METER`, `inverter` → `INVERTER_BATTERY`)
     - `gateway_id` = FK to gateways table
     - `home_id` = from `gateways.home_id`
     - `org_id` = from `gateways.org_id`
     - `is_active` = true
     - `commissioned_at` = NOW() (only on INSERT, not UPDATE)
3. **Soft-delete reconciliation** (鐵律):
   - Query all `assets WHERE gateway_id = $1 AND is_active = true`
   - Compare against incoming `deviceList[].deviceSn`
   - Any DB device NOT in the incoming list → `UPDATE assets SET is_active = false WHERE serial_number = $sn`
   - **ABSOLUTELY NO DELETE** — historical financial trails must survive

**Protocol Field → Domain Mapping (deviceList):**

| Protocol Field | DB Column | Notes |
|---------------|-----------|-------|
| `deviceSn` | `assets.serial_number` | Primary lookup key |
| `name` | `assets.name` | e.g. "GoodWe-1" |
| `vendor` | `assets.brand` | e.g. "GoodWe" |
| `deviceBrand` | `assets.model` | e.g. "inverter-goodwe-Energystore" |
| `productType` | `assets.asset_type` | meter→SMART_METER, inverter→INVERTER_BATTERY |
| `connectStatus` | `assets.is_active` | "online"→true (but soft-delete logic overrides) |
| `bindStatus` | (logged only) | true/false, informational |
| `protocolAddr` | (stored in telemetry_json or ignored) | Modbus address |
| `nodeType` | (filter: only process "major") | major/minor |
| `subDevId` | (ignored) | Auto-generated by gateway |
| `fatherSn` | (used for hierarchy, not stored directly) | Parent device SN |

### 4.2 TelemetryHandler (v5.18 Hotfix — Fragment-Aware)

**Subscribe**: `device/ems/{clientId}/data`
**Persistence**: `telemetry_history` (via MessageBuffer), `device_state`, `gateways.ems_health`

```
Function Signature:
  handleTelemetry(pool: Pool, gatewayId: string, clientId: string, payload: SolfacilMessage): Promise<void>

Input:  payload.data — may contain ANY of:
        emsList, dido, meterList, batList+gridList+loadList+flloadList+pvList
Output: Accumulated fragments → merged telemetry_history row + gateways.ems_health
```

**鐵律 — TimeStamp Rule:**
All `recorded_at` values MUST be parsed from `payload.timeStamp` (epoch ms string). Server-side `NOW()` is FORBIDDEN for telemetry writes. This ensures backfill idempotency and M4 billing window accuracy.

```
const recordedAt = new Date(parseInt(payload.timeStamp, 10));
```

**Processing Logic (Hotfix):**

1. Parse `payload.timeStamp` → `recordedAt`
2. **Classify** message by top-level `data` keys (see §3.3)
3. **Feed** classified fragment into `FragmentAssembler` for this `clientId`
4. FragmentAssembler handles merge + debounce + flush (see §3.4–3.5)

**不再有 `if (!bat) return;`** — 所有消息類型都被接收和累積。

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
    ems_health_at = to_timestamp($2::bigint / 1000.0),
    updated_at = NOW()
WHERE client_id = $3
```

**設計理由**：emsList 是網關自身的系統監控指標（CPU、記憶體、網路），不是逆變器/電表的能源遙測。放在 `gateways` 表而非 `telemetry_history` 因為：
- 語義正確：這是網關健康，不是設備遙測
- 只需最新值：不需要時序歷史（如果未來需要，可加 `gateway_health_history` 表）
- 查詢路徑獨立：運維看網關健康 vs 業務看能源遙測

#### 4.2.2 dido 處理 — 數字 IO（MSG#2）

**協議欄位 → 儲存位置**：DO0/DO1 → `telemetry_history.do0_active / do1_active`，DI0/DI1 → `telemetry_extra.dido`

dido 消息的 `data` 結構（實測）：
```json
{
  "dido": {
    "DI0": "0",
    "DI1": "0",
    "DO0": "1",
    "DO1": "0"
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

**合併策略**：dido 消息沒有 `batList`，無法獨立寫入 `telemetry_history`。Fragment Assembler 將 DO0/DO1 值暫存，等 MSG#5 到達後合併到 `ParsedTelemetry.do0Active / do1Active`，取代目前的 `false` 硬編碼。

**轉換規則**：`"1"` → `true`, `"0"` → `false`（字串轉布林）

#### 4.2.3 meterList 處理 — 獨立電表（MSG#3 + MSG#4）

**兩個獨立設備**：
- MSG#3：`Meter-Chint-DTSU666Single`（單相，7 props）— deviceSn = `Meter-Chint-DTSU666Single1772421080_WKRD24070202100141I`
- MSG#4：`Meter-Chint-DTSU666Three`（三相，32 props）— deviceSn = `Meter-Chint-DTSU666Three1772421079_WKRD24070202100141I`

**關鍵設計決策 — Meter 數據不寫獨立 telemetry_history 行**：

| 方案 | 優點 | 缺點 | 選擇 |
|------|------|------|------|
| A. 每個 Meter 獨立 telemetry_history 行 | 語義清晰 | 大量 NULL（battery_soc 等欄位全空）、每期 3 行 | ❌ |
| B. 新建 `meter_telemetry` 表 | Schema 乾淨 | 額外表、額外 migration、MVP 過度設計 | ❌ |
| **C. 合併到 inverter 的 telemetry_extra JSONB** | 零 schema 變更、單行包含完整週期快照 | JSONB 查詢較慢 | ✅ MVP |

**理由**：
- Meter 數據在 MVP 階段僅供診斷/drill-down，不被 M2/M3/M4 主動查詢
- 每個週期（30s/5min）只有 1 個逆變器 + 2 個電表，數據量極小
- telemetry_extra JSONB 已存在，只需擴展 key 命名

**telemetry_extra 中的 Meter 存儲結構**（hotfix 修正）：

原設計只有一個 `meter` key，hotfix 改為按電表類型分 key：

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

這部分邏輯已正確運行，無需修改。以下為完整對照表。

**batList (Battery) — 13 fields → telemetry_history 實體欄位：**

| Protocol Field (`properties.*`) | ParsedTelemetry Field | DB Column (`telemetry_history`) | Unit | Notes |
|------|------|------|------|------|
| `total_bat_soc` | `batterySoc` | `battery_soc` | % | |
| `total_bat_soh` | `batterySoh` | `battery_soh` | % | BMS direct |
| `total_bat_power` | `batteryPowerKw` | `battery_power` | W | discharge=positive, charge=negative |
| `total_bat_current` | `batteryCurrent` | `battery_current` | A | positive=discharge, negative=charge |
| `total_bat_vlotage` | `batteryVoltage` | `battery_voltage` | V | **Typo in protocol: vlotage** |
| `total_bat_temperature` | `batteryTemperature` | `battery_temperature` | ℃ | |
| `total_bat_maxChargeVoltage` | `maxChargeVoltage` | `max_charge_voltage` | V | BMS limit |
| `total_bat_maxChargeCurrent` | `maxChargeCurrent` | `max_charge_current` | A | BMS limit |
| `total_bat_maxDischargeCurrent` | `maxDischargeCurrent` | `max_discharge_current` | A | BMS limit |
| `total_bat_dailyChargedEnergy` | `dailyChargeKwh` | `daily_charge_kwh` | kWh | |
| `total_bat_dailyDischargedEnergy` | `dailyDischargeKwh` | `daily_discharge_kwh` | kWh | |
| `total_bat_totalChargedEnergy` | `totalChargeKwh` | `total_charge_kwh` | kWh | Lifetime |
| `total_bat_totalDischargedEnergy` | `totalDischargeKwh` | `total_discharge_kwh` | kWh | Lifetime |

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
| `pv_totalEnergy` | `telemetry_extra.pv.total_energy_kwh` | JSONB |
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

```
Function Signatures:

  // Read direction: protocol → domain model
  parseGetReply(payload: SolfacilMessage): DomainSchedule | null

  // Write direction: domain model → protocol message
  buildConfigSet(clientId: string, schedule: DomainSchedule): SolfacilConfigSetMessage

  // Validate before publish (hard crash on failure)
  validateSchedule(schedule: DomainSchedule): ValidationResult
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
| `start` (string) | `startMinute` (number) | `parseInt()`, minutes from 00:00 |
| `end` (string) | `endMinute` (number) | `parseInt()`, minutes from 00:00 |

#### 4.3.2 Write Direction (Domain Model → config/set)

Reverse of read direction. All numeric values converted to strings. The output message structure:

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
      slots: schedule.slots.map(s => translateSlotToProcotol(s))
    }
  },
  clientId: clientId,
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
| `max_charge_current` | ≥ 0, ≤ BMS `total_bat_maxChargeCurrent` | Throw |
| `max_discharge_current` | ≥ 0, ≤ BMS `total_bat_maxDischargeCurrent` | Throw |
| `grid_import_limit` | ≥ 0 (KW) | Throw |
| `slot.start` | 0–1380, multiple of 60 | Throw |
| `slot.end` | 60–1440, multiple of 60, > start | Throw |
| Slot coverage | Union of all slots must equal [0, 1440) | Throw |
| Slot overlap | No two slots may cover the same minute | Throw |

**BMS limit lookup**: Read latest `max_charge_current` and `max_discharge_current` from `telemetry_history` for the gateway's inverter asset, ordered by `recorded_at DESC LIMIT 1`.

### 4.4 HeartbeatHandler

**Subscribe**: `device/ems/{clientId}/status`
**Persistence**: `gateways.last_seen_at`, `gateways.status`

```
Function Signature:
  handleHeartbeat(pool: Pool, clientId: string, payload: SolfacilMessage): Promise<void>

Logic:
  UPDATE gateways
    SET last_seen_at = to_timestamp($1::bigint / 1000.0),
        status = 'online',
        updated_at = NOW()
    WHERE client_id = $2
```

- Lightest handler — single UPDATE per message
- `payload.timeStamp` used for `last_seen_at` (device clock, not server clock)
- Heartbeat interval: 30s (per protocol)
- Offline threshold: 90s (3 missed heartbeats) — enforced by the watchdog timer in Connection Manager

### 4.5 CommandTracker

**Subscribe**: `device/ems/{clientId}/config/get_reply` + `device/ems/{clientId}/config/set_reply`
**Persistence**: `device_command_logs` table

```
Function Signatures:
  handleGetReply(pool: Pool, clientId: string, payload: SolfacilMessage): Promise<void>
  handleSetReply(pool: Pool, clientId: string, payload: SolfacilMessage): Promise<void>
```

**get_reply handling:**
1. Parse `payload.data.battery_schedule` via `ScheduleTranslator.parseGetReply()`
2. Insert into `device_command_logs`:
   - `command_type = 'get_reply'`
   - `config_name = payload.data.configname`
   - `payload_json = payload.data.battery_schedule` (raw JSON)
   - `result = 'success'`
   - `device_timestamp` = parsed from `payload.timeStamp`
3. Optionally cache the schedule in memory for BFF polling

**set_reply handling (異步閉環鐵律):**
1. Parse `payload.data.result` and `payload.data.message`
2. Update `device_command_logs`:
   - Find matching pending command by `client_id + configname` (latest unresolved)
   - Set `result = payload.data.result` ("success" or "fail")
   - Set `error_message = payload.data.message`
   - Set `resolved_at = NOW()`
   - Set `device_timestamp` = parsed from `payload.timeStamp`
3. If `result = "fail"`, log error with full context for debugging

---

## 5. Publish Functions

### 5.1 publishConfigGet

**Topic**: `platform/ems/{clientId}/config/get`
**Caller**: BFF (user opens schedule editor) + 每 1 小時自動輪詢

```
Function Signature:
  publishConfigGet(clientId: string): Promise<string>
    // Returns: messageId for tracking

Logic:
  1. Generate messageId = String(Date.now())
  2. Build message: { DS:0, ackFlag:0, data:{configname:"battery_schedule"}, clientId, deviceName:"EMS_N2", productKey:"ems", messageId, timeStamp:String(Date.now()) }
  3. INSERT into device_command_logs: command_type='get', config_name='battery_schedule', status='pending'
  4. Publish to MQTT topic
  5. Return messageId
```

### 5.2 publishConfigSet

**Topic**: `platform/ems/{clientId}/config/set`
**Caller**: BFF (user clicks Apply) or M2 (algorithm auto-schedule)

```
Function Signature:
  publishConfigSet(clientId: string, schedule: DomainSchedule): Promise<string>
    // Returns: messageId for tracking
    // Throws: ScheduleValidationError if validation fails

Logic:
  1. validateSchedule(schedule) — HARD CRASH on failure, never publish invalid config
  2. Generate messageId
  3. Build protocol message via ScheduleTranslator.buildConfigSet()
  4. INSERT into device_command_logs: command_type='set', config_name='battery_schedule', status='pending', payload_json=schedule
  5. Publish to MQTT topic
  6. Return messageId
```

### 5.3 publishSubDevicesGet（v1.2 新增）

**Topic**: `platform/ems/{clientId}/subDevices/get`
**Caller**: GatewayConnectionManager（首次連線 + 每 1 小時）

```
Function Signature:
  publishSubDevicesGet(clientId: string, publish: MqttPublishFn): void

Logic:
  1. Build message: {
       DS: 0,
       ackFlag: 0,
       clientId,
       deviceName: "EMS_N2",
       productKey: "ems",
       messageId: String(Date.now()),
       timeStamp: String(Date.now()),
       data: { reason: "periodic_query" }
     }
  2. Publish to `platform/ems/${clientId}/subDevices/get`
  3. Log info (不寫 device_command_logs，因為回應走現有 deviceList handler)
```

**回應處理**：網關收到 `subDevices/get` 後，透過原有 `device/ems/{clientId}/deviceList` topic 回覆。已被 DeviceListHandler（S1）處理，無需額外 handler。

**輪詢策略**（Alan 決定）：

| Publish | 首次觸發 | 定期間隔 | 備註 |
|---------|---------|---------|------|
| `subDevices/get` | Gateway 連線成功後立即 | 每 1 小時 | 保持設備清單同步 |
| `config/get` | 不自動觸發（前端打開時觸發） | 每 1 小時 | 保持排程配置同步 |
| `config/set` | 不自動觸發 | 不輪詢 | 純前端 / M2 觸發 |

**ConnectionManager 新增 Timer**：
```
// 在 connectGateway 成功後：
publishSubDevicesGet(cid, client.publish.bind(client))

// 每 1 小時輪詢（所有已連線網關）：
setInterval(() => {
  for (const [, gc] of this.gatewayClients) {
    publishSubDevicesGet(gc.clientId, ...)
    publishConfigGet(pool, gc.gatewayId, gc.clientId, ...)
  }
}, 3_600_000)
```

---

## 6. DB DDL Design

### 6.1 Table: `gateways`（hotfix 新增 `ems_health` 欄位）

```sql
CREATE TABLE IF NOT EXISTS gateways (
  gateway_id        VARCHAR(50)  PRIMARY KEY,
  client_id         VARCHAR(100) NOT NULL UNIQUE,  -- MQTT clientId = device serial
  org_id            VARCHAR(50)  NOT NULL REFERENCES organizations(org_id),
  home_id           VARCHAR(50)  REFERENCES homes(home_id),
  mqtt_broker_host  VARCHAR(255) NOT NULL DEFAULT '18.141.63.142',
  mqtt_broker_port  INTEGER      NOT NULL DEFAULT 1883,
  mqtt_username     VARCHAR(100) NOT NULL DEFAULT 'xuheng',
  mqtt_password     VARCHAR(255) NOT NULL DEFAULT 'xuheng8888!',
  device_name       VARCHAR(100) DEFAULT 'EMS_N2',
  product_key       VARCHAR(50)  DEFAULT 'ems',
  status            VARCHAR(20)  NOT NULL DEFAULT 'online'
                      CHECK (status IN ('online', 'offline', 'decommissioned')),
  last_seen_at      TIMESTAMPTZ,
  ems_health        JSONB,                          -- [hotfix] emsList 系統健康快照
  ems_health_at     TIMESTAMPTZ,                    -- [hotfix] emsList 最後更新時間
  commissioned_at   TIMESTAMPTZ  DEFAULT NOW(),
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gateways_org ON gateways(org_id);
CREATE INDEX IF NOT EXISTS idx_gateways_home ON gateways(home_id);
CREATE INDEX IF NOT EXISTS idx_gateways_status ON gateways(status);

-- RLS: tenant isolation
ALTER TABLE gateways ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_gateways_tenant ON gateways
  USING (org_id = current_setting('app.current_org_id', true));
```

### 6.2 Table: `device_command_logs`

（無變更，與原設計相同）

```sql
CREATE TABLE IF NOT EXISTS device_command_logs (
  id                BIGSERIAL    PRIMARY KEY,
  gateway_id        VARCHAR(50)  NOT NULL REFERENCES gateways(gateway_id),
  client_id         VARCHAR(100) NOT NULL,
  command_type      VARCHAR(20)  NOT NULL
                      CHECK (command_type IN ('get', 'get_reply', 'set', 'set_reply')),
  config_name       VARCHAR(100) NOT NULL DEFAULT 'battery_schedule',
  message_id        VARCHAR(50),
  payload_json      JSONB,
  result            VARCHAR(20),       -- 'success' | 'fail' | 'pending' | 'timeout'
  error_message     TEXT,
  device_timestamp  TIMESTAMPTZ,       -- parsed from payload.timeStamp
  resolved_at       TIMESTAMPTZ,       -- when reply received
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cmd_logs_gateway ON device_command_logs(gateway_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cmd_logs_message ON device_command_logs(gateway_id, message_id);
CREATE INDEX IF NOT EXISTS idx_cmd_logs_pending ON device_command_logs(result) WHERE result = 'pending';
```

### 6.3 `assets` Table Extension

```sql
-- Add gateway_id FK to assets
ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS gateway_id VARCHAR(50) REFERENCES gateways(gateway_id);

CREATE INDEX IF NOT EXISTS idx_assets_gateway ON assets(gateway_id);
```

### 6.4 `telemetry_history` Table Extension

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
```

**Design Decision — Hybrid Column + JSONB Strategy:**
- **Dedicated columns** for fields actively queried by M2/M3/M4 (battery, grid totals, PV totals, DO state)
- **JSONB `telemetry_extra`** for: per-phase detail (grid/load/flload), meter data (single + three), dido DI, PV MPPT detail
- This avoids adding 60+ columns to a time-series partitioned table while keeping hot-path queries efficient

### 6.5 Hotfix DDL Delta

實際 hotfix migration 只需新增 gateways 表的兩個欄位（其餘 DDL 已在 migration_v5.18.sql 中）：

```sql
-- hotfix: add ems_health columns to gateways
ALTER TABLE gateways
  ADD COLUMN IF NOT EXISTS ems_health JSONB;

ALTER TABLE gateways
  ADD COLUMN IF NOT EXISTS ems_health_at TIMESTAMPTZ;

COMMENT ON COLUMN gateways.ems_health IS
  'Latest emsList snapshot: CPU/memory/disk/temp/network status. Updated each telemetry cycle.';
COMMENT ON COLUMN gateways.ems_health_at IS
  'Timestamp of last emsList update, from device clock (payload.timeStamp).';
```

---

## 7. Domain Model Types

### 7.1 SolfacilMessage (Protocol Envelope)

```
interface SolfacilMessage {
  readonly DS: number;
  readonly ackFlag: number;
  readonly clientId: string;
  readonly deviceName: string;
  readonly productKey: string;
  readonly messageId: string;
  readonly timeStamp: string;          // epoch ms as string
  readonly data: Record<string, unknown>;
}
```

### 7.2 DomainSchedule

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

### 7.3 FragmentAssembler Types（v5.18 hotfix 新增）

```
interface GatewayFragments {
  readonly clientId: string;
  readonly recordedAt: Date;           // from first fragment's timeStamp
  ems?: EmsHealthSnapshot;             // from emsList
  dido?: DidoSnapshot;                 // from dido
  meters: MeterSnapshot[];             // from meterList (0-2 entries)
  core?: CoreTelemetrySnapshot;        // from batList 大包
}

interface EmsHealthSnapshot {
  readonly cpuTemp: number;
  readonly cpuUsage: number;
  readonly diskUsage: number;
  readonly memoryUsage: number;
  readonly emsTemp: number;
  readonly humidity: number;
  readonly simStatus: number;
  readonly phoneStatus: number;
  readonly phoneSignalStrength: number;
  readonly wifiStatus: number;
  readonly wifiSignalStrength: number;
  readonly hardwareTime: number;
  readonly systemTime: number;
  readonly systemRuntime: number;
}

interface DidoSnapshot {
  readonly di0: number;
  readonly di1: number;
  readonly do0: boolean;               // "1" → true
  readonly do1: boolean;               // "1" → true
}

interface MeterSnapshot {
  readonly deviceSn: string;
  readonly deviceBrand: string;        // for Single/Three classification
  readonly connectStatus: string;
  readonly properties: Record<string, string>;
}
```

---

## 8. What Stays Unchanged from v5.16

| Component | Status | Notes |
|-----------|--------|-------|
| `message-buffer.ts` | Retained, no change | INSERT columns already correct from v5.18 PR |
| `device-asset-cache.ts` | Retained | Still resolves serial_number → asset_id |
| `telemetry-5min-aggregator.ts` | Unchanged | Uses existing hot-path columns only |
| `telemetry-aggregator.ts` (hourly) | Unchanged | Uses existing hot-path columns only |
| `state-updater.ts` | Unchanged | |
| All M2/M3/M4 modules | Unchanged | They consume existing columns; new fields are additive |
| `schedule-translator.ts` | Unchanged | Bidirectional translation already correct |
| `command-tracker.ts` | Unchanged | get_reply/set_reply handling already correct |
| `heartbeat-handler.ts` | Unchanged | |
| `device-list-handler.ts` | Unchanged | Already handles deviceList from S1 |

---

## 9. Error Handling

| Scenario | Behavior |
|----------|----------|
| MQTT parse error (malformed JSON) | Log error, skip message, continue |
| Unknown clientId (not in gateways table) | Log warning, skip message |
| deviceList UPSERT failure | Log error, skip batch, continue |
| Telemetry INSERT failure | Log error (MessageBuffer existing behavior) |
| Schedule validation failure | Throw `ScheduleValidationError`, DO NOT publish |
| MQTT broker disconnect | Auto-reconnect (reconnectPeriod: 5000ms) |
| DB connection failure | Crash + systemd restart (existing behavior) |
| Fragment timeout (no MSG#5 within 3s) | Flush ems_health only, discard incomplete fragments, log warning |
| emsList parse error | Log warning, skip ems_health update |
| dido parse error | Log warning, DO0/DO1 fall back to false |
| subDevices/get publish failure | Log error, continue (next hourly poll will retry) |

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
| **v5.18-hotfix** | **2026-03-09** | **Fragmented Payload handling: FragmentAssembler for MSG#1-5 merge, emsList→gateways.ems_health, dido DO0/DO1→telemetry_history (replace false hardcode), dual meterList→telemetry_extra (meter_single + meter_three), Protocol v1.2: +subDevices/get publish + hourly polling** |
