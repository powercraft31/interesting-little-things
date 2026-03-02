# Module 1: IoT & Telemetry Hub

> **模組版本**: v5.8
> **上層文件**: [00_MASTER_ARCHITECTURE_v5.8.md](./00_MASTER_ARCHITECTURE_v5.8.md)
> **最後更新**: 2026-03-02
> **說明**: MQTT 接入、動態解析器引擎、Multi-Device Array、Asset Shadow、AppConfig Sidecar、traceId 生成、Telemetry Ingestion Handler、Hourly Aggregator Job (Data Contract Publisher)

---

## 1. 模組職責

M1 是所有遙測數據進入 VPP 系統的唯一閘口（Single Entry Point）。v5.2 將 M1 升級為純「翻譯執行器」——所有欄位映射邏輯外部化到 AppConfig。v5.8 新增 Data Contract Publisher 角色：M1 不僅負責原始遙測入庫，還負責將高頻時序數據蒸餾為小時匯總，作為跨模組的唯一數據契約。

核心職責：
- MQTT 接入（IoT Core 規則引擎）
- 動態解析器引擎（translateGatewayPayload）
- Business Trilogy Data Model（metering / status / config）
- Multi-Device Array Iteration（多設備陣列拆包）
- Asset Shadow Management（DynamoDB shadow schema）
- traceId 生成（`vpp-{UUID}`）與 EventBridge 發布
- Dual Ingestion（Channel A: MQTT / Channel B: REST webhook）
- **Telemetry Ingestion Handler** — 原始遙測入庫 + device_state 更新 (v5.8)
- **Hourly Aggregator Job (Data Contract Publisher)** — telemetry_history → asset_hourly_metrics (v5.8)

---

## 2. CDK Stack: `IotHubStack`

| Resource | AWS Service | Purpose |
|----------|-------------|---------|
| MQTT Broker | IoT Core | Accept device connections via MQTT over TLS |
| Device Registry | IoT Core Registry | Manage device certificates & thing groups |
| Device Shadow | IoT Core Shadow | Store last-known state per device |
| Telemetry Store | Amazon Timestream | High-frequency time-series data |
| Ingestion Lambda | Lambda (Node.js 20) | IoT Rule Action → parse → batch write to Timestream |
| Shadow Sync Lambda | Lambda (Node.js 20) | ScheduleGenerated → Device Shadow update |

### IAM Grants

```
IotHubStack Lambda functions:
  |- timestream:WriteRecords  -> solfacil_vpp/device_telemetry
  |- iot:UpdateThingShadow    -> arn:aws:iot:*:*:thing/*
  |- events:PutEvents         -> solfacil-vpp-events bus
  |- ssm:GetParameter         -> /solfacil/iot/* parameters
  |- rds-data:ExecuteStatement -> solfacil-vpp RDS cluster (for telemetry_history, device_state, asset_hourly_metrics)
```

---

## 3. EventBridge Integration

| Direction | Event | Source/Target |
|-----------|-------|---------------|
| **Publishes** | `TelemetryReceived` | → M2 (forecast update), M5 (future WebSocket) |
| **Publishes** | `DeviceStatusChanged` | → M4 (asset status), M5 (dashboard) |
| **Publishes** | `AlertTriggered` | → M7 (webhook delivery to on-call) |
| **Consumes** | `ScheduleGenerated` | ← M2 (24h schedule → Device Shadow) |

---

## 4. StandardTelemetry v5.2 — Dynamic Schema Envelope

v5.2 replaces the flat, hardcoded interface with a flexible envelope built around the **Business Trilogy Data Model**:

```typescript
// v5.1 (deprecated) — flat hardcoded fields
export interface StandardTelemetry {
  deviceId: string;
  orgId: string;
  timestamp: string;
  battery_soc?: number;       // hardcoded
  grid_power_kw?: number;     // hardcoded
}

// v5.2 — flexible schema envelope
export interface StandardTelemetry {
  deviceId: string;
  orgId: string;
  timestamp: string;
  traceId: string;            // vpp-{UUID}
  metering: Record<string, number>;
  status:   Record<string, string | number | boolean>;
  config:   Record<string, string | number | boolean>;
}
```

Adding a new telemetry field requires **zero code changes** — only a new parser rule in AppConfig.

---

## 5. AppConfig Parser Rules — `vpp-m1-parser-rules` Profile

All field mapping logic externalized to AWS AppConfig Configuration Profile `vpp-m1-parser-rules`.

**Parser Rules JSON Format:**

```json
{
  "version": "5.2",
  "rules": [
    {
      "domain": "metering",
      "targetField": "metering.grid_power_kw",
      "sourcePath": "grid.activePower",
      "valueType": "number",
      "transform": "divide:1000",
      "unit": "kW"
    },
    {
      "domain": "status",
      "targetField": "status.battery_soc",
      "sourcePath": "batList[0].bat_soc",
      "valueType": "number",
      "transform": "identity",
      "unit": "%"
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `domain` | `'metering' \| 'status' \| 'config'` | Business Trilogy bucket |
| `targetField` | `string` | Canonical field name (e.g., `metering.grid_power_kw`) |
| `sourcePath` | `string` | JSONPath-like expression from raw MQTT payload |
| `transform` | `string` | `identity`, `divide:N`, `multiply:N`, `round:N` |
| `unit` | `string` | SI unit for observability |
| `valueType` | `'number' \| 'string' \| 'boolean'` | Drives type casting via `castValue()` |

---

## 6. Translation Executor — `translateGatewayPayload()`

M1 is a **pure translation executor** — it contains no field mapping knowledge.

```typescript
function castValue(raw: unknown, valueType: 'number' | 'string' | 'boolean'): number | string | boolean {
  switch (valueType) {
    case 'number':
      const n = Number(raw);
      if (isNaN(n)) throw new TypeError(`Cannot cast "${raw}" to number`);
      return n;
    case 'boolean':
      if (typeof raw === 'boolean') return raw;
      if (raw === 'true' || raw === 1) return true;
      if (raw === 'false' || raw === 0) return false;
      throw new TypeError(`Cannot cast "${raw}" to boolean`);
    case 'string':
      return String(raw);
  }
}

async function translateGatewayPayload(
  rawMqttPayload: Record<string, unknown>,
  deviceId: string,
  orgId: string
): Promise<StandardTelemetry> {
  const rules = await getParserRules(); // from AppConfig Lambda Extension cache
  const result: StandardTelemetry = {
    deviceId, orgId,
    timestamp: new Date().toISOString(),
    traceId: `vpp-${uuidv4()}`,
    metering: {}, status: {}, config: {}
  };
  for (const rule of rules) {
    const rawValue = getNestedValue(rawMqttPayload, rule.sourcePath);
    if (rawValue === undefined) continue;
    const transformed = applyTransform(rawValue, rule.transform);
    const cast = castValue(transformed, rule.valueType);
    result[rule.domain][rule.targetField] = cast;
  }
  return result;
}
```

**Key design choices:**
- `getParserRules()` reads from AppConfig Lambda Extension (localhost:2772), latency < 1ms
- Rules are cached in the Extension sidecar; hot-reload within 45-90 seconds
- Unknown/unmappable source paths are silently skipped (defensive design)
- `traceId` generated at translation time and propagated to all downstream events

> **Type-Safety Guarantee:** M1 NEVER blind-passes raw MQTT values. Every field passes through `castValue()` before entering the domain container.

---

## 7. Multi-Device Array Iteration

Industrial gateways often report arrays of sub-devices in a single MQTT message. Iterator mode handles this:

```json
{
  "comment": "Iterator mode — one MQTT message with batList array -> N StandardTelemetry envelopes",
  "ruleId": "goodwe-battery-array",
  "iterator": "$.data.batList",
  "deviceIdPath": "$.sn",
  "rules": [
    {
      "domain": "status",
      "targetField": "status.battery_soc",
      "sourcePath": "bat_soc",
      "valueType": "number",
      "unit": "%"
    }
  ]
}
```

```typescript
async function translateWithIterator(
  rawPayload: Record<string, unknown>,
  ruleGroup: IteratorRuleGroup,
  gatewayDeviceId: string,
  orgId: string
): Promise<StandardTelemetry[]> {
  const results: StandardTelemetry[] = [];
  const items = getNestedValue(rawPayload, ruleGroup.iterator) as unknown[];
  if (!Array.isArray(items)) return [];

  for (const [index, item] of items.entries()) {
    const subDeviceId = ruleGroup.deviceIdPath
      ? String(getNestedValue(item as Record<string, unknown>, ruleGroup.deviceIdPath))
      : `${gatewayDeviceId}:${index}`;

    const envelope: StandardTelemetry = {
      deviceId: subDeviceId, orgId,
      timestamp: new Date().toISOString(),
      traceId: `vpp-${uuidv4()}`,
      metering: {}, status: {}, config: {}
    };

    for (const rule of ruleGroup.rules) {
      const rawValue = getNestedValue(item as Record<string, unknown>, rule.sourcePath);
      if (rawValue === undefined) continue;
      const transformed = applyTransform(rawValue, rule.transform ?? 'identity');
      const cast = castValue(transformed, rule.valueType);
      envelope[rule.domain][rule.targetField] = cast;
    }
    results.push(envelope);
  }
  return results; // 1 gateway message -> N StandardTelemetry envelopes
}
```

> **Multi-Device Guarantee:** A GoodWe gateway reports 3 batteries in `batList` → M1 emits 3 independent `StandardTelemetry` envelopes, each with its own `deviceId`.

---

## 8. Graceful Fallback — Three-Tier Degradation

| Tier | Condition | Behavior |
|------|-----------|----------|
| 1 | AppConfig Extension healthy | Use fresh rules (< 1ms) |
| 2 | Extension cache stale / slow | Use last known good rules from memory |
| 3 | No rules available | Emit raw payload with `_raw` prefix, alert via CloudWatch |

**Tier 3:** Wraps entire raw MQTT payload into `_raw` namespace with `degraded: true` flag. CloudWatch Alarm fires immediately.

---

## 9. Dual Ingestion Channels & Anti-Corruption Layer

```
+-----------------------------------------------------------------------------+
|                          Module 1: IoT & Telemetry Hub                       |
|                                                                              |
|  Channel A: MQTT (IoT Core)          Channel B: REST API (API Gateway)       |
|  +----------------------+            +----------------------------------+    |
|  |  Direct Devices       |            |  Third-Party Cloud Webhooks       |    |
|  |  (BESS, Inverters)    |            |  (FusionSolar, iSolarCloud, ...) |    |
|  +----------+------------+            +----------------+-----------------+    |
|             |                                          |                     |
|  +----------v------------+            +----------------v-----------------+    |
|  |  ingest-telemetry.ts   |            |  webhook-telemetry-ingest.ts     |    |
|  +----------+------------+            +----------------+-----------------+    |
|             |  Already in                              |  Vendor-specific     |
|             |  StandardTelemetry                       |  -> ACL -> Standard  |
|             +---------------+---------------------------+                    |
|                             v                                                |
|                  +---------------------------+                               |
|                  |  PostgreSQL Write          |                               |
|                  |  (telemetry_history +      |                               |
|                  |   device_state UPSERT)     |                               |
|                  |  + EventBridge Emit        |                               |
|                  +---------------------------+                               |
+------------------------------------------------------------------------------+
```

### Adapter Pattern (v4.0 — Vendor Webhooks)

```typescript
export interface TelemetryAdapter {
  readonly vendorId: string;
  normalize(orgId: string, rawPayload: Record<string, unknown>): StandardTelemetry;
}
```

**Registered Adapters:**
- `HuaweiFusionSolarAdapter` — W→kW conversion, Unix epoch→ISO 8601, nested `dataItemMap`
- `SungrowAdapter` — Direct kW, integer SoC 0-100

```typescript
// Adapter Registry
const adapters = new Map<string, TelemetryAdapter>([
  [HuaweiFusionSolarAdapter.vendorId, HuaweiFusionSolarAdapter],
  [SungrowAdapter.vendorId, SungrowAdapter],
]);

export function getAdapter(vendorId: string): TelemetryAdapter {
  const adapter = adapters.get(vendorId);
  if (!adapter) throw new Error(`Unsupported vendor: "${vendorId}"`);
  return adapter;
}
```

---

## 10. Device Shadow Schema & Schedule Sync

### 10.1 Device Shadow Schema (v5.3)

每個設備的 Device Shadow 包含以下結構：

```json
{
  "state": {
    "desired": {
      "capacity_kwh": 13.5,
      "schedule": [],
      "schedule_id": "SCH_20260227_001",
      "valid_from": "2026-02-27T00:00:00Z",
      "target_mode": "peak_valley_arbitrage",
      "min_soc": 20,
      "max_charge_rate": 3.3,
      "charge_window_start": "23:00",
      "charge_window_end": "05:00",
      "discharge_window_start": "17:00"
    },
    "reported": {
      "capacity_kwh": 13.5,
      "operationalStatus": "operando",
      "battery_soc": 72,
      "bat_work_status": "discharging",
      "firmware_version": "2.1.0"
    }
  }
}
```

**靜態配置欄位（v5.3 新增/變更）：**

| 欄位 | 類型 | 區塊 | 說明 |
|------|------|------|------|
| `capacity_kwh` | `number` | desired + reported | 靜態配置 — 電池系統裝機容量 (kWh)。由安裝商在設備 commissioning 時寫入 desired state。對應前端 `asset.capacity_kwh`，v5.3 取代原 `unidades` |
| `operationalStatus` | `string` | reported | 設備運行狀態。允許值：`'operando'` / `'carregando'` / `'offline'`。v5.3 確認命名規範 |

> **[v5.3 移除聲明]** `unidades` 欄位已從 Device Shadow Schema 中移除。
> 該欄位源自 VPP 聚合器設計，與 HEMS 單戶場景不相容。

### 10.2 Schedule Sync

When M2 publishes `ScheduleGenerated`, the `schedule-to-shadow` handler writes the 24-hour schedule into each device's Device Shadow (Desired State):

```
M2 --ScheduleGenerated--> EventBridge --> M1 (schedule-to-shadow Lambda)
                                                |
                                                |-- For each asset:
                                                |   Update Device Shadow (Desired State)
                                                |   { "schedule": [...], "schedule_id": "...", "valid_from": "..." }
                                                |
                                                |-- Device online:  Delta -> push immediately
                                                +-- Device offline: Shadow stores state; on reconnect -> auto-push
```

**Why Device Shadow?** Edge devices may temporarily lose connectivity. Delta mechanism guarantees that when a device reconnects, it receives the latest schedule.

---

## § Telemetry Ingestion Handler (v5.8)

### 概述

M1 內部處理器，負責接收 MQTT 入站訊息（或模擬觸發），執行原始遙測落庫與設備狀態更新。

> **Note:** 此設計階段不包含實際 MQTT Broker 設置。實作階段將提供 Mock Publisher 腳本模擬設備上報。

### 觸發方式

- **Production:** IoT Core Rule → Lambda（MQTT inbound message）
- **Dev/Mock:** HTTP endpoint 或 Mock Script 直接呼叫 handler

### 輸入格式

```typescript
interface TelemetryIngestPayload {
  asset_id: string;           // UUID，對應 assets.asset_id
  timestamp: string;          // ISO 8601，設備上報時間
  soc: number;                // 0-100，電池荷電狀態 (%)
  active_power_kw: number;    // 正=充電，負=放電 (kW)
  energy_kwh: number;         // 該上報週期的累計電量 (kWh)，正=充電，負=放電
}
```

### 處理邏輯

#### Write 1: INSERT into `telemetry_history`（原始時序，M1 內部表）

```sql
INSERT INTO telemetry_history (
  asset_id, recorded_at, battery_soc, battery_power, grid_power_kw
) VALUES (
  $1,  -- asset_id
  $2,  -- timestamp
  $3,  -- soc
  $4,  -- active_power_kw
  $5   -- energy_kwh (mapped to grid_power_kw for aggregation)
);
```

- `telemetry_history` 是 M1 **內部擁有** 的時序表，5 分鐘粒度
- 按月分區（`PARTITION BY RANGE (recorded_at)`）
- **此表不對外暴露**——外部模組應讀取 `asset_hourly_metrics`

#### Write 2: UPSERT `device_state`

```sql
INSERT INTO device_state (
  asset_id, battery_soc, battery_power, active_power_kw, updated_at
) VALUES (
  $1, $2, $3, $4, NOW()
)
ON CONFLICT (asset_id) DO UPDATE SET
  battery_soc    = EXCLUDED.battery_soc,
  battery_power  = EXCLUDED.battery_power,
  active_power_kw = EXCLUDED.active_power_kw,
  is_online      = true,
  updated_at     = NOW();
```

- 每台設備只有一行，每次上報 UPSERT 覆寫
- `is_online` 設為 `true`（心跳證明設備在線）
- M2 可即時讀取此表取得最新 SoC

### 邊界說明

| 項目 | 說明 |
|------|------|
| 數據所有權 | `telemetry_history` 與 `device_state` 均為 M1 獨佔表 |
| 跨模組契約 | M1 透過 `asset_hourly_metrics` 向外提供匯總數據（見下節） |
| Mock Publisher | 實作階段提供腳本，模擬每 5 分鐘上報遙測；此設計階段僅定義 handler 接口 |

---

## § Hourly Aggregator Job (Data Contract Publisher) (v5.8)

### 概述

M1 的 Hourly Aggregator Job 是 **Data Contract Publisher**——將高頻原始遙測（`telemetry_history`，每 5 分鐘一筆）
蒸餾為每小時匯總（`asset_hourly_metrics`），作為 M1 對外的**唯一數據契約 (Data Contract)**。

### 觸發方式

| 項目 | 說明 |
|------|------|
| 觸發方式 | Scheduled cron，每小時執行（`5 * * * *`，每小時第 5 分鐘） |
| 時間窗口 | 計算前一個完整小時的數據（例如 14:05 執行時，聚合 13:00:00 ~ 13:59:59 的資料） |
| 延遲容忍 | 在整點後 5 分鐘執行，允許遲到的遙測資料入庫 |
| 執行環境 | Express server 內嵌 cron task（與 M2/M3/M4 管線一致） |

### 聚合邏輯

```sql
-- 對每個 asset，查詢前一小時的 telemetry_history
-- 計算充電與放電的總電量

-- Step 1: 查詢原始遙測
SELECT
  asset_id,
  -- 充電電量：active_power_kw > 0 的時段
  SUM(CASE WHEN battery_power > 0 THEN ABS(energy_kwh) ELSE 0 END) AS total_charge_kwh,
  -- 放電電量：active_power_kw < 0 的時段
  SUM(CASE WHEN battery_power < 0 THEN ABS(energy_kwh) ELSE 0 END) AS total_discharge_kwh,
  -- 匯總的數據點數量（用於數據品質驗證）
  COUNT(*) AS data_points_count
FROM telemetry_history
WHERE recorded_at >= $1   -- 前一小時起始（e.g., '2026-03-01 13:00:00+08'）
  AND recorded_at <  $2   -- 前一小時結束（e.g., '2026-03-01 14:00:00+08'）
GROUP BY asset_id;

-- Step 2: UPSERT 進 Shared Contract 表
INSERT INTO asset_hourly_metrics (
  asset_id, hour_timestamp,
  total_charge_kwh, total_discharge_kwh, data_points_count,
  created_at, updated_at
) VALUES (
  $1, $2, $3, $4, $5, NOW(), NOW()
)
ON CONFLICT (asset_id, hour_timestamp) DO UPDATE SET
  total_charge_kwh    = EXCLUDED.total_charge_kwh,
  total_discharge_kwh = EXCLUDED.total_discharge_kwh,
  data_points_count   = EXCLUDED.data_points_count,
  updated_at          = NOW();
```

### 輸出：`asset_hourly_metrics`（Shared Contract 表）

| 欄位 | 類型 | 說明 |
|------|------|------|
| `id` | BIGSERIAL | 自增主鍵 |
| `asset_id` | UUID | 資產 ID，FK → assets |
| `hour_timestamp` | TIMESTAMPTZ | 截斷至整點，如 `2026-03-01 14:00:00+08` |
| `total_charge_kwh` | NUMERIC(10,4) | 該小時充電總量 (kWh) |
| `total_discharge_kwh` | NUMERIC(10,4) | 該小時放電總量 (kWh) |
| `data_points_count` | INT | 聚合的遙測記錄數（數據品質指標） |
| `created_at` | TIMESTAMPTZ | 首次寫入時間 |
| `updated_at` | TIMESTAMPTZ | 最後更新時間 |

**唯一鍵：** `(asset_id, hour_timestamp)` — UPSERT 語義，重複執行不產生重複數據

### 邊界規則

> **This is M1's ONLY outbound data contract.**
>
> - `telemetry_history` 是 M1 內部表，**嚴禁** 其他模組直接讀取
> - 外部模組若需遙測匯總數據，**一律** 讀取 `asset_hourly_metrics`
> - M4 是 `asset_hourly_metrics` 的主要消費者（Daily Billing Batch Job）
> - M5 BFF 未來亦可讀取此表用於 Dashboard hourly 圖表（v6.0 scope）
> - 違反此邊界規則 = 架構違規 (Architecture Boundary Breach)

### 數據品質驗證

| 檢查項目 | 預期值 | 異常處理 |
|---------|--------|---------|
| `data_points_count` | ~12（每小時 / 每 5 分鐘） | < 6 → log WARN（資料缺失超過 50%） |
| `total_charge_kwh` + `total_discharge_kwh` | >= 0 | 負值 → log ERROR，仍寫入但標記異常 |
| 無任何遙測記錄的 asset | N/A | 不寫入 `asset_hourly_metrics`（避免產生 0 值假記錄） |

---

## 11. Timestream Table Schema

```
Database: solfacil_vpp
Table: device_telemetry

Dimensions: org_id, asset_id, device_id, region
Measures:
  - soc (DOUBLE, %)
  - power_kw (DOUBLE, kW)
  - voltage (DOUBLE, V)
  - temperature (DOUBLE, C)
  - operation_mode (VARCHAR)

Retention: Memory=24h, Magnetic=90d
```

---

## 12. org_id Integration

- Timestream `org_id` dimension on every telemetry record
- IoT Rule SQL extracts `org_id` from topic position 2
- Device Shadow namespace: `solfacil/{org_id}/{region}/{asset_id}`
- IoT policies scoped to device certificate's `org_id` attribute
- All published events include `org_id` in detail

---

## 13. Lambda Handlers

```
src/iot-hub/
|-- handlers/
|   |-- ingest-telemetry.ts       # IoT Rule -> Lambda: parse MQTT, write PostgreSQL
|   |-- webhook-telemetry-ingest.ts # Channel B: REST webhook -> ACL -> Standard
|   |-- device-shadow-sync.ts     # Device Shadow update handler
|   |-- schedule-to-shadow.ts     # EventBridge ScheduleGenerated -> Device Shadow
|   |-- device-registry.ts        # Device provisioning & registration
|   |-- telemetry-ingestion.ts    # v5.8: Telemetry Ingestion Handler (INSERT telemetry_history + UPSERT device_state)
|   +-- hourly-aggregator.ts      # v5.8: Hourly Aggregator Job (telemetry_history -> asset_hourly_metrics)
|-- contracts/
|   +-- standard-telemetry.ts     # v5.2: Dynamic schema envelope (Business Trilogy)
|-- adapters/
|   |-- telemetry-adapter.ts      # Adapter interface
|   |-- adapter-registry.ts       # Vendor -> Adapter lookup
|   |-- huawei-adapter.ts         # Huawei FusionSolar
|   +-- sungrow-adapter.ts        # Sungrow iSolarCloud
|-- services/
|   |-- timestream-writer.ts      # Timestream batch write logic
|   |-- shadow-manager.ts         # Device Shadow get/update
|   |-- translation-executor.ts   # v5.2: translateGatewayPayload()
|   +-- hourly-aggregator.ts      # v5.8: Aggregator logic (query + compute + upsert)
+-- __tests__/
    |-- ingest-telemetry.test.ts
    |-- timestream-writer.test.ts
    |-- translation-executor.test.ts
    |-- huawei-adapter.test.ts
    |-- sungrow-adapter.test.ts
    |-- adapter-registry.test.ts
    |-- telemetry-ingestion.test.ts   # v5.8
    +-- hourly-aggregator.test.ts     # v5.8
```

---

## Document History

| Version | Date | Summary |
|---------|------|---------|
| v5.2 | 2026-02-25 | 初始版本：MQTT 接入、動態解析器、Multi-Device Array、Asset Shadow |
| v5.3 | 2026-02-27 | HEMS 單戶場景：capacity_kwh 取代 unidades，Device Shadow schema 更新 |
| v5.8 | 2026-03-02 | Telemetry Feedback Loop：新增 Telemetry Ingestion Handler（INSERT telemetry_history + UPSERT device_state）、Hourly Aggregator Job（Data Contract Publisher，寫入 asset_hourly_metrics） |

---

## 模組依賴關係

| 方向 | 模組 | 說明 |
|------|------|------|
| **依賴** | M8 (Admin Control) | AppConfig `vpp-m1-parser-rules` 讀取解析規則 |
| **被依賴** | M2 (Optimization Engine) | 消費 `TelemetryReceived` 事件 |
| **被依賴** | M3 (DR Dispatcher) | Device Shadow 寫入（接收 `ScheduleGenerated`） |
| **被依賴** | M4 (Market & Billing) | **v5.8: 讀取 `asset_hourly_metrics` (Data Contract) 進行財務結算**；消費 `DeviceStatusChanged` 事件 |
| **被依賴** | M5 (BFF) | Timestream 查詢遙測數據 |
| **被依賴** | M7 (Open API) | 消費 `AlertTriggered` 事件 → webhook |
