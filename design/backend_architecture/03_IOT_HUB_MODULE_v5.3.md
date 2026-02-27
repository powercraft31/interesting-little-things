# Module 1: IoT & Telemetry Hub

> **模組版本**: v5.3
> **上層文件**: [00_MASTER_ARCHITECTURE_v5.2.md](./00_MASTER_ARCHITECTURE_v5.2.md)
> **最後更新**: 2026-02-27
> **說明**: MQTT 接入、動態解析器引擎、Multi-Device Array、Asset Shadow、AppConfig Sidecar、traceId 生成

---

## 1. 模組職責

M1 是所有遙測數據進入 VPP 系統的唯一閘口（Single Entry Point）。v5.2 將 M1 升級為純「翻譯執行器」——所有欄位映射邏輯外部化到 AppConfig。

核心職責：
- MQTT 接入（IoT Core 規則引擎）
- 動態解析器引擎（translateGatewayPayload）
- Business Trilogy Data Model（metering / status / config）
- Multi-Device Array Iteration（多設備陣列拆包）
- Asset Shadow Management（DynamoDB shadow schema）
- traceId 生成（`vpp-{UUID}`）與 EventBridge 發布
- Dual Ingestion（Channel A: MQTT / Channel B: REST webhook）

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
  ├─ timestream:WriteRecords  → solfacil_vpp/device_telemetry
  ├─ iot:UpdateThingShadow    → arn:aws:iot:*:*:thing/*
  ├─ events:PutEvents         → solfacil-vpp-events bus
  └─ ssm:GetParameter         → /solfacil/iot/* parameters
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
- Rules are cached in the Extension sidecar; hot-reload within 45–90 seconds
- Unknown/unmappable source paths are silently skipped (defensive design)
- `traceId` generated at translation time and propagated to all downstream events

> **Type-Safety Guarantee:** M1 NEVER blind-passes raw MQTT values. Every field passes through `castValue()` before entering the domain container.

---

## 7. Multi-Device Array Iteration

Industrial gateways often report arrays of sub-devices in a single MQTT message. Iterator mode handles this:

```json
{
  "comment": "Iterator mode — one MQTT message with batList array → N StandardTelemetry envelopes",
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
  return results; // 1 gateway message → N StandardTelemetry envelopes
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
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Module 1: IoT & Telemetry Hub                      │
│                                                                             │
│  Channel A: MQTT (IoT Core)          Channel B: REST API (API Gateway)      │
│  ┌──────────────────────┐            ┌──────────────────────────────────┐   │
│  │  Direct Devices       │            │  Third-Party Cloud Webhooks       │   │
│  │  (BESS, Inverters)    │            │  (FusionSolar, iSolarCloud, ...) │   │
│  └──────────┬───────────┘            └───────────────┬──────────────────┘   │
│             │                                         │                      │
│  ┌──────────▼───────────┐            ┌───────────────▼──────────────────┐   │
│  │  ingest-telemetry.ts  │            │  webhook-telemetry-ingest.ts     │   │
│  └──────────┬───────────┘            └───────────────┬──────────────────┘   │
│             │  Already in                             │  Vendor-specific      │
│             │  StandardTelemetry                      │  → ACL → Standard    │
│             └────────────────┬─────────────────────────┘                    │
│                              ▼                                              │
│                   ┌──────────────────────┐                                  │
│                   │  Timestream Write     │                                  │
│                   │  + EventBridge Emit   │                                  │
│                   └──────────────────────┘                                  │
└─────────────────────────────────────────────────────────────────────────────┘
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
- `SungrowAdapter` — Direct kW, integer SoC 0–100

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
      "schedule": [...],
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
M2 ──ScheduleGenerated──► EventBridge ──► M1 (schedule-to-shadow Lambda)
                                                │
                                                ├── For each asset:
                                                │   Update Device Shadow (Desired State)
                                                │   { "schedule": [...], "schedule_id": "...", "valid_from": "..." }
                                                │
                                                ├── Device online:  Delta → push immediately
                                                └── Device offline: Shadow stores state; on reconnect → auto-push
```

**Why Device Shadow?** Edge devices may temporarily lose connectivity. Delta mechanism guarantees that when a device reconnects, it receives the latest schedule.

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
├── handlers/
│   ├── ingest-telemetry.ts       # IoT Rule → Lambda: parse MQTT, write Timestream
│   ├── webhook-telemetry-ingest.ts # Channel B: REST webhook → ACL → Standard
│   ├── device-shadow-sync.ts     # Device Shadow update handler
│   ├── schedule-to-shadow.ts     # EventBridge ScheduleGenerated → Device Shadow
│   └── device-registry.ts        # Device provisioning & registration
├── contracts/
│   └── standard-telemetry.ts     # v5.2: Dynamic schema envelope (Business Trilogy)
├── adapters/
│   ├── telemetry-adapter.ts      # Adapter interface
│   ├── adapter-registry.ts       # Vendor → Adapter lookup
│   ├── huawei-adapter.ts         # Huawei FusionSolar
│   └── sungrow-adapter.ts        # Sungrow iSolarCloud
├── services/
│   ├── timestream-writer.ts      # Timestream batch write logic
│   ├── shadow-manager.ts         # Device Shadow get/update
│   └── translation-executor.ts   # v5.2: translateGatewayPayload()
└── __tests__/
    ├── ingest-telemetry.test.ts
    ├── timestream-writer.test.ts
    ├── translation-executor.test.ts
    ├── huawei-adapter.test.ts
    ├── sungrow-adapter.test.ts
    └── adapter-registry.test.ts
```

---

## 模組依賴關係

| 方向 | 模組 | 說明 |
|------|------|------|
| **依賴** | M8 (Admin Control) | AppConfig `vpp-m1-parser-rules` 讀取解析規則 |
| **被依賴** | M2 (Optimization Engine) | 消費 `TelemetryReceived` 事件 |
| **被依賴** | M3 (DR Dispatcher) | Device Shadow 寫入（接收 `ScheduleGenerated`） |
| **被依賴** | M4 (Market & Billing) | 消費 `DeviceStatusChanged` 事件 |
| **被依賴** | M5 (BFF) | Timestream 查詢遙測數據 |
| **被依賴** | M7 (Open API) | 消費 `AlertTriggered` 事件 → webhook |
