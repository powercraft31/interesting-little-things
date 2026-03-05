# M1: IoT Hub Module — MQTT Subscriber & XuhengAdapter

> **模組版本**: v5.13
> **上層文件**: [00_MASTER_ARCHITECTURE_v5.13.md](./00_MASTER_ARCHITECTURE_v5.13.md)
> **最後更新**: 2026-03-05
> **說明**: Block 1 — MQTT subscriber for Xuheng EMS telemetry, integrated into M1 IoT Hub
> **核心主題**: mqtt-subscriber.ts + XuhengAdapter port + aggregator expansion

---

## v5.13 升版說明

### 問題陳述

M1 IoT Hub currently has two ingestion paths:
1. **`ingest-telemetry.ts`** — AWS Lambda + Timestream + EventBridge (legacy, stays untouched)
2. **`telemetry-webhook.ts`** — HTTP POST endpoint writing to PostgreSQL via Service Pool

Neither can subscribe to the Xuheng EMS MQTT broker (EMQX, port 1883, topic `xuheng/+/+/data`). The Phase 1 MQTT Bridge (commit `00a6133`) demonstrated a working pipeline as a standalone service. v5.13 ports the relevant patterns into the main backend's `iot-hub/` module.

Additionally, the telemetry aggregator (`telemetry-aggregator.ts`) only computes charge/discharge. Block 2 needs PV, grid, load, and SOC aggregates.

### 解決方案

1. **New file:** `iot-hub/handlers/mqtt-subscriber.ts` — MQTT client + message router
2. **New file:** `iot-hub/parsers/XuhengAdapter.ts` — port from Phase 1, adapted for `ParsedTelemetry` type
3. **Port:** `iot-hub/services/device-asset-cache.ts` — device_sn → asset_id mapping
4. **Port:** `iot-hub/services/message-buffer.ts` — 2s debounce per clientId
5. **Enhance:** `iot-hub/services/telemetry-aggregator.ts` — add 6 new aggregation columns

---

## 1. Architecture Overview

```
EMQX Broker (1883)
  │ topic: xuheng/+/+/data
  │
  ▼
mqtt-subscriber.ts          ← NEW: MQTT client (mqtt.js)
  │
  ├─ classify message type (MSG#0-4)
  │
  ├─ MSG#4 ──▶ XuhengAdapter.parse()
  │              │
  │              ▼
  │           ParsedTelemetry
  │              │
  │              ├──▶ MessageBuffer (2s debounce)
  │              │       │
  │              │       ▼
  │              │    writer.ts ──▶ INSERT telemetry_history
  │              │
  │              └──▶ state-updater.ts ──▶ UPSERT device_state
  │
  ├─ MSG#0 ──▶ ems-health-updater.ts ──▶ UPSERT ems_health
  │
  └─ MSG#1-3 ──▶ (log + ignore for v5.13)

telemetry-aggregator.ts     ← ENHANCED: +6 columns
  │ cron: every hour at :05
  │
  ▼
asset_hourly_metrics        ← charge, discharge, pv, grid_import, grid_export,
                               load, avg_soc, peak_battery_power
```

### Pool Assignment

| Component | Pool | Rationale |
|-----------|------|-----------|
| mqtt-subscriber | **Service Pool** | Hardware data, no JWT, no user context |
| XuhengAdapter | N/A (pure function) | No DB access |
| MessageBuffer | N/A (in-memory) | No DB access |
| writer (INSERT telemetry_history) | **Service Pool** | Cron/subscriber component |
| state-updater (UPSERT device_state) | **Service Pool** | Cron/subscriber component |
| ems-health-updater (UPSERT ems_health) | **Service Pool** | Cron/subscriber component |
| telemetry-aggregator (cron) | **Service Pool** | Unchanged from v5.11 |

---

## 2. mqtt-subscriber.ts — Entry Point

```typescript
import mqtt from "mqtt";
import { Pool } from "pg";
import { XuhengAdapter } from "../parsers/XuhengAdapter";
import { DeviceAssetCache } from "../services/device-asset-cache";
import { MessageBuffer } from "../services/message-buffer";
import type { XuhengRawMessage, XuhengMessageType } from "../../shared/types/telemetry";

interface MqttSubscriberConfig {
  readonly brokerUrl: string;     // e.g. "mqtt://broker.emqx.io:1883"
  readonly topic: string;         // "xuheng/+/+/data"
  readonly clientId: string;      // unique subscriber ID
}

const DEFAULT_CONFIG: MqttSubscriberConfig = {
  brokerUrl: process.env.MQTT_BROKER_URL ?? "mqtt://broker.emqx.io:1883",
  topic: process.env.MQTT_TOPIC ?? "xuheng/+/+/data",
  clientId: `solfacil-vpp-${process.pid}`,
};

export function startMqttSubscriber(
  pool: Pool,
  config: MqttSubscriberConfig = DEFAULT_CONFIG,
): mqtt.MqttClient {
  const adapter = new XuhengAdapter();
  const cache = new DeviceAssetCache(pool);
  const buffer = new MessageBuffer(pool, 2000); // 2s debounce

  const client = mqtt.connect(config.brokerUrl, {
    clientId: config.clientId,
    clean: true,
    reconnectPeriod: 5000,
  });

  client.on("connect", () => {
    console.log(`[MqttSubscriber] Connected to ${config.brokerUrl}`);
    client.subscribe(config.topic, { qos: 1 }, (err) => {
      if (err) console.error("[MqttSubscriber] Subscribe error:", err);
      else console.log(`[MqttSubscriber] Subscribed to ${config.topic}`);
    });
  });

  client.on("message", async (_topic: string, payload: Buffer) => {
    try {
      const raw: XuhengRawMessage = JSON.parse(payload.toString());
      const msgType = classifyMessage(raw);

      if (msgType === 4) {
        // MSG#4: Energy data — primary path
        const parsed = adapter.parse(raw);
        if (!parsed) return;

        const assetId = await cache.resolve(parsed.deviceSn);
        if (!assetId) {
          console.warn(`[MqttSubscriber] Unknown device: ${parsed.deviceSn}`);
          return;
        }

        buffer.enqueue(assetId, parsed);
        await updateDeviceState(pool, assetId, parsed);
      } else if (msgType === 0) {
        // MSG#0: EMS health
        await updateEmsHealth(pool, raw);
      }
      // MSG#1-3: log only
    } catch (err) {
      console.error("[MqttSubscriber] Message processing error:", err);
    }
  });

  client.on("error", (err) => {
    console.error("[MqttSubscriber] Connection error:", err);
  });

  // Graceful shutdown
  process.on("SIGTERM", () => {
    console.log("[MqttSubscriber] Shutting down...");
    buffer.flush();
    client.end();
  });

  return client;
}
```

### Message Classification

```typescript
function classifyMessage(raw: XuhengRawMessage): XuhengMessageType {
  const data = raw.data as Record<string, unknown>;
  if (data.batList && data.pvList && data.gridList) return 4;  // MSG#4
  if (data.emsList) return 0;  // MSG#0
  if (data.didoList) return 1; // MSG#1
  if (data.meterList) return 2; // MSG#2-3
  return 4; // default to energy data
}
```

---

## 3. XuhengAdapter — Parser (Port from Phase 1)

```typescript
import type { XuhengRawMessage, ParsedTelemetry } from "../../shared/types/telemetry";

export class XuhengAdapter {
  /**
   * Parse Xuheng MSG#4 into canonical ParsedTelemetry.
   * All string property values are parseFloat'd.
   * Returns null if message is malformed.
   */
  parse(raw: XuhengRawMessage): ParsedTelemetry | null {
    const { data } = raw;
    if (!data.batList?.length) return null;

    const bat = data.batList[0];
    const pv = data.pvList?.[0];
    const grid = data.gridList?.[0];
    const load = data.loadList?.[0];
    const flload = data.flloadList?.[0];

    return {
      clientId: raw.clientId,
      deviceSn: bat.deviceSn,
      recordedAt: new Date(parseInt(raw.timeStamp, 10)),
      batterySoc: safeFloat(bat.properties.total_bat_soc),
      batteryPowerKw: safeFloat(bat.properties.total_bat_power),
      dailyChargeKwh: safeFloat(bat.properties.total_bat_dailyChargedEnergy),
      dailyDischargeKwh: safeFloat(bat.properties.total_bat_dailyDischargedEnergy),
      pvPowerKw: safeFloat(pv?.properties.pv_totalPower),
      pvDailyEnergyKwh: safeFloat(pv?.properties.pv_dailyEnergy),
      gridPowerKw: safeFloat(grid?.properties.grid_totalActivePower),
      gridDailyBuyKwh: safeFloat(grid?.properties.grid_dailyBuyEnergy),
      gridDailySellKwh: safeFloat(grid?.properties.grid_dailySellEnergy),
      loadPowerKw: safeFloat(load?.properties.load1_totalPower),
      flloadPowerKw: safeFloat(flload?.properties.flload_totalPower),
    };
  }
}

function safeFloat(val: string | undefined): number {
  if (val === undefined || val === null || val === "") return 0;
  const n = parseFloat(val);
  return Number.isFinite(n) ? n : 0;
}
```

---

## 4. DeviceAssetCache — device_sn → asset_id Mapping

```typescript
import { Pool } from "pg";

/**
 * In-memory cache mapping device serial numbers to asset IDs.
 * Refreshes every 5 minutes from the database.
 */
export class DeviceAssetCache {
  private cache = new Map<string, string>();
  private lastRefresh = 0;
  private readonly refreshIntervalMs = 5 * 60 * 1000; // 5 min

  constructor(private readonly pool: Pool) {}

  async resolve(deviceSn: string): Promise<string | null> {
    if (Date.now() - this.lastRefresh > this.refreshIntervalMs) {
      await this.refresh();
    }
    return this.cache.get(deviceSn) ?? null;
  }

  private async refresh(): Promise<void> {
    const result = await this.pool.query<{ serial_number: string; asset_id: string }>(
      `SELECT serial_number, asset_id FROM assets WHERE serial_number IS NOT NULL AND is_active = true`,
    );
    this.cache.clear();
    for (const row of result.rows) {
      this.cache.set(row.serial_number, row.asset_id);
    }
    this.lastRefresh = Date.now();
    console.log(`[DeviceAssetCache] Refreshed: ${this.cache.size} mappings`);
  }
}
```

**Key difference from Phase 1:** Uses `assets.serial_number` (v5.12 unified device model) instead of a separate `devices` table.

---

## 5. MessageBuffer — 2s Debounce

```typescript
import { Pool } from "pg";
import type { ParsedTelemetry } from "../../shared/types/telemetry";

/**
 * Buffers parsed telemetry by assetId, flushing to DB after debounce interval.
 * Prevents duplicate writes when multiple messages arrive within the window.
 * Uses latest values per asset (last-write-wins within buffer window).
 */
export class MessageBuffer {
  private buffer = new Map<string, { assetId: string; telemetry: ParsedTelemetry; timer: NodeJS.Timeout }>();

  constructor(
    private readonly pool: Pool,
    private readonly debounceMs: number = 2000,
  ) {}

  enqueue(assetId: string, telemetry: ParsedTelemetry): void {
    const existing = this.buffer.get(assetId);
    if (existing) {
      clearTimeout(existing.timer);
    }

    const timer = setTimeout(() => this.flushOne(assetId), this.debounceMs);
    this.buffer.set(assetId, { assetId, telemetry, timer });
  }

  private async flushOne(assetId: string): Promise<void> {
    const entry = this.buffer.get(assetId);
    if (!entry) return;
    this.buffer.delete(assetId);

    const t = entry.telemetry;
    try {
      await this.pool.query(
        `INSERT INTO telemetry_history
           (asset_id, recorded_at, battery_soc, battery_power, pv_power,
            grid_power_kw, load_power, grid_import_kwh, grid_export_kwh)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          assetId, t.recordedAt, t.batterySoc, t.batteryPowerKw,
          t.pvPowerKw, t.gridPowerKw, t.loadPowerKw,
          t.gridDailyBuyKwh, t.gridDailySellKwh,
        ],
      );
    } catch (err) {
      console.error(`[MessageBuffer] Write error for ${assetId}:`, err);
    }
  }

  /** Flush all pending entries immediately (for graceful shutdown). */
  flush(): void {
    for (const [assetId] of this.buffer) {
      this.flushOne(assetId);
    }
  }
}
```

---

## 6. Enhanced Telemetry Aggregator

The existing `telemetry-aggregator.ts` is enhanced to aggregate 6 additional columns.

### Current SQL (v5.12)

```sql
SELECT asset_id,
  SUM(CASE WHEN energy_kwh > 0 THEN energy_kwh ELSE 0 END) AS charge,
  SUM(CASE WHEN energy_kwh < 0 THEN ABS(energy_kwh) ELSE 0 END) AS discharge,
  COUNT(*) AS count
FROM telemetry_history
WHERE recorded_at >= $1 AND recorded_at < $2
GROUP BY asset_id
```

### v5.13 Enhanced SQL

```sql
SELECT
  asset_id,
  -- v5.8 original: charge/discharge from battery_power sign
  SUM(CASE WHEN battery_power > 0 THEN battery_power * (1.0/4) ELSE 0 END)     AS charge,
  SUM(CASE WHEN battery_power < 0 THEN ABS(battery_power) * (1.0/4) ELSE 0 END) AS discharge,
  -- v5.13 new: PV generation
  SUM(COALESCE(pv_power, 0) * (1.0/4))                                           AS pv_generation,
  -- v5.13 new: grid import/export from grid_power_kw sign
  SUM(CASE WHEN grid_power_kw > 0 THEN grid_power_kw * (1.0/4) ELSE 0 END)      AS grid_import,
  SUM(CASE WHEN grid_power_kw < 0 THEN ABS(grid_power_kw) * (1.0/4) ELSE 0 END) AS grid_export,
  -- v5.13 new: load consumption
  SUM(COALESCE(load_power, 0) * (1.0/4))                                          AS load_consumption,
  -- v5.13 new: SOC average
  AVG(battery_soc)                                                                 AS avg_soc,
  -- v5.13 new: peak battery power
  MAX(ABS(COALESCE(battery_power, 0)))                                             AS peak_bat_power,
  COUNT(*)                                                                         AS count
FROM telemetry_history
WHERE recorded_at >= $1 AND recorded_at < $2
GROUP BY asset_id
```

**Design note on `(1.0/4)`:** Assumes 15-min reporting intervals (4 samples/hour). `power_kw × 0.25h = energy_kwh`. If the actual reporting interval varies, this should be computed from `data_points_count / expected_points_per_hour`.

### UPSERT Enhancement

```sql
INSERT INTO asset_hourly_metrics
  (asset_id, hour_timestamp,
   total_charge_kwh, total_discharge_kwh,
   pv_generation_kwh, grid_import_kwh, grid_export_kwh,
   load_consumption_kwh, avg_battery_soc, peak_battery_power_kw,
   data_points_count, created_at, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
ON CONFLICT (asset_id, hour_timestamp) DO UPDATE SET
  total_charge_kwh      = EXCLUDED.total_charge_kwh,
  total_discharge_kwh   = EXCLUDED.total_discharge_kwh,
  pv_generation_kwh     = EXCLUDED.pv_generation_kwh,
  grid_import_kwh       = EXCLUDED.grid_import_kwh,
  grid_export_kwh       = EXCLUDED.grid_export_kwh,
  load_consumption_kwh  = EXCLUDED.load_consumption_kwh,
  avg_battery_soc       = EXCLUDED.avg_battery_soc,
  peak_battery_power_kw = EXCLUDED.peak_battery_power_kw,
  data_points_count     = EXCLUDED.data_points_count,
  updated_at            = NOW()
```

---

## 7. DB Writers — state-updater & ems-health-updater

### updateDeviceState (MSG#4)

```typescript
async function updateDeviceState(pool: Pool, assetId: string, t: ParsedTelemetry): Promise<void> {
  await pool.query(
    `INSERT INTO device_state
       (asset_id, battery_soc, battery_power, pv_power, grid_power_kw, load_power, is_online, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, true, NOW())
     ON CONFLICT (asset_id) DO UPDATE SET
       battery_soc    = EXCLUDED.battery_soc,
       battery_power  = EXCLUDED.battery_power,
       pv_power       = EXCLUDED.pv_power,
       grid_power_kw  = EXCLUDED.grid_power_kw,
       load_power     = EXCLUDED.load_power,
       is_online      = true,
       updated_at     = NOW()`,
    [assetId, t.batterySoc, t.batteryPowerKw, t.pvPowerKw, t.gridPowerKw, t.loadPowerKw],
  );
}
```

### updateEmsHealth (MSG#0)

```typescript
async function updateEmsHealth(pool: Pool, raw: XuhengRawMessage): Promise<void> {
  const emsList = (raw.data as Record<string, unknown>).emsList as ReadonlyArray<Record<string, unknown>> | undefined;
  if (!emsList?.length) return;

  const ems = emsList[0] as Record<string, unknown>;
  const props = ems.properties as Record<string, string> | undefined;
  if (!props) return;

  // Resolve asset_id from clientId
  // (ems_health uses asset_id FK; lookup via serial_number on first battery device)
  await pool.query(
    `INSERT INTO ems_health
       (asset_id, client_id, firmware_version, wifi_signal_dbm, uptime_seconds, error_codes, last_heartbeat, updated_at)
     SELECT a.asset_id, $1, $2, $3, $4, $5, NOW(), NOW()
     FROM assets a WHERE a.serial_number = $6 AND a.is_active = true
     LIMIT 1
     ON CONFLICT (asset_id) DO UPDATE SET
       client_id        = EXCLUDED.client_id,
       firmware_version = EXCLUDED.firmware_version,
       wifi_signal_dbm  = EXCLUDED.wifi_signal_dbm,
       uptime_seconds   = EXCLUDED.uptime_seconds,
       error_codes      = EXCLUDED.error_codes,
       last_heartbeat   = EXCLUDED.last_heartbeat,
       updated_at       = NOW()`,
    [
      raw.clientId,
      props.firmware_version ?? null,
      props.wifi_signal_dbm ? parseInt(props.wifi_signal_dbm, 10) : null,
      props.uptime_seconds ? parseInt(props.uptime_seconds, 10) : null,
      JSON.stringify(props.error_codes ? JSON.parse(props.error_codes) : []),
      raw.clientId, // fallback: use clientId as serial_number lookup
    ],
  );
}
```

---

## 8. 代碼變更清單

| 檔案 | 動作 | 說明 |
|------|------|------|
| `iot-hub/handlers/mqtt-subscriber.ts` | **NEW** | MQTT client entry point, message router |
| `iot-hub/parsers/XuhengAdapter.ts` | **NEW** | Xuheng MSG#4 → ParsedTelemetry (port from Phase 1) |
| `iot-hub/services/device-asset-cache.ts` | **NEW** | device_sn → asset_id (port from Phase 1, uses assets.serial_number) |
| `iot-hub/services/message-buffer.ts` | **NEW** | 2s debounce buffer (port from Phase 1) |
| `iot-hub/services/telemetry-aggregator.ts` | **MODIFY** | Add 6 new aggregation columns to SELECT + UPSERT |
| `iot-hub/handlers/ingest-telemetry.ts` | **unchanged** | AWS Lambda path stays untouched |
| `iot-hub/handlers/telemetry-webhook.ts` | **unchanged** | HTTP POST path stays as secondary |

---

## 9. 測試策略

| Test Suite | Scope | Technique |
|-----------|-------|-----------|
| `XuhengAdapter.test.ts` | Parse MSG#4 → ParsedTelemetry | Unit test: mock JSON input, assert numeric outputs |
| `DeviceAssetCache.test.ts` | Resolve + refresh cycle | Unit test: mock pool.query, verify cache invalidation |
| `MessageBuffer.test.ts` | Debounce + flush | Unit test: fake timers, verify single write per asset |
| `mqtt-subscriber.test.ts` | Message routing | Integration test: mock MQTT client, verify correct handler called per message type |
| `telemetry-aggregator.test.ts` | Enhanced aggregation | Integration test: insert test rows → run aggregation → verify all 8 columns |

### Test Data Patterns

```typescript
// Minimal MSG#4 for XuhengAdapter test
const MSG4_FIXTURE: XuhengRawMessage = {
  clientId: "TEST_CLIENT_001",
  productKey: "ems",
  timeStamp: "1772620029130",
  data: {
    batList: [{ deviceSn: "BAT_SN_001", properties: {
      total_bat_soc: "75.5", total_bat_power: "-3.2",
      total_bat_dailyChargedEnergy: "12.5", total_bat_dailyDischargedEnergy: "8.3",
    }}],
    pvList: [{ deviceSn: "PV_SN_001", properties: {
      pv_totalPower: "4.1", pv_dailyEnergy: "18.5",
    }}],
    gridList: [{ deviceSn: "GRID_SN_001", properties: {
      grid_totalActivePower: "-1.8", grid_dailyBuyEnergy: "5.2", grid_dailySellEnergy: "3.1",
    }}],
    loadList: [{ deviceSn: "LOAD_SN_001", properties: { load1_totalPower: "2.3" }}],
    flloadList: [{ deviceSn: "FL_SN_001", properties: { flload_totalPower: "0.5" }}],
  },
};
```

---

## 10. 受影響的組件

| 模組 | 影響 | 說明 |
|------|------|------|
| M1 IoT Hub | **PRIMARY** | 5 new/modified files |
| M4 Market & Billing | **downstream** | Reads enhanced asset_hourly_metrics |
| M5 BFF | **downstream** | Reads enhanced asset_hourly_metrics + ems_health |
| Shared Layer | **dependency** | New types in shared/types/telemetry.ts |
| Database | **dependency** | migration_v5.13.sql must run first |

---

## Document History

| Version | Date | Summary |
|---------|------|---------|
| v5.2 | 2026-02-27 | 初始版本：IoT Hub Lambda + IoT Core |
| v5.3 | 2026-02-27 | HEMS 單戶場景 |
| v5.8 | 2026-03-02 | Data Contract — telemetry_history → asset_hourly_metrics |
| v5.11 | 2026-03-05 | Dual Pool — Service Pool for telemetry-webhook + aggregator |
| **v5.13** | **2026-03-05** | **Block 1: mqtt-subscriber.ts (MQTT client + message router) + XuhengAdapter.ts (MSG#4 parser) + DeviceAssetCache + MessageBuffer (port from Phase 1, commit 00a6133); aggregator expanded +6 columns; ems_health writer; all using Service Pool** |
