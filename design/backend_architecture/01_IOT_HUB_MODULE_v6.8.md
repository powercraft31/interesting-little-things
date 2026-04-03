# M1: IoT Hub Module — MQTT 協議接入層

> **Module Version**: v6.8 (Protocol V2.4 alignment + alarm handler)
> **Git HEAD**: `b94adf3`
> **Parent**: [00_MASTER_ARCHITECTURE_v6.8.md](./00_MASTER_ARCHITECTURE_v6.8.md)
> **Last Updated**: 2026-04-02
> **Description**: Full Solfacil Protocol V2.4 integration — 7 subscribe + 4 publish topics, anti-corruption layer, gateway registry, command pipeline, backfill infrastructure, gateway outage event tracking, telemetry-triggered gap detection, alarm event processing
> **Core Theme**: Adapter-pattern telemetry normalization, fragment assembly pipeline, gateway outage lifecycle management, V2.4 protocol alignment

---

## Changes from v5.22

| Component | Before (v5.22) | After (v6.8) |
|-----------|---------------|--------------|
| Backfill trigger | HeartbeatHandler reconnect detection（CTE + gap > 2min → `backfill_requests`） | **TelemetryHandler** gap detection: telemetry stream gap > 5 min → `INSERT backfill_requests`（v6.1）；HeartbeatHandler 不再觸發 backfill |
| HeartbeatHandler | Reconnect detection + backfill_requests INSERT | Connectivity recovery only: close open `gateway_outage_events` on reconnect; **no backfill** trigger（v6.1） |
| Watchdog threshold | 10 min (`OFFLINE_THRESHOLD_MS = 600_000`) | **30 min** (`OFFLINE_THRESHOLD_MS = 1_800_000`)（v6.8, V2.4 heartbeat 300s × 6） |
| Gateway outage events | 無 | `gateway_outage_events` 表 + watchdog writes outage on offline + HeartbeatHandler closes on reconnect + **5-min flap consolidation**（v6.1） |
| Fragment scaling | `safeFloat()` 直接透傳原始值 | Protocol V2.4 scaling helpers: `scaleVoltage(×0.1)`, `scaleCurrent(×0.1)`, `scaleTemp(×0.1)`, `scalePowerKw(÷1000)`, `scaleEnergyKwh(×0.1)`, `scaleFrequency(×0.01)`, `scalePowerFactor(×0.001)` |
| DynamicAdapter | Phase 6.4: direct mode only | Direct + **Iterator mode**: one payload → N envelopes（e.g. battery array via `rule.iterator` path）（v6.4） |
| parseTelemetryPayload | Core 大包直接取第一個 pvList item | **findPvSummary / findPvMppt**: 按 `name` 分離 PV summary（`name="pv"`）與 MPPT items（`pv1`/`pv2`）；telemetry_extra 增加 `ems_health` subsection |
| ingest-telemetry.ts | ACL only（NativeAdapter / HuaweiAdapter） | AppConfig 動態解析規則優先 → DynamicAdapter（Phase 6.4）→ Legacy mapping → ACL fallback |
| Timestamps | `parseInt(payload.timeStamp, 10)` → epoch ms | `parseProtocolTimestamp()` — V2.4 UTC-3 string + V1.x epoch ms backward compat（shared/protocol-time.ts） |
| Alarm handler | 無 | **NEW** `alarm-handler.ts`: `device/ems/{cid}/alarm` → `gateway_alarm_events` INSERT + `pg_notify('alarm_event')`（V2.4） |
| Subscribe topics | 6 per gateway（S1–S6） | **7 per gateway**（S1–S7）：+S7 `device/ems/{cid}/alarm` → `handleAlarm()`（V2.4） |
| Power factor scaling | 無 | `scalePowerFactor(×0.001)`: grid_factorA/B/C, meter grid_factor/factorA/B/C（V2.4） |
| Schedule field naming | `gridImportLimitKw` (misnomer) | V2.4: `gridImportLimitW` preferred（value is watts）, `gridImportLimitKw` retained as deprecated alias |
| Backfill timestamps | `data: { start: String(epochMs), end: String(epochMs) }` | V2.4: `epochMsToProtocolTimestamp()` → UTC-3 business time strings |
| MissedData progress | 無 | V2.4: `total`/`index` tracking in backfill responses, empty response detection (total=0, index=0) |
| CommandTracker V2.4 | `set_reply.messageId` echoes original request | V2.4: `set_reply.messageId` is independent; matching on (gateway_id, config_name, command_type, result) |
| File count | 26 files | **27 files**（+alarm-handler.ts） |

---

## 1. Architecture Overview

```
                  ┌────────────────────────────────────────────────────────┐
                  │              MQTT Broker                                │
                  │         18.141.63.142:1883                              │
                  └──┬──────┬──────┬──────┬──────┬──────┬──────┬──────────┘
                     │S1    │S2    │S3    │S4    │S5    │S6    │S7
                     ▼      ▼      ▼      ▼      ▼      ▼      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    M1 IoT Hub (v6.8)                                         │
│                                                                              │
│  ┌──────────────┐  ┌──────────────────────────────────────────────────────┐ │
│  │ Gateway       │  │ Anti-Corruption Layer (ACL)                          │ │
│  │ Connection    │  │                                                      │ │
│  │ Manager       │  │  S1 → DeviceListHandler  → assets                   │ │
│  │               │  │  S2 → TelemetryHandler   → telemetry_*              │ │
│  │  reads        │  │       ├─ FragmentAssembler (merge 5 msgs)            │ │
│  │  gateways     │  │       │   └─ parseTelemetryPayload (shared)          │ │
│  │  table        │  │       │       └─ Protocol V2.4 scaling               │ │
│  │               │  │       ├─ EmsListProcessor → gateways                 │ │
│  │  subscribes   │  │       ├─ DidoProcessor    → DO0/DO1                  │ │
│  │  7 topics/gw  │  │       └─ Gap detection (>5min) → backfill            │ │
│  │               │  │  S3 → CommandTracker     → cmd_logs                 │ │
│  │  watchdog     │  │  S4 → CommandTracker     → cmd_logs                 │ │
│  │  30min        │  │       └─ two-phase: accepted→success/fail            │ │
│  │               │  │  S5 → HeartbeatHandler   → gateways                 │ │
│  │  outage       │  │       └─ reconnect → close outage_events            │ │
│  │  events       │  │  S6 → AlarmHandler       → alarm_events             │ │
│  └──────┬───────┘  │       └─ pg_notify('alarm_event')                    │ │
│         │          │  S7 → MissedDataHandler  → telemetry_*              │ │
│         ▼          │       └─ BackfillAssembler (dedup INSERT)             │ │
│    ┌─────────┐     │                                                      │ │
│    │gateways │     │  P1 ← ScheduleTranslator  ← BFF                      │ │
│    │  table  │     │  P2 ← CommandPublisher    ← poll dispatched           │ │
│    └─────────┘     │  P3 ← SubDevicesPoller    ← Timer/Startup            │ │
│                    │  P4 ← BackfillRequester   ← poll backfill_*          │ │
│                    └──────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────┐           │
│  │ Services                                                      │           │
│  │  CommandPublisher   — polls dispatched → MQTT config/set      │           │
│  │  BackfillRequester  — polls backfill_requests → get_missed    │           │
│  │  5min Aggregator    — cron */5 → asset_5min_metrics           │           │
│  │  Hourly Aggregator  — cron :05 → asset_hourly_metrics         │           │
│  └──────────────────────────────────────────────────────────────┘           │
└─────────────────────────────────────────────────────────────────────────────┘
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
M1 GatewayConnectionManager.start(pool, handlers)
  │
  ├─ SELECT * FROM gateways WHERE status != 'decommissioned'
  │
  ├─ For each gateway:
  │    ├─ mqtt.connect(broker_host:broker_port, {username, password})
  │    ├─ Subscribe to 7 topics (S1–S7)
  │    ├─ Store client handle in gatewayClients Map
  │    └─ Publish subDevices/get (initial device list pull)
  │
  ├─ Start heartbeat watchdog (60s interval)
  │    └─ For each gateway: if NOW() - last_seen_at > 1800s → status='offline'
  │       └─ Write gateway_outage_events (with 5-min flap consolidation)
  │
  ├─ Start CommandPublisher (poll every 10s)
  ├─ Start BackfillRequester (poll every 10s)
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
| S6 | `device/ems/{cid}/data/missed` | `handleMissedData()` |
| S7 | `device/ems/{cid}/alarm` | `handleAlarm()` |

### 2.3 Per-Gateway Publish Topics

| # | Topic Pattern | Trigger | Purpose |
|---|---------------|---------|---------|
| P1 | `platform/ems/{cid}/config/get` | BFF / 每 1 小時 | 請求目前配置 |
| P2 | `platform/ems/{cid}/config/set` | CommandPublisher poll | 推送新排程（pipeline） |
| P3 | `platform/ems/{cid}/subDevices/get` | 首次連線 + 每 1 小時 | 請求設備清單 |
| P4 | `platform/ems/{cid}/data/get_missed` | BackfillRequester poll | 請求歷史遺漏資料 |

### 2.4 Connection Configuration

Two runtime types are used:

```typescript
// shared/types/solfacil-protocol.ts — DB row from gateways table
interface GatewayRecord {
  readonly gateway_id: string;          // device serial (e.g. WKRD24070202100144F)
  readonly org_id: string;
  readonly mqtt_broker_host: string;    // 18.141.63.142
  readonly mqtt_broker_port: number;    // 1883
  readonly mqtt_username: string;       // xuheng
  readonly mqtt_password: string;       // xuheng8888!
  readonly name: string;
  readonly status: "online" | "offline" | "decommissioned";
  readonly last_seen_at: Date | null;
}

// services/gateway-connection-manager.ts — runtime handle
interface GatewayClient {
  readonly gatewayId: string;
  readonly clientId: string;   // solfacil-m1-{gatewayId}-{MQTT_CLIENT_SUFFIX ?? process.pid}
  readonly mqttClient: unknown; // mqtt.MqttClient at runtime
}
```

- **Reconnect**: `reconnectPeriod: 5000` (auto-reconnect on disconnect)
- **QoS**: 1 for all subscriptions
- **Clean session**: true (no persistent session)
- **No wildcard**: 每個網關獨立訂閱（共用 broker）
- **Client ID**: `solfacil-m1-{gatewayId}-{MQTT_CLIENT_SUFFIX ?? process.pid}`（env var 優先，防止多實例衝突）

### 2.5 Message Routing

```typescript
routeMessage(gatewayId, clientId, topic, payload):
  if (topic.endsWith("/deviceList"))       → onDeviceList
  else if (topic.endsWith("/data/missed")) → onMissedData  // 必須在 /data 之前
  else if (topic.endsWith("/data"))        → onTelemetry
  else if (topic.endsWith("/config/get_reply")) → onGetReply
  else if (topic.endsWith("/config/set_reply")) → onSetReply
  else if (topic.endsWith("/alarm"))       → onAlarm       // V2.4 NEW
  else if (topic.endsWith("/status"))      → onHeartbeat
```

> **Routing order matters**: `/data/missed` must be matched before `/data` to prevent backfill messages being routed to the live telemetry handler.

### 2.6 Dynamic Gateway Addition

MVP 方式：M1 每 60s 輪詢 `gateways` 表找新記錄。若發現新網關（不在 `gatewayClients` Map 中），訂閱其 7 個 topic。

---

## 3. Telemetry Pipeline

### 3.1 Pipeline Overview

```
  MQTT raw message
        │
        ▼
  TelemetryHandler.handleTelemetry()
        │
        ├─ Gap detection (>5min → backfill_requests)   ← v6.1 NEW
        │
        ▼
  FragmentAssembler.receive()
        │
        ├─ classifyAndAccumulate()
        │     emsList → acc.ems
        │     dido    → acc.dido
        │     meterList → acc.meters (append)
        │     batList → acc.core (trigger flush)
        │
        ├─ Core arrived? → immediate flush
        │   else → 3s debounce timer
        │
        ▼
  mergeAndPersist()
        │
        ├─ Step 1: writeEmsHealth → gateways.ems_health
        │          pg_notify('gateway_health')
        │
        ├─ Step 2: parseTelemetryPayload() ← shared pure function
        │          │
        │          ├─ Protocol V2.4 scaling
        │          │   scaleVoltage(×0.1), scaleCurrent(×0.1)
        │          │   scaleTemp(×0.1), scalePowerKw(÷1000)
        │          │   scaleEnergyKwh(×0.1), scaleFrequency(×0.01)
        │          │   scalePowerFactor(×0.001)
        │          │
        │          ├─ findPvSummary/findPvMppt (name-based PV routing)
        │          │
        │          └─ buildTelemetryExtra (per-phase JSONB)
        │
        ├─ Step 3: DeviceAssetCache.resolve(deviceSn) → assetId
        │
        ├─ Step 4: MessageBuffer.enqueue(assetId, parsed)
        │          → INSERT telemetry_history (2s debounce)
        │
        ├─ Step 5: updateDeviceState → UPSERT device_state
        │
        └─ Step 6: pg_notify('telemetry_update')
```

### 3.2 Fragmented Payload 處理機制

每個網關每 30 秒（生產為 5 分鐘）發送 **5 條獨立 MQTT 消息**，全部走 `device/ems/{gatewayId}/data` topic，在 ~800ms 內連續到達：

| 序號 | 消息內容 | 大小 | 間隔 | 特徵 |
|------|---------|------|------|------|
| MSG#1 | `emsList`（EMS 系統狀態） | 718B | 起點 | 無 batList、無 deviceSn（用 gatewayId） |
| MSG#2 | `dido`（數字 IO） | 630B | +140ms | 無 batList、有 DI/DO 值 |
| MSG#3 | `meterList`（單相電表） | 851B | +132ms | 無 batList、有獨立 deviceSn |
| MSG#4 | `meterList`（三相電表） | 1556B | +150ms | 無 batList、有獨立 deviceSn |
| MSG#5 | `batList+gridList+loadList+flloadList+pvList` | 3278B | +357ms | 有 batList（大包） |

### 3.3 Fragment Assembler Design

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
              │  key = payload.clientId  │
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
              │  4. pg_notify           │ ← SSE 通知
              └─────────────────────────┘
```

**分類邏輯** — `classifyAndAccumulate()` 處理 data 物件中所有存在的頂層 key（非互斥，一條消息可同時包含多個 key）：

```typescript
classifyAndAccumulate(acc, data):
  if (data.emsList)   → acc.ems = emsList[0]
  if (data.dido)      → acc.dido = data.dido
  if (data.meterList) → acc.meters = [...acc.meters, ...meterList]   // 追加
  if (data.batList)   → acc.core = data; isCoreMessage = true        // 大包
  return isCoreMessage
```

**Debounce 策略**：

| 觸發條件 | 動作 | 理由 |
|----------|------|------|
| `batList` 到達（MSG#5） | 清除 timer，立即 flush | MSG#5 最後到達（+357ms），前 4 條已在 cache |
| 3s debounce timer 到期 | flush（僅寫 ems_health） | 防止 MSG#5 丟失時 ems_health 也丟 |

### 3.4 Protocol V2.4 Scaling Helpers

所有原始欄位均為整數字串，雲端負責套用縮放因子：

| Helper | Factor | Application |
|--------|--------|-------------|
| `scaleVoltage` | ×0.1 | 電壓欄位（V） |
| `scaleCurrent` | ×0.1 | 電流欄位（A） |
| `scaleTemp` | ×0.1 | 溫度欄位（℃） |
| `scalePowerKw` | ÷1000 | 功率欄位（W→kW） |
| `scalePowerW` | ×1 | per-phase 功率（W，保留於 telemetry_extra） |
| `scaleEnergyKwh` | ×0.1 | 能量欄位（→kWh） |
| `scaleFrequency` | ×0.01 | 頻率欄位（Hz） |
| `scalePowerFactor` | ×0.001 | 功率因數（power factor）— grid_factorA/B/C, meter grid_factor* |
| `safeFloat` | ×1 | 安全 parseFloat：undefined/null/empty/NaN → 0 |

### 3.5 PV List Routing

`pvList` 可包含多個 items，按 `name` 欄位分離：

```typescript
findPvSummary(pvList):  → pvList.find(p => p.name === "pv") ?? pvList[0]
findPvMppt(pvList, "pv1"): → pvList.find(p => p.name === "pv1")
findPvMppt(pvList, "pv2"): → pvList.find(p => p.name === "pv2")
```

- **Summary** (`pv_totalPower`, `pv_dailyEnergy`) → `telemetry_history` 實體欄位
- **MPPT** (`pv1_voltage/current/power`, `pv2_*`) → `telemetry_extra.pv` JSONB

### 3.6 Telemetry Gap Detection (v6.1)

**Source**: `telemetry-handler.ts`
**Threshold**: `BACKFILL_GAP_THRESHOLD_MS = 300_000` (5 minutes)

```typescript
checkTelemetryGap(pool, gatewayId, currentTime: Date):
  previousTime = lastTelemetryCache.get(gatewayId)
  lastTelemetryCache.set(gatewayId, currentTime)

  if (previousTime === undefined) return    // first message since startup
  gapMs = currentTime.getTime() - previousTime.getTime()

  if (gapMs > 300_000):
    INSERT INTO backfill_requests (gateway_id, gap_start, gap_end, status)
    VALUES ($gatewayId, prev_time, current_time, 'pending')
```

> **v6.1 Design Change**: Backfill trigger 從 HeartbeatHandler 移到 TelemetryHandler。原因：遙測流本身才能準確判斷資料間隙，心跳僅表示連線存活。

---

## 4. Adapter Pattern (Anti-Corruption Layer)

### 4.1 TelemetryAdapter Interface

```typescript
interface TelemetryAdapter {
  readonly source: StandardTelemetry['source'];
  canHandle(payload: unknown): boolean;
  normalize(raw: unknown, orgId: string): StandardTelemetry;
}
```

所有廠商專屬適配器實現此接口，將專有負載轉換為標準 `StandardTelemetry` 格式。

### 4.2 StandardTelemetry Normalized Format

```typescript
interface StandardTelemetry {
  // ── Identity（身份欄位）──
  readonly orgId: string;
  readonly deviceId: string;
  readonly timestamp: string;          // ISO 8601 UTC
  readonly source: "mqtt" | "huawei" | "sungrow" | "generic-rest";
  readonly isOnline?: boolean;
  readonly errorCode?: string;

  // ── Business Trinity 靈活容器 ──
  readonly metering?: Readonly<Record<string, number>>;
  readonly status?: Readonly<Record<string, number | string | boolean>>;
  readonly config?: Readonly<Record<string, number | string>>;

  // ── 原始負載（審計用）──
  readonly rawPayload?: unknown;
}
```

**Business Trinity 設計**：三個靈活容器取代扁平業務字段：
- **metering** — 計量指標（數值型，可聚合），如 `metering.grid_power_kw`
- **status** — 設備狀態（數值/字串/布林），如 `status.battery_soc`
- **config** — 配置參數（數值/字串），如 `config.max_charge_current`

**Type-safe casting** — `castValue()` 函式：
```typescript
castValue(raw, "number")  → number  (throws on null/NaN)
castValue(raw, "string")  → string
castValue(raw, "boolean") → boolean
```

### 4.3 AdapterRegistry

```typescript
const ADAPTERS: readonly TelemetryAdapter[] = [
  new HuaweiAdapter(),   // 優先嘗試
  new NativeAdapter(),   // 降級
];

resolveAdapter(payload): TelemetryAdapter
  → ADAPTERS.find(a => a.canHandle(payload))
  → throws Error if no match
```

### 4.4 NativeAdapter

處理 Solfacil 自有設備直接發布的扁平 MQTT 格式。

| 偵測條件 | `canHandle` |
|----------|-------------|
| `typeof payload.deviceId === 'string' && typeof payload.power === 'number'` | true |

| 原始欄位 | StandardTelemetry 欄位 | 類型 |
|----------|----------------------|------|
| `power` | `metering.grid_power_kw` | number |
| `voltage` | `metering.grid_voltage_v` | number (optional) |
| `current` | `metering.grid_current_a` | number (optional) |
| `soc` | `status.battery_soc` | number (optional) |

### 4.5 HuaweiAdapter

處理華為 FusionSolar 格式（`devSn` + `dataItemMap`）。

| 偵測條件 | `canHandle` |
|----------|-------------|
| `typeof payload.devSn === 'string' && typeof payload.dataItemMap === 'object'` | true |

| 原始欄位 | StandardTelemetry 欄位 | 轉換 |
|----------|----------------------|------|
| `dataItemMap.active_power` | `metering.grid_power_kw` | W ÷ 1000 → kW |
| `dataItemMap.mppt_total_cap` | `metering.mppt_total_cap_kwh` | 透傳 |
| `dataItemMap.grid_voltage` | `metering.grid_voltage_v` | 透傳 |
| `dataItemMap.grid_current` | `metering.grid_current_a` | 透傳 |
| `dataItemMap.battery_soc` | `status.battery_soc` | 透傳 |
| `collectTime` | `timestamp` | Unix ms → ISO 8601 |

### 4.6 DynamicAdapter (Phase 6.4)

根據 ParserRule 定義（Global Data Dictionary / AppConfig）動態轉換，支援兩種模式：

**Direct mode**: 一個 payload → 一個 StandardTelemetry envelope
```typescript
rule.iterator === undefined → [buildEnvelope(rawPayload, rule.mappings, orgId, deviceId)]
```

**Iterator mode**: 一個 payload → N 個 envelopes
```typescript
rule.iterator = "data.batteries"  // dot-notation path
→ items = getNestedValue(rawPayload, "data.batteries")  // Array
→ items.map(item => buildEnvelope(item, rule.mappings, orgId, ...))
```

| ParserRule 欄位 | 用途 |
|----------------|------|
| `parserType` | `"dynamic"` 標識使用 DynamicAdapter |
| `iterator` | dot-notation path → 解析為陣列，每個元素生成一個 envelope |
| `deviceIdPath` | 從每個 record 中提取 deviceId 的路徑 |
| `mappings` | `{ [fieldId]: { sourcePath, valueType, domain } }` |

`mappings.domain` 決定歸屬：
- `"metering"` → `metering` 容器
- `"status"` → `status` 容器
- `"config"` → `config` 容器

**Nested value resolution**: `getNestedValue(obj, "data.batteries[0].soc")` supports dot-notation + array index.

**Phantom ID protection**: 若 `deviceIdPath` 解析為 null/undefined/empty，該 record 被跳過（不生成 phantom envelopes）。

### 4.7 XuhengAdapter

處理旭恒 EMS 協議（Solfacil Protocol v1.2）。用於 `mqtt-subscriber.ts`（legacy 單 topic 路徑）。

```typescript
class XuhengAdapter {
  parse(raw: XuhengRawMessage): ParsedTelemetry | null
}
```

從 `batList[0]` 提取主設備，合併 `pvList`、`gridList`、`loadList`、`flloadList` 和 `dido` 的數據。

### 4.8 Ingestion Handler (ingest-telemetry.ts)

Lambda handler 處理來自 IoT Rule 的遙測事件。解析優先順序：

```
1. AppConfig Dynamic ParserRule (parserType="dynamic")
   → DynamicAdapter.parse() → Timestream + EventBridge
2. AppConfig Legacy mappingRule
   → applyDynamicMapping() → dynamicMappedToTelemetry() → Timestream + EventBridge
3. ACL resolveAdapter()
   → HuaweiAdapter.normalize() / NativeAdapter.normalize() → Timestream + EventBridge
4. Fallback: minimal StandardTelemetry from raw
```

Each ingested record is written to **Amazon Timestream** and published to **EventBridge** as `TelemetryIngested` event with `traceId`.

---

## 5. Topic Handlers (Anti-Corruption Layer)

### 5.1 DeviceListHandler

**Subscribe**: `device/ems/{gatewayId}/deviceList`
**Source**: `device-list-handler.ts`
**Persistence**: `assets` table UPSERT

```
handleDeviceList(pool, gatewayId, _clientId, payload):
  1. Parse payload.data.deviceList[] — filter nodeType === "major"
  2. Look up gateways.org_id for asset FK population
  3. For each major device: UPSERT into assets
     - asset_id = deviceSn (deterministic)
     - serial_number, name, brand, model, asset_type, gateway_id, org_id
     - rated_max_power_kw, rated_max_current_a, rated_min_power_kw, rated_min_current_a
  4. Soft-delete reconciliation:
     - Active devices in DB NOT in incoming list → is_active = false
     - ABSOLUTELY NO DELETE — financial audit trail must survive
```

**Protocol Field → Domain Mapping:**

| Protocol Field | DB Column | Notes |
|---------------|-----------|-------|
| `deviceSn` | `assets.asset_id` / `serial_number` | 主要查詢 key |
| `name` | `assets.name` | e.g. "GoodWe-1" |
| `vendor` | `assets.brand` | e.g. "GoodWe" |
| `deviceBrand` | `assets.model` | e.g. "inverter-goodwe-Energystore" |
| `productType` | `assets.asset_type` | meter→SMART_METER, inverter→INVERTER_BATTERY |
| `nodeType` | 過濾 | 僅處理 "major" |
| `maxPower` | `assets.rated_max_power_kw` | 額定最大功率 |
| `maxCurrent` | `assets.rated_max_current_a` | 額定最大電流 |
| `minPower` | `assets.rated_min_power_kw` | 額定最小功率 |
| `minCurrent` | `assets.rated_min_current_a` | 額定最小電流 |

### 5.2 TelemetryHandler (Fragment-Aware + Gap Detection)

**Subscribe**: `device/ems/{gatewayId}/data`
**Source**: `telemetry-handler.ts`
**Persistence**: `telemetry_history`（via MessageBuffer）、`device_state`、`gateways.ems_health`

```
handleTelemetry(pool, gatewayId, _clientId, payload):
  1. v6.1: checkTelemetryGap(pool, gatewayId, currentTs)
     → if gap > 5min: INSERT backfill_requests
  2. assembler.receive(payload.clientId, payload)
     → FragmentAssembler handles classification + accumulation + flush
```

**鐵律 — TimeStamp Rule:**
所有 `recorded_at` 值必須從 `payload.timeStamp`（V2.4 UTC-3 string or V1.x epoch ms, parsed via `parseProtocolTimestamp()`）解析。伺服器端 `NOW()` **禁止**用於遙測寫入。

#### 5.2.1 Complete Field Mappings — MSG#5 大包

**batList (Battery) — 13 fields → telemetry_history 實體欄位：**

| Protocol Field (`properties.*`) | ParsedTelemetry Field | DB Column | Scale | Unit |
|------|------|------|------|------|
| `total_bat_soc` | `batterySoc` | `battery_soc` | ×1 | % |
| `total_bat_soh` | `batterySoh` | `battery_soh` | ×1 | % |
| `total_bat_power` | `batteryPowerKw` | `battery_power` | ÷1000 | kW |
| `total_bat_current` | `batteryCurrent` | `battery_current` | ×0.1 | A |
| `total_bat_vlotage` | `batteryVoltage` | `battery_voltage` | ×0.1 | V |
| `total_bat_temperature` | `batteryTemperature` | `battery_temperature` | ×0.1 | ℃ |
| `total_bat_maxChargeCurrent` | `maxChargeCurrent` | `max_charge_current` | ×0.1 | A |
| `total_bat_maxDischargeCurrent` | `maxDischargeCurrent` | `max_discharge_current` | ×0.1 | A |
| `total_bat_dailyChargedEnergy` | `dailyChargeKwh` | `daily_charge_kwh` | ×0.1 | kWh |
| `total_bat_dailyDischargedEnergy` | `dailyDischargeKwh` | `daily_discharge_kwh` | ×0.1 | kWh |
| `total_bat_maxChargeVoltage` | `maxChargeVoltage` | (parsed, not persisted) | ×0.1 | V |
| `total_bat_totalChargedEnergy` | `totalChargeKwh` | (parsed, not persisted) | ×0.1 | kWh |
| `total_bat_totalDischargedEnergy` | `totalDischargeKwh` | (parsed, not persisted) | ×0.1 | kWh |

**gridList (Inverter Grid-Side) — Hot-path + JSONB：**

| Protocol Field | DB Location | Scale | Notes |
|------|------|------|------|
| `grid_totalActivePower` | `telemetry_history.grid_power_kw` | ÷1000 | Hot-path: M2/M3 |
| `grid_dailyBuyEnergy` | `telemetry_history.grid_import_kwh` | ×0.1 | Hot-path: M4 計費 |
| `grid_dailySellEnergy` | `telemetry_history.grid_export_kwh` | ×0.1 | Hot-path: M4 計費 |
| `grid_temp` | `telemetry_history.inverter_temp` | ×0.1 | Health monitoring |
| `grid_voltA/B/C` | `telemetry_extra.grid.volt_a/b/c` | ×0.1 | 診斷用 |
| `grid_currentA/B/C` | `telemetry_extra.grid.current_a/b/c` | ×0.1 | 診斷用 |
| `grid_activePowerA/B/C` | `telemetry_extra.grid.active_power_a/b/c` | ×1 W | 診斷用 |
| `grid_reactivePowerA/B/C` | `telemetry_extra.grid.reactive_power_a/b/c` | ×1 W | 診斷用 |
| `grid_totalReactivePower` | `telemetry_extra.grid.total_reactive_power` | ×1 W | 診斷用 |
| `grid_apparentPowerA/B/C` | `telemetry_extra.grid.apparent_power_a/b/c` | ×1 W | 診斷用 |
| `grid_totalApparentPower` | `telemetry_extra.grid.total_apparent_power` | ×1 W | 診斷用 |
| `grid_factorA/B/C` | `telemetry_extra.grid.factor_a/b/c` | ×0.001 | 診斷用（V2.4 `scalePowerFactor`） |
| `grid_frequency` | `telemetry_extra.grid.frequency` | ×0.01 | 診斷用 |
| `grid_totalBuyEnergy` | `telemetry_extra.grid.total_buy_kwh` | ×0.1 | 累計值 |
| `grid_totalSellEnergy` | `telemetry_extra.grid.total_sell_kwh` | ×0.1 | 累計值 |

> **Note**: Meter fields also use `scalePowerFactor(×0.001)` for grid_factor, factorA, factorB, factorC fields.

**pvList (Solar PV)：**

| Protocol Field | DB Location | Scale |
|------|------|------|
| `pv_totalPower` | `telemetry_history.pv_power` | ÷1000 |
| `pv_dailyEnergy` | `telemetry_history.pv_daily_energy_kwh` | ×0.1 |
| `pv_totalEnergy` | `ParsedTelemetry.pvTotalEnergyKwh` | ×0.1 (not persisted) |
| `pv1_voltage/current/power` | `telemetry_extra.pv.pv1_*` | ×0.1/×0.1/×1 W |
| `pv2_voltage/current/power` | `telemetry_extra.pv.pv2_*` | ×0.1/×0.1/×1 W |

**loadList (Backup Load)：**

| Protocol Field | DB Location | Scale |
|------|------|------|
| `load1_totalPower` | `telemetry_history.load_power` | ÷1000 |
| `load1_voltA/B/C` | `telemetry_extra.load.volt_a/b/c` | ×0.1 |
| `load1_currentA/B/C` | `telemetry_extra.load.current_a/b/c` | ×0.1 |
| `load1_activePowerA/B/C` | `telemetry_extra.load.active_power_a/b/c` | ×1 W |
| `load1_frequencyA/B/C` | `telemetry_extra.load.frequency_a/b/c` | ×0.01 |

**flloadList (Home Total Load)：**

| Protocol Field | DB Location | Scale |
|------|------|------|
| `flload_totalPower` | `telemetry_history.flload_power` | ÷1000 |
| `flload_dailyEnergy` | `telemetry_extra.flload.daily_energy_kwh` | ×0.1 |
| `flload_activePowerA/B/C` | `telemetry_extra.flload.active_power_a/b/c` | ×1 W |

**dido (Digital IO)：**

| Protocol Field | DB Location | Conversion |
|------|------|------|
| `DO0` | `telemetry_history.do0_active` | `"1"` → `true` |
| `DO1` | `telemetry_history.do1_active` | `"1"` → `true` |
| `DI0/DI1` | `telemetry_extra.dido.di0/di1` | safeFloat |

**telemetry_extra additional subsections:**

| Key | Source | Content |
|-----|--------|---------|
| `meter_single` | MSG#3 meterList (deviceBrand includes "Single") | 單相電表 7+ fields |
| `meter_three` | MSG#4 meterList (deviceBrand includes "Three") | 三相電表 28+ fields |
| `ems_health` | emsList[0].properties | `wifi_signal_dbm`, `uptime_seconds` |

### 5.3 HeartbeatHandler (v6.1: Connectivity Recovery Only)

**Subscribe**: `device/ems/{gatewayId}/status`
**Source**: `heartbeat-handler.ts`
**Persistence**: `gateways.last_seen_at`、`gateways.status`、`gateway_outage_events`

```
handleHeartbeat(pool, gatewayId, _clientId, payload):
  1. Parse payload.timeStamp via `parseProtocolTimestamp()` → deviceTime (V2.4 UTC-3 or V1.x epoch ms)
  2. Atomic CTE: read prev state + update last_seen_at/status
     WITH prev AS (SELECT last_seen_at, status FROM gateways WHERE gateway_id = $2)
     UPDATE gateways SET last_seen_at = ..., status = 'online'
     RETURNING prev.last_seen_at, prev.status

  3. v6.1: If prev_status !== 'online' (reconnect detected):
     → UPDATE gateway_outage_events SET ended_at = NOW()
       WHERE gateway_id = $1 AND ended_at IS NULL
     (closes open outage event)

  4. pg_notify('gateway_health', gatewayId)
```

> HeartbeatHandler now stores deviceTime as ISO string in `last_seen_at`.

> **v6.1 Design Change**: HeartbeatHandler 不再 INSERT `backfill_requests`。Backfill 觸發責任完全移至 TelemetryHandler（遙測流間隙偵測 > 5 min）。HeartbeatHandler 僅負責連線恢復與 outage event 關閉。

### 5.4 CommandTracker (Two-Phase set_reply)

**Subscribe**: `config/get_reply` + `config/set_reply`
**Source**: `command-tracker.ts`
**Persistence**: `device_command_logs`

**get_reply handling:**
1. Extract `configName`, `batterySchedule` from payload
2. INSERT into `device_command_logs` with `command_type='get_reply'`, `result='success'`
3. Store raw `batterySchedule` as `payload_json` (not parsed via ScheduleTranslator)
4. Update `gateways.updated_at`

**set_reply handling (二階段閉環鐵律):**

```
狀態流轉:
  pending → dispatched → accepted → success
                      ↘            ↗
                        → fail
```

| Phase | `result` value | SQL match | Updates |
|-------|---------------|-----------|---------|
| Phase 1 | `"accepted"` | `WHERE result = 'dispatched'` | `result='accepted'`, `device_timestamp=NOW()` |
| Phase 2 | `"success"` / `"fail"` | `WHERE result IN ('dispatched','accepted')` | `result`, `error_message`, `resolved_at=NOW()` |

If no matching command found → INSERT standalone `set_reply` record (audit trail).

If match found → `pg_notify('command_status', {gatewayId, configName, result})`.

> **V2.4 Note**: `set_reply.messageId` is independent (not echoing the original request). Matching uses (gateway_id, config_name, command_type, result) instead of messageId.

### 5.5 MissedDataHandler (Backfill Data Path)

**Subscribe**: `device/ems/{gatewayId}/data/missed`
**Source**: `missed-data-handler.ts`
**Persistence**: `telemetry_history` (via BackfillAssembler)

```
handleMissedData(pool, gatewayId, clientId, payload):
  → BackfillAssembler.receive(clientId, gatewayId, payload)
```

**V2.4**: Backfill responses include `total`/`index` progress tracking.
Empty responses (total=0, index=0) are detected and return early.
Progress logging: `[MissedData] ${gatewayId}: processing ${index}/${total}`

**BackfillAssembler vs FragmentAssembler:**

| 行為 | FragmentAssembler (live) | BackfillAssembler (backfill) |
|------|------------------------|----------------------------|
| Debounce | 3s | 3s |
| `pg_notify` | `telemetry_update` + `gateway_health` | **不觸發** |
| `updateDeviceState` | UPSERT device_state | **不執行** |
| emsList processing | `gateways.ems_health` | **不處理** |
| INSERT 策略 | 一般 INSERT | `ON CONFLICT (asset_id, recorded_at) DO NOTHING` |
| 解析函式 | `parseTelemetryPayload`（共用） | `parseTelemetryPayload`（共用） |

### 5.6 AlarmHandler (V2.4 NEW)

**Subscribe**: `device/ems/{gatewayId}/alarm`
**Source**: `alarm-handler.ts`
**Persistence**: `gateway_alarm_events` (pure INSERT, no UPSERT)

```
handleAlarm(pool, gatewayId, _clientId, payload):
  1. Extract eventinfo from payload.data (SolfacilAlarmPayload)
  2. Validate eventinfo exists and is object → skip if missing
  3. Query org_id from gateways table (gateway_alarm_events.org_id NOT NULL)
  4. Parse event timestamps via parseProtocolTimestamp():
     - eventCreateTime = parseProtocolTimestamp(ei.createTime)
     - eventUpdateTime = parseProtocolTimestamp(ei.updateTime) [optional]
  5. Pure INSERT into gateway_alarm_events:
     (gateway_id, org_id, device_sn, sub_dev_id, sub_dev_name,
      product_type, event_id, event_name, event_type, level,
      status, prop_id, prop_name, prop_value, description,
      event_create_time, event_update_time)
  6. pg_notify('alarm_event', {gatewayId, orgId, eventId, status, level, subDevId})
```

**Design Decision**: Pure INSERT (not UPSERT) — alarm events are audit-complete records. Each event occurrence is a separate row for compliance and historical analysis.

**SolfacilAlarmPayload type:**

```typescript
interface SolfacilAlarmPayload {
  readonly eventinfo: {
    readonly deviceSn: string;
    readonly subDevId?: string;
    readonly subDevName?: string;
    readonly productType: string;
    readonly eventId: string;
    readonly eventName: string;
    readonly eventType: string;
    readonly level: string;
    readonly status: string;
    readonly propId: string;
    readonly propName: string;
    readonly propValue: string;
    readonly description?: string;
    readonly createTime: string;    // V2.4 UTC-3 timestamp
    readonly updateTime?: string;   // V2.4 UTC-3 timestamp (optional)
  };
}
```

### 5.7 ScheduleTranslator (Bidirectional)

**Source**: `schedule-translator.ts`

**Read direction**: `parseGetReply(batterySchedule) → DomainSchedule | null`

| Protocol (`battery_schedule`) | Domain Model | Translation |
|------|------|------|
| `soc_min_limit` (string) | `socMinLimit` (number) | `parseInt()` |
| `soc_max_limit` (string) | `socMaxLimit` (number) | `parseInt()` |
| `max_charge_current` (string) | `maxChargeCurrent` (number) | `parseInt()` |
| `max_discharge_current` (string) | `maxDischargeCurrent` (number) | `parseInt()` |
| `grid_import_limit` (string) | `gridImportLimitW` (number) | `parseInt()` |
| `slots[]` | `slots[]` | Per-slot: purpose+direction → mode+action |

> **V2.4**: `gridImportLimitW` is the preferred field name (value is watts, not kW). `gridImportLimitKw` retained as deprecated alias for backward compatibility.

**Write direction**: `buildConfigSetPayload(clientId, schedule, messageId) → MQTT message`

All numeric values converted to strings per protocol requirement.

**Validation (Hard Crash)**: `validateSchedule(schedule)` — throws `ScheduleValidationError`:

| Rule | Constraint |
|------|-----------|
| SOC limits | 0 ≤ val ≤ 100, min < max |
| Current limits | Integer, ≥ 0 |
| Grid import limit | Integer, ≥ 0 |
| Slot start | 0–1380, multiple of 60 |
| Slot end | 60–1440, multiple of 60, > start |
| Slot coverage | Union = [0, 1440) exactly |
| Slot overlap | None allowed |

---

## 6. Publish Functions

### 6.1 publishConfigGet

**Topic**: `platform/ems/{gatewayId}/config/get`
**Caller**: BFF + hourly poll

```
publishConfigGet(pool, gatewayId, publish):
  1. messageId = String(Date.now())
  2. Build SolfacilMessage
  3. INSERT device_command_logs: command_type='get', result='pending'
  4. Publish to MQTT
  5. Return messageId
```

### 6.2 publishConfigSet (via CommandPublisher Pipeline)

**Topic**: `platform/ems/{gatewayId}/config/set`
**Caller**: CommandPublisher service (poll `device_command_logs` WHERE `result='dispatched'`)

Pipeline: BFF/M3 writes `device_command_logs` result='pending' → BFF sets 'dispatched' → CommandPublisher polls dispatched → validate → MQTT publish.

### 6.3 publishSubDevicesGet

**Topic**: `platform/ems/{gatewayId}/subDevices/get`
**Caller**: GatewayConnectionManager (on connect + hourly)

### 6.4 publishGetMissed (Backfill Request)

**Topic**: `platform/ems/{gatewayId}/data/get_missed`
**Caller**: BackfillRequester service

```
publishGetMissed(gatewayId, startMs, endMs):
  Build message with data: { start: epochMsToProtocolTimestamp(startMs), end: epochMsToProtocolTimestamp(endMs) }
  Publish via connectionManager.publishToGateway()
```

---

## 7. Services

### 7.1 CommandPublisher

**Source**: `command-publisher.ts`
**Poll interval**: 10s

```
poll():
  BEGIN transaction
  SELECT ... FROM device_command_logs
    WHERE result = 'dispatched' AND command_type = 'set'
    ORDER BY created_at ASC LIMIT 10
    FOR UPDATE SKIP LOCKED

  For each command:
    1. Check gateway online → fail if offline
    2. Validate schedule → fail if invalid
    3. Build protocol message via buildConfigSetPayload()
    4. Publish via connectionManager.publishToGateway()
    5. Update message_id for audit trail
  COMMIT
```

### 7.2 BackfillRequester

**Source**: `backfill-requester.ts`
**Poll interval**: 10s

**Constants:**
| Constant | Value | Purpose |
|----------|-------|---------|
| `POLL_INTERVAL_MS` | 10,000 | 輪詢間隔 |
| `DELAY_AFTER_RECONNECT_MS` | 30,000 | 重連後延遲（讓網關穩定） |
| `COOLDOWN_BETWEEN_CHUNKS_MS` | 20,000 | Chunk 間冷卻 |
| `CHUNK_DURATION_MS` | 1,800,000 | 每 chunk 30 分鐘 |

**Flow:**
```
poll():
  SELECT * FROM backfill_requests
    WHERE status IN ('pending', 'in_progress')
    ORDER BY created_at ASC LIMIT 5
    FOR UPDATE SKIP LOCKED

  For each request:
    if status = 'pending':
      - Wait DELAY_AFTER_RECONNECT_MS since created_at
      - Check gateway connected → fail if offline
      - Publish first chunk, set status = 'in_progress'

    if status = 'in_progress':
      - Check COOLDOWN_BETWEEN_CHUNKS_MS since last_chunk_sent_at
      - Advance to next chunk (current_chunk_start + CHUNK_DURATION_MS)
      - If next >= gap_end → status = 'completed'
      - Else → publish chunk, update current_chunk_start
```

### 7.3 DeviceAssetCache

**Source**: `device-asset-cache.ts`
**Refresh interval**: 5 minutes

In-memory cache mapping `serial_number → asset_id`. Handles XuHeng protocol quirk where telemetry batList uses `"battery_{deviceSn}"` prefix — strips prefix and retries on miss.

```typescript
resolve(deviceSn):
  1. Direct match: cache.get(deviceSn)
  2. XuHeng quirk: if deviceSn.startsWith("battery_") → cache.get(deviceSn.slice(8))
  3. Return null if not found
```

### 7.4 MessageBuffer

**Source**: `message-buffer.ts`
**Debounce**: 2s per asset

Buffers ParsedTelemetry by assetId. Last-write-wins within buffer window. Flushes to `telemetry_history` after debounce.

INSERT columns: `asset_id, recorded_at, battery_soc, battery_power, pv_power, grid_power_kw, load_power, grid_import_kwh, grid_export_kwh, battery_soh, battery_voltage, battery_current, battery_temperature, do0_active, do1_active, flload_power, inverter_temp, pv_daily_energy_kwh, max_charge_current, max_discharge_current, daily_charge_kwh, daily_discharge_kwh, telemetry_extra`

### 7.5 5-Minute Aggregator

**Source**: `telemetry-5min-aggregator.ts`
**Cron**: `*/5 * * * *` (every 5 minutes)

Rolls up `telemetry_history` → `asset_5min_metrics` for the previous 5-min window.

| Output Column | Calculation |
|---------------|-------------|
| `pv_energy_kwh` | AVG(pv_power > 0) × (1/12) |
| `bat_charge_kwh` | AVG(battery_power > 0) × (1/12) |
| `bat_discharge_kwh` | AVG(ABS(battery_power < 0)) × (1/12) |
| `grid_import_kwh` | AVG(grid_power_kw > 0) × (1/12) |
| `grid_export_kwh` | AVG(ABS(grid_power_kw < 0)) × (1/12) |
| `load_kwh` | AVG(load_power) × (1/12) |
| `bat_charge_from_grid_kwh` | Derived: `bat_charge - min(bat_charge, max(0, pv_energy - load))` |
| `avg_battery_soc` | AVG(battery_soc) |

**UPSERT**: `ON CONFLICT (asset_id, window_start) DO UPDATE`

### 7.6 Hourly Aggregator

**Source**: `telemetry-aggregator.ts`
**Cron**: `5 * * * *` (at :05 every hour)

Rolls up `asset_5min_metrics` → `asset_hourly_metrics` for the previous hour.

| Output Column | Calculation |
|---------------|-------------|
| `total_charge_kwh` | SUM(bat_charge_kwh) |
| `total_discharge_kwh` | SUM(bat_discharge_kwh) |
| `pv_generation_kwh` | SUM(pv_energy_kwh) |
| `grid_import_kwh` | SUM(grid_import_kwh) |
| `grid_export_kwh` | SUM(grid_export_kwh) |
| `load_consumption_kwh` | SUM(load_kwh) |
| `avg_battery_soc` | AVG(avg_battery_soc) |
| `peak_battery_power_kw` | MAX(bat_discharge_kwh × 12) |

**UPSERT**: `ON CONFLICT (asset_id, hour_timestamp) DO UPDATE`

### 7.7 GatewayConnectionManager

**Source**: `gateway-connection-manager.ts`

**Core responsibilities:**
1. Load gateways from DB → connect each to MQTT broker
2. Subscribe 7 topics per gateway (S1–S7)
3. Route messages to appropriate handlers
4. Poll for new gateways every 60s
5. Watchdog: mark offline after 30 min without heartbeat
6. Hourly poll: `subDevices/get` + `config/get` for all gateways
7. Route alarm messages to AlarmHandler
8. Expose `publishToGateway()`, `isGatewayConnected()` for services

**Gateway Outage Event Management (v6.1):**

```
heartbeatWatchdog():
  UPDATE gateways SET status = 'offline'
    WHERE status = 'online' AND last_seen_at < NOW() - 30min
    RETURNING gateway_id, org_id

  For each newly-offline gateway:
    writeOutageEvent(gatewayId, orgId)

writeOutageEvent(gatewayId, orgId):
  // 5-min flap consolidation
  SELECT recent outage WHERE ended_at > NOW() - 5min

  if found:
    → Reopen existing outage (UPDATE ended_at = NULL)
  else:
    → INSERT new gateway_outage_events (started_at = NOW())
```

---

## 8. DB Tables

### 8.1 `gateways`

```sql
CREATE TABLE IF NOT EXISTS gateways (
  gateway_id        VARCHAR(100) PRIMARY KEY,       -- = device SN
  org_id            VARCHAR(50)  NOT NULL REFERENCES organizations(org_id),
  name              VARCHAR(200),
  address           TEXT,
  contracted_demand_kw DECIMAL(10,3),
  home_alias        VARCHAR(100),                    -- v6.2: human-readable alias
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
  ems_health_at     TIMESTAMPTZ,
  commissioned_at   TIMESTAMPTZ  DEFAULT NOW(),
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gateways_org ON gateways(org_id);
CREATE INDEX IF NOT EXISTS idx_gateways_status ON gateways(status);

ALTER TABLE gateways ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_gateways_tenant ON gateways
  USING (org_id = current_setting('app.current_org_id', true));
```

### 8.2 `assets`

```sql
-- Core columns relevant to M1
assets.asset_id         VARCHAR PK       -- = deviceSn (deterministic)
assets.serial_number    VARCHAR          -- = deviceSn
assets.name             VARCHAR
assets.brand            VARCHAR
assets.model            VARCHAR
assets.asset_type       VARCHAR          -- SMART_METER | INVERTER_BATTERY
assets.gateway_id       VARCHAR FK → gateways
assets.org_id           VARCHAR FK → organizations
assets.is_active        BOOLEAN
assets.rated_max_power_kw    REAL
assets.rated_max_current_a   REAL
assets.rated_min_power_kw    REAL
assets.rated_min_current_a   REAL
assets.commissioned_at  TIMESTAMPTZ
```

### 8.3 `device_command_logs`

```sql
CREATE TABLE IF NOT EXISTS device_command_logs (
  id                BIGSERIAL    PRIMARY KEY,
  gateway_id        VARCHAR(100) NOT NULL REFERENCES gateways(gateway_id),
  command_type      VARCHAR(20)  NOT NULL
                      CHECK (command_type IN ('get', 'get_reply', 'set', 'set_reply')),
  config_name       VARCHAR(100) NOT NULL DEFAULT 'battery_schedule',
  message_id        VARCHAR(50),
  payload_json      JSONB,
  result            VARCHAR(20),       -- pending | dispatched | accepted | success | fail | timeout
  error_message     TEXT,
  device_timestamp  TIMESTAMPTZ,
  resolved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cmd_logs_gateway ON device_command_logs(gateway_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cmd_logs_message ON device_command_logs(gateway_id, message_id);
CREATE INDEX IF NOT EXISTS idx_cmd_logs_pending ON device_command_logs(result) WHERE result = 'pending';
CREATE INDEX IF NOT EXISTS idx_dcl_accepted_set ON device_command_logs(gateway_id, result)
  WHERE result IN ('dispatched', 'accepted');
```

### 8.4 `backfill_requests`

```sql
CREATE TABLE IF NOT EXISTS backfill_requests (
  id                  BIGSERIAL    PRIMARY KEY,
  gateway_id          VARCHAR(100) NOT NULL REFERENCES gateways(gateway_id),
  gap_start           TIMESTAMPTZ  NOT NULL,
  gap_end             TIMESTAMPTZ  NOT NULL,
  current_chunk_start TIMESTAMPTZ,
  last_chunk_sent_at  TIMESTAMPTZ,
  status              VARCHAR(20)  NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'in_progress', 'completed', 'failed')),
  completed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backfill_active ON backfill_requests(status)
  WHERE status IN ('pending', 'in_progress');
```

### 8.5 `telemetry_history`

Hybrid column + JSONB strategy:
- **Dedicated columns**: battery, grid totals, PV totals, DO state, BMS limits, daily energy
- **JSONB `telemetry_extra`**: per-phase detail, meter data, dido DI, PV MPPT detail, ems_health

```sql
-- Key columns (non-exhaustive)
telemetry_history.asset_id           VARCHAR FK → assets
telemetry_history.recorded_at        TIMESTAMPTZ
telemetry_history.battery_soc        DECIMAL
telemetry_history.battery_power      DECIMAL
telemetry_history.pv_power           DECIMAL
telemetry_history.grid_power_kw      DECIMAL
telemetry_history.load_power         DECIMAL
telemetry_history.grid_import_kwh    DECIMAL
telemetry_history.grid_export_kwh    DECIMAL
telemetry_history.battery_soh        DECIMAL
telemetry_history.battery_voltage    DECIMAL
telemetry_history.battery_current    DECIMAL
telemetry_history.battery_temperature DECIMAL
telemetry_history.do0_active         BOOLEAN
telemetry_history.do1_active         BOOLEAN
telemetry_history.flload_power       DECIMAL
telemetry_history.inverter_temp      DECIMAL
telemetry_history.pv_daily_energy_kwh DECIMAL
telemetry_history.max_charge_current DECIMAL
telemetry_history.max_discharge_current DECIMAL
telemetry_history.daily_charge_kwh   DECIMAL
telemetry_history.daily_discharge_kwh DECIMAL
telemetry_history.telemetry_extra    JSONB

-- Dedup index for backfill idempotency
CREATE UNIQUE INDEX IF NOT EXISTS idx_telemetry_unique_asset_time
  ON telemetry_history(asset_id, recorded_at);
```

### 8.6 `device_state`

Real-time device state (UPSERT on each telemetry cycle):

```sql
device_state.asset_id       VARCHAR PK
device_state.battery_soc    DECIMAL
device_state.battery_power  DECIMAL
device_state.pv_power       DECIMAL
device_state.grid_power_kw  DECIMAL
device_state.load_power     DECIMAL
device_state.is_online      BOOLEAN
device_state.updated_at     TIMESTAMPTZ
```

### 8.7 `gateway_outage_events` (v6.1 NEW)

```sql
CREATE TABLE IF NOT EXISTS gateway_outage_events (
  id          BIGSERIAL    PRIMARY KEY,
  gateway_id  VARCHAR(50)  NOT NULL REFERENCES gateways(gateway_id),
  org_id      VARCHAR(50)  NOT NULL REFERENCES organizations(org_id),
  started_at  TIMESTAMPTZ  NOT NULL,
  ended_at    TIMESTAMPTZ,              -- NULL = outage still open
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE gateway_outage_events IS
  'Gateway-level outage events. Consolidates flaps < 5 min into single event.';

CREATE INDEX IF NOT EXISTS idx_goe_gateway_started
  ON gateway_outage_events (gateway_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_goe_org_started
  ON gateway_outage_events (org_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_goe_open
  ON gateway_outage_events (gateway_id)
  WHERE ended_at IS NULL;

ALTER TABLE gateway_outage_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_gateway_outage_events_tenant ON gateway_outage_events
  USING (org_id = current_setting('app.current_org_id', true));
```

**Outage lifecycle:**
1. Watchdog detects offline (30 min no heartbeat) → INSERT `started_at=NOW()`
2. Flap consolidation: if recent outage ended < 5 min ago → reopen (UPDATE `ended_at=NULL`)
3. HeartbeatHandler detects reconnect → UPDATE `ended_at=NOW()`

### 8.8 `gateway_alarm_events` (V2.4 NEW)

```sql
CREATE TABLE IF NOT EXISTS gateway_alarm_events (
  id                BIGSERIAL    PRIMARY KEY,
  gateway_id        VARCHAR(100) NOT NULL REFERENCES gateways(gateway_id),
  org_id            VARCHAR(50)  NOT NULL REFERENCES organizations(org_id),
  device_sn         VARCHAR(100),
  sub_dev_id        VARCHAR(100),
  sub_dev_name      VARCHAR(200),
  product_type      VARCHAR(50)  NOT NULL,
  event_id          VARCHAR(100) NOT NULL,
  event_name        VARCHAR(200) NOT NULL,
  event_type        VARCHAR(50)  NOT NULL,
  level             VARCHAR(20)  NOT NULL,
  status            VARCHAR(20)  NOT NULL,
  prop_id           VARCHAR(100) NOT NULL,
  prop_name         VARCHAR(200) NOT NULL,
  prop_value        VARCHAR(500) NOT NULL,
  description       TEXT,
  event_create_time TIMESTAMPTZ  NOT NULL,
  event_update_time TIMESTAMPTZ,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE gateway_alarm_events IS
  'V2.4: Device alarm events from device/ems/{cid}/alarm topic. Pure INSERT for audit completeness.';

CREATE INDEX IF NOT EXISTS idx_gae_gateway_created
  ON gateway_alarm_events (gateway_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gae_org_created
  ON gateway_alarm_events (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gae_event_id
  ON gateway_alarm_events (event_id);
```

### 8.9 `asset_5min_metrics`

```sql
asset_5min_metrics.asset_id               VARCHAR FK → assets
asset_5min_metrics.window_start           TIMESTAMPTZ
asset_5min_metrics.pv_energy_kwh          DECIMAL
asset_5min_metrics.bat_charge_kwh         DECIMAL
asset_5min_metrics.bat_discharge_kwh      DECIMAL
asset_5min_metrics.grid_import_kwh        DECIMAL
asset_5min_metrics.grid_export_kwh        DECIMAL
asset_5min_metrics.load_kwh               DECIMAL
asset_5min_metrics.bat_charge_from_grid_kwh DECIMAL
asset_5min_metrics.avg_battery_soc        DECIMAL
asset_5min_metrics.data_points            INTEGER
-- UNIQUE(asset_id, window_start)
```

### 8.10 `asset_hourly_metrics`

```sql
asset_hourly_metrics.asset_id             VARCHAR FK → assets
asset_hourly_metrics.hour_timestamp       TIMESTAMPTZ
asset_hourly_metrics.total_charge_kwh     DECIMAL
asset_hourly_metrics.total_discharge_kwh  DECIMAL
asset_hourly_metrics.pv_generation_kwh    DECIMAL
asset_hourly_metrics.grid_import_kwh      DECIMAL
asset_hourly_metrics.grid_export_kwh      DECIMAL
asset_hourly_metrics.load_consumption_kwh DECIMAL
asset_hourly_metrics.avg_battery_soc      DECIMAL
asset_hourly_metrics.peak_battery_power_kw DECIMAL
asset_hourly_metrics.data_points_count    INTEGER
-- UNIQUE(asset_id, hour_timestamp)
```

---

## 9. Domain Model Types

### 9.1 SolfacilMessage (Protocol Envelope)

```typescript
interface SolfacilMessage {
  readonly DS: number;
  readonly ackFlag: number;
  readonly clientId: string;           // = gatewayId
  readonly deviceName: string;
  readonly productKey: string;
  readonly messageId: string;
  readonly timeStamp: string;          // V2.4: UTC-3 "YYYY-MM-DD HH:mm:ss" or V1.x epoch ms string
  readonly data: Record<string, unknown>;
}
```

### 9.2 ParsedTelemetry

```typescript
interface ParsedTelemetry {
  readonly clientId: string;
  readonly deviceSn: string;
  readonly recordedAt: Date;
  readonly batterySoc: number;
  readonly batteryPowerKw: number;
  readonly dailyChargeKwh: number;
  readonly dailyDischargeKwh: number;
  readonly pvPowerKw: number;
  readonly pvDailyEnergyKwh: number;
  readonly gridPowerKw: number;
  readonly gridDailyBuyKwh: number;
  readonly gridDailySellKwh: number;
  readonly loadPowerKw: number;
  readonly flloadPowerKw: number;
  readonly batterySoh: number;
  readonly batteryVoltage: number;
  readonly batteryCurrent: number;
  readonly batteryTemperature: number;
  readonly maxChargeVoltage: number;
  readonly maxChargeCurrent: number;
  readonly maxDischargeCurrent: number;
  readonly totalChargeKwh: number;
  readonly totalDischargeKwh: number;
  readonly do0Active: boolean;
  readonly do1Active: boolean;
  readonly inverterTemp?: number;
  readonly pvTotalEnergyKwh?: number;
  readonly pv1Voltage?: number;
  readonly pv1Current?: number;
  readonly pv1Power?: number;
  readonly pv2Voltage?: number;
  readonly pv2Current?: number;
  readonly pv2Power?: number;
  readonly telemetryExtra?: Record<string, Record<string, number>> | null;
}
```

### 9.3 DomainSchedule

```typescript
interface DomainSchedule {
  readonly socMinLimit: number;        // 0-100
  readonly socMaxLimit: number;        // 0-100
  readonly maxChargeCurrent: number;   // A, >=0
  readonly maxDischargeCurrent: number; // A, >=0
  readonly gridImportLimitW?: number;     // V2.4 preferred (value is watts)
  /** @deprecated */ readonly gridImportLimitKw?: number;  // backward-compat alias
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

### 9.4 FragmentAssembler Types

```typescript
interface Accumulator {
  readonly clientId: string;
  readonly recordedAt: Date;
  ems?: SolfacilListItem;
  dido?: {
    readonly do: ReadonlyArray<{ id: string; type: string; value: string; gpionum?: string }>;
    readonly di?: ReadonlyArray<{ id: string; type: string; value: string; gpionum?: string }>;
  };
  meters: SolfacilListItem[];
  core?: Record<string, unknown>;
  timer: NodeJS.Timeout | null;
}
```

### 9.5 StandardTelemetry (see Section 4.2)

### 9.6 BackfillRequest

```typescript
interface BackfillRow {
  readonly id: number;
  readonly gateway_id: string;
  readonly gap_start: Date;
  readonly gap_end: Date;
  readonly current_chunk_start: Date | null;
  readonly last_chunk_sent_at: Date | null;
  readonly status: string;
  readonly created_at: Date;
}
```

### 9.7 SolfacilAlarmPayload (V2.4 NEW)

```typescript
interface SolfacilAlarmPayload {
  readonly eventinfo: {
    readonly deviceSn: string;
    readonly subDevId?: string;
    readonly subDevName?: string;
    readonly productType: string;
    readonly eventId: string;
    readonly eventName: string;
    readonly eventType: string;
    readonly level: string;
    readonly status: string;
    readonly propId: string;
    readonly propName: string;
    readonly propValue: string;
    readonly description?: string;
    readonly createTime: string;    // V2.4 UTC-3 timestamp
    readonly updateTime?: string;   // V2.4 UTC-3 timestamp
  };
}
```

---

## 10. Pool Assignment

| Component | DB Pool | Purpose |
|-----------|---------|---------|
| GatewayConnectionManager | shared pool | 讀取 gateways、watchdog 更新、outage events |
| HeartbeatHandler | shared pool | 更新 last_seen_at、close outage events |
| TelemetryHandler / FragmentAssembler | shared pool | INSERT telemetry_history、UPDATE device_state/gateways |
| MissedDataHandler / BackfillAssembler | shared pool | INSERT ON CONFLICT telemetry_history |
| AlarmHandler | shared pool | INSERT gateway_alarm_events |
| CommandTracker | shared pool | UPDATE device_command_logs |
| CommandPublisher | shared pool | SELECT/UPDATE device_command_logs |
| BackfillRequester | shared pool | SELECT/UPDATE backfill_requests |
| DeviceListHandler | shared pool | UPSERT assets |
| DeviceAssetCache | shared pool | SELECT assets（5min 快取） |
| MessageBuffer | shared pool | Batch INSERT telemetry_history（2s debounce） |
| 5min Aggregator | shared pool | SELECT telemetry_history → INSERT asset_5min_metrics |
| Hourly Aggregator | shared pool | SELECT asset_5min_metrics → INSERT asset_hourly_metrics |

---

## 11. Code File Inventory

### Handlers (handlers/)

| File | Version | Description |
|------|---------|-------------|
| `telemetry-handler.ts` | **v6.8** | Fragment-aware telemetry handler + gap detection (>5min → backfill); V2.4 parseProtocolTimestamp |
| `heartbeat-handler.ts` | **v6.8** | Connectivity recovery only: close outage events on reconnect; V2.4 parseProtocolTimestamp |
| `command-tracker.ts` | **v6.8** | Two-phase set_reply: accepted→success/fail; pg_notify; V2.4 messageId independence note |
| `missed-data-handler.ts` | **v6.8** | Backfill data path: data/missed → BackfillAssembler; V2.4 total/index progress tracking |
| `device-list-handler.ts` | v5.18 | DeviceList → UPSERT assets + soft-delete reconciliation |
| `schedule-translator.ts` | **v6.8** | Bidirectional protocol↔domain translation + validation; V2.4 gridImportLimitW preferred |
| `publish-config.ts` | **v6.8** | publishConfigGet/Set/SubDevicesGet; V2.4 formatProtocolTimestamp |
| `alarm-handler.ts` | **v6.8** | V2.4 alarm processing: alarm → gateway_alarm_events + pg_notify('alarm_event') |
| `ingest-telemetry.ts` | **v6.4** | Lambda: AppConfig DynamicAdapter → legacy mapping → ACL fallback |
| `mqtt-subscriber.ts` | v5.16 | Legacy single-topic subscriber (XuhengAdapter path) |
| `telemetry-webhook.ts` | v5.16 | POST /api/telemetry/mock (dev/test) |
| `schedule-to-shadow.ts` | v5.16 | Skeleton: EventBridge → Device Shadow (TODO) |

### Services (services/)

| File | Version | Description |
|------|---------|-------------|
| `gateway-connection-manager.ts` | **v6.8** | 7 topics/gw, 30min watchdog, outage event management with flap consolidation, alarm handler routing |
| `fragment-assembler.ts` | **v6.8** | Per-gateway fragment accumulator + parseTelemetryPayload (shared) + Protocol V2.4 scaling + V2.4 scalePowerFactor(×0.001) + parseProtocolTimestamp |
| `backfill-requester.ts` | **v6.8** | Poll backfill_requests → chunked get_missed MQTT publish; V2.4 epochMsToProtocolTimestamp |
| `command-publisher.ts` | v5.21 | Poll dispatched commands → MQTT config/set |
| `device-asset-cache.ts` | v5.16 | serial_number → asset_id (5min refresh, XuHeng prefix handling) |
| `message-buffer.ts` | v5.16 | Per-asset 2s debounce INSERT telemetry_history |
| `telemetry-5min-aggregator.ts` | v5.15 | Cron */5: telemetry_history → asset_5min_metrics |
| `telemetry-aggregator.ts` | v5.15 | Cron :05: asset_5min_metrics → asset_hourly_metrics |

### Parsers (parsers/)

| File | Version | Description |
|------|---------|-------------|
| `TelemetryAdapter.ts` | v5.16 | ACL contract interface: `canHandle()` + `normalize()` |
| `StandardTelemetry.ts` | v5.16 | Normalized format: Business Trinity + `castValue()` |
| `AdapterRegistry.ts` | v5.16 | `resolveAdapter()`: HuaweiAdapter → NativeAdapter priority |
| `NativeAdapter.ts` | v5.16 | Flat MQTT format (deviceId + power) |
| `HuaweiAdapter.ts` | v5.16 | FusionSolar format (devSn + dataItemMap, W→kW) |
| `DynamicAdapter.ts` | **v6.4** | ParserRule-driven: direct + iterator mode, domain routing |
| `XuhengAdapter.ts` | v5.18 | Full ACL: batList + pvList + gridList + loadList + flloadList + dido |

### Shared (shared/)

| File | Version | Description |
|------|---------|-------------|
| `protocol-time.ts` | **v6.8** | `parseProtocolTimestamp()` (V2.4 UTC-3 + V1.x epoch ms backward compat), `epochMsToProtocolTimestamp()`, `formatProtocolTimestamp()` |

---

## 12. Error Handling

| Scenario | Behavior |
|----------|----------|
| MQTT parse error（malformed JSON） | Log error, skip message, continue |
| Unknown gatewayId（not in gateways table） | Log warning, skip message |
| deviceList UPSERT failure | Log error, skip batch, continue |
| Telemetry INSERT failure | Log error（MessageBuffer handling） |
| Schedule validation failure | Throw `ScheduleValidationError`, DO NOT publish |
| MQTT broker disconnect | Auto-reconnect（reconnectPeriod: 5000ms） |
| DB connection failure | Crash + systemd restart |
| Fragment timeout（no MSG#5 within 3s） | Flush ems_health only, discard incomplete fragments, log warning |
| emsList parse error | Log warning, skip ems_health update |
| dido parse error | Log warning, DO0/DO1 fall back to false |
| CommandPublisher: gateway offline | Mark as `failed`, error_message='gateway_offline' |
| BackfillRequester: gateway offline | Mark as `failed`, completed_at=NOW() |
| BackfillAssembler: duplicate telemetry | `INSERT ON CONFLICT DO NOTHING`（靜默 dedup） |
| set_reply with no matching command | INSERT standalone `set_reply` record (audit) |
| Dispatch guard: existing pending/dispatched/accepted | BFF returns HTTP 409 Conflict |
| Accepted timeout（20s without resolution） | 定期任務標記為 `timeout` |
| DynamicAdapter: empty deviceIdPath | Skip record (no phantom IDs), log warning |
| DynamicAdapter: iterator not array | Throw TypeError |
| HeartbeatHandler: invalid timeStamp | Log warning, skip |
| Telemetry gap > 5min | INSERT backfill_requests with status='pending' |
| AlarmHandler: missing eventinfo | Log warning, skip message |
| AlarmHandler: gateway not found | Log warning, skip alarm |
| AlarmHandler: invalid createTime/updateTime | Log warning, skip alarm |
| V2.4 timestamp parse failure | `parseProtocolTimestamp()` throws Error; callers handle with try/catch or null check |

---

## 13. Test Strategy

### 13.1 Unit Tests

| Test Target | Coverage |
|-------------|----------|
| `parseTelemetryPayload` | Protocol V2.4 scaling, fragment combinations, missing fields, PV routing |
| `classifyAndAccumulate` | All data top-level key combinations |
| `ScheduleTranslator` | Bidirectional translation, boundary values, slot coverage/overlap |
| `CommandTracker.handleSetReply` | Two-phase: accepted→success, accepted→fail, dispatched→success |
| `HeartbeatHandler` | Reconnect detection → close outage event, normal heartbeat, first heartbeat |
| `TelemetryHandler.checkTelemetryGap` | Gap > 5min → backfill, normal telemetry, first message |
| `BackfillRequester` | Chunk splitting, cooldown, delay_after_reconnect |
| `DynamicAdapter` | Direct mode, iterator mode, phantom ID protection, nested path resolution |
| `DeviceAssetCache` | Direct match, XuHeng prefix strip |
| `AlarmHandler` | Valid alarm → INSERT + pg_notify, missing eventinfo → skip, unknown gateway → skip, invalid timestamps → skip |
| `parseProtocolTimestamp` | V2.4 UTC-3 string → Date, V1.x epoch ms → Date, invalid → throw |

### 13.2 Integration Tests

| Test Target | Coverage |
|-------------|----------|
| FragmentAssembler + DB | 5 fragment → merged INSERT telemetry_history + gateways.ems_health + pg_notify |
| BackfillAssembler + DB | INSERT ON CONFLICT DO NOTHING dedup |
| CommandPublisher pipeline | dispatched → MQTT publish |
| TelemetryHandler → backfill_requests | Gap > 5min → INSERT backfill_requests |
| Outage lifecycle | Watchdog offline → INSERT outage → heartbeat reconnect → close outage |
| Flap consolidation | Offline → reconnect < 5min → offline again → reopen same outage |
| Dispatch guard | Duplicate set while accepted → 409 |
| Alarm lifecycle | MQTT alarm → gateway_alarm_events INSERT + pg_notify('alarm_event') |

### 13.3 E2E Tests

| Test Flow | Steps |
|-----------|-------|
| Live telemetry cycle | MQTT 5-msg burst → FragmentAssembler → telemetry_history + SSE notify |
| Command round-trip | BFF set → CommandPublisher → accepted → success → SSE notify |
| Backfill cycle | Telemetry gap > 5min → backfill_requests → chunks sent → missed data received → dedup INSERT |
| Outage lifecycle | 30min no heartbeat → outage event → reconnect → outage closed |

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
| v5.18-hotfix | 2026-03-09 | Fragmented Payload: FragmentAssembler MSG#1-5 merge, emsList→gateways.ems_health, dido DO0/DO1, dual meterList→telemetry_extra, Protocol v1.2: +subDevices/get + hourly polling |
| v5.19 | 2026-03-10 | Schema consolidation: homes→gateways merge, gateway_id=SN |
| v5.20 | 2026-03-10 | M1 code purged of client_id/home_id references |
| v5.21 | 2026-03-11 | SSE + Command Pipeline: CommandPublisher (pending→dispatched), pg_notify |
| v5.22 | 2026-03-13 | Two-phase set_reply, backfill infrastructure, parseTelemetryPayload shared, +1 subscribe/publish topic (data/missed), UNIQUE INDEX on telemetry_history |
| **v6.6** | **2026-03-31** | **Gateway outage event management (writeOutageEvent + 5-min flap consolidation + heartbeat close), backfill trigger moved from HeartbeatHandler to TelemetryHandler (gap > 5min), watchdog 10min→15min, Protocol v1.8 scaling helpers, DynamicAdapter iterator mode (Phase 6.4), PV summary/MPPT routing, telemetry_extra ems_health subsection, gateway_outage_events table with RLS** |
| **v6.8** | **2026-04-02** | **Protocol V2.4 alignment: shared `parseProtocolTimestamp()`/`formatProtocolTimestamp()` (UTC-3 + V1.x backward compat), alarm-handler.ts (S7 `device/ems/{cid}/alarm` → `gateway_alarm_events` + pg_notify), `scalePowerFactor(×0.001)`, 7 subscribe topics, 30min watchdog threshold, V2.4 `gridImportLimitW` preferred field, backfill epochMsToProtocolTimestamp, MissedData total/index progress, CommandTracker V2.4 messageId independence, `SolfacilAlarmPayload` type** |
