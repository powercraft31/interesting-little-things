# M1: IoT Hub Module — XuhengAdapter Deep Telemetry Expansion

> **模組版本**: v5.14
> **上層文件**: [00_MASTER_ARCHITECTURE_v5.14.md](./00_MASTER_ARCHITECTURE_v5.14.md)
> **最後更新**: 2026-03-06
> **說明**: Block 1 — Parse 9 additional `bat.properties` fields + aggregator rollup expansion
> **核心主題**: XuhengAdapter field expansion + telemetry-aggregator new AVG rollup rules

---

## Changes from v5.13

| Aspect | v5.13 | v5.14 |
|--------|-------|-------|
| XuhengAdapter bat.properties | 4 fields | 13 fields (+9) |
| ParsedTelemetry interface | 14 fields | 23 fields (+9) |
| telemetry_history columns written | battery_soc, battery_power, pv_power, grid_power_kw, load_power, grid_import_kwh, grid_export_kwh | +battery_soh, +battery_voltage, +battery_current, +battery_temperature |
| asset_hourly_metrics rollup | 8 columns (charge, discharge, pv, grid_import, grid_export, load, avg_soc, peak_power) | 11 columns (+avg_battery_soh, +avg_battery_voltage, +avg_battery_temperature) |
| mqtt-subscriber.ts | Unchanged | Unchanged (adapter change is transparent) |
| DeviceAssetCache | Unchanged | Unchanged |

---

## 1. Architecture Overview

```
EMQX Broker (1883)
  | topic: xuheng/+/+/data
  |
  v
mqtt-subscriber.ts          (v5.13 — no changes needed)
  |
  +- classify message type (MSG#0-4)
  |
  +- MSG#4 --> XuhengAdapter.parse()   <-- v5.14: +9 fields parsed
  |              |
  |              v
  |           ParsedTelemetry (+9 fields)
  |              |
  |              +-->  MessageBuffer (2s debounce)
  |              |       |
  |              |       v
  |              |    writer --> INSERT telemetry_history (+4 new cols)
  |              |
  |              +-->  state-updater --> UPSERT device_state (unchanged)
  |
  +- MSG#0 --> ems-health-updater --> UPSERT ems_health (unchanged)
  |
  +- MSG#1-3 --> (log + ignore)

telemetry-aggregator.ts     <-- v5.14: +3 AVG columns
  | cron: every hour at :05
  |
  v
asset_hourly_metrics        (11 data columns total)
  +-- charge, discharge, pv, grid_import, grid_export,
      load, avg_soc, peak_battery_power
  +-- avg_battery_soh, avg_battery_voltage,              <-- v5.14 NEW
      avg_battery_temperature
```

### Pool Assignment (unchanged from v5.13)

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

## 2. XuhengAdapter — 9 New `bat.properties` Fields

### §2.1 Field Mapping

| MQTT Source Field | Note | ParsedTelemetry Field | DB Column | Type |
|-------------------|------|----------------------|-----------|------|
| `total_bat_soh` | BMS-reported SoH % | `batterySoh` | `battery_soh` | REAL |
| `total_bat_vlotage` | **typo in source** ("vlotage") | `batteryVoltage` | `battery_voltage` | REAL |
| `total_bat_current` | | `batteryCurrent` | `battery_current` | REAL |
| `total_bat_temperature` | | `batteryTemperature` | `battery_temperature` | REAL |
| `total_bat_maxChargeVoltage` | | `maxChargeVoltage` | — (not stored in telemetry_history) | REAL |
| `total_bat_maxChargeCurrent` | | `maxChargeCurrent` | — (not stored in telemetry_history) | REAL |
| `total_bat_maxDischargeCurrent` | | `maxDischargeCurrent` | — (not stored in telemetry_history) | REAL |
| `total_bat_totalChargedEnergy` | Cumulative lifetime kWh | `totalChargeKwh` | — (not stored; daily is sufficient) | REAL |
| `total_bat_totalDischargedEnergy` | Cumulative lifetime kWh | `totalDischargeKwh` | — (not stored; daily is sufficient) | REAL |

**Design decision:** Only 4 of the 9 new fields are written to `telemetry_history` (SoH, voltage, current, temperature). The remaining 5 are available in `ParsedTelemetry` for future use (charge/discharge limits for DP parameter auto-detection, cumulative energy for SoH cross-validation) but are NOT persisted to avoid unnecessary column bloat.

### §2.2 Parsing Logic

All 9 new values arrive as strings from MQTT `bat.properties`. Use existing `safeFloat()` function (already in XuhengAdapter):

```typescript
// In XuhengAdapter.parse() — additions to the return object:
return {
  // ... existing 14 fields (unchanged) ...

  // v5.14: 9 new bat.properties fields
  batterySoh: safeFloat(bat.properties.total_bat_soh),
  batteryVoltage: safeFloat(bat.properties.total_bat_vlotage),  // note: source typo "vlotage"
  batteryCurrent: safeFloat(bat.properties.total_bat_current),
  batteryTemperature: safeFloat(bat.properties.total_bat_temperature),
  maxChargeVoltage: safeFloat(bat.properties.total_bat_maxChargeVoltage),
  maxChargeCurrent: safeFloat(bat.properties.total_bat_maxChargeCurrent),
  maxDischargeCurrent: safeFloat(bat.properties.total_bat_maxDischargeCurrent),
  totalChargeKwh: safeFloat(bat.properties.total_bat_totalChargedEnergy),
  totalDischargeKwh: safeFloat(bat.properties.total_bat_totalDischargedEnergy),
};
```

### §2.3 Type Expansion (`shared/types/telemetry.ts`)

The `XuhengRawMessage.data.batList[].properties` interface gains 9 optional string fields. The `ParsedTelemetry` interface gains 9 numeric fields. See [09_SHARED_LAYER_v5.14.md](./09_SHARED_LAYER_v5.14.md) for full type definitions.

---

## 3. MessageBuffer — Write Path Enhancement

### §3.1 INSERT Statement Update

The `flushOne()` method in `message-buffer.ts` must write the 4 new telemetry_history columns:

```typescript
// v5.14: Enhanced INSERT — +4 battery state columns
await this.pool.query(
  `INSERT INTO telemetry_history
     (asset_id, recorded_at, battery_soc, battery_power, pv_power,
      grid_power_kw, load_power, grid_import_kwh, grid_export_kwh,
      battery_soh, battery_voltage, battery_current, battery_temperature)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
  [
    assetId, t.recordedAt, t.batterySoc, t.batteryPowerKw,
    t.pvPowerKw, t.gridPowerKw, t.loadPowerKw,
    t.gridDailyBuyKwh, t.gridDailySellKwh,
    // v5.14 new columns (NULL-safe — safeFloat returns 0 for missing)
    t.batterySoh || null,          // store NULL if BMS doesn't report SoH
    t.batteryVoltage || null,
    t.batteryCurrent || null,
    t.batteryTemperature || null,
  ],
);
```

**NULL strategy:** Use `|| null` to convert `0` to `NULL` for physical state metrics. Reason: `0` SoH or `0` voltage is a valid but unlikely reading; `NULL` clearly indicates "not reported by BMS". The aggregator uses `AVG()` which ignores NULLs — correct behavior.

---

## 4. Telemetry Aggregator — New Rollup Rules

### §4.1 Rollup Rule Design

| Field Category | Rollup Function | Rationale |
|---------------|----------------|-----------|
| Energy metrics (charge, discharge, pv, grid, load) | **SUM** (power × interval) | Cumulative energy over the hour |
| SoC | **AVG** | Representative state across the hour |
| Peak power | **MAX(ABS(...))** | Worst-case power draw |
| **SoH** (v5.14) | **AVG** | Slowly-changing; AVG smooths noise |
| **Voltage** (v5.14) | **AVG** | Physical state; AVG is representative |
| **Temperature** (v5.14) | **AVG** | Physical state; AVG is representative |

### §4.2 Enhanced Aggregation SQL

```sql
SELECT
  asset_id,
  -- v5.8/v5.13: existing 8 aggregation columns (unchanged)
  SUM(CASE WHEN battery_power > 0 THEN battery_power * (1.0/4) ELSE 0 END)     AS charge,
  SUM(CASE WHEN battery_power < 0 THEN ABS(battery_power) * (1.0/4) ELSE 0 END) AS discharge,
  SUM(COALESCE(pv_power, 0) * (1.0/4))                                           AS pv_generation,
  SUM(CASE WHEN grid_power_kw > 0 THEN grid_power_kw * (1.0/4) ELSE 0 END)      AS grid_import,
  SUM(CASE WHEN grid_power_kw < 0 THEN ABS(grid_power_kw) * (1.0/4) ELSE 0 END) AS grid_export,
  SUM(COALESCE(load_power, 0) * (1.0/4))                                          AS load_consumption,
  AVG(battery_soc)                                                                 AS avg_soc,
  MAX(ABS(COALESCE(battery_power, 0)))                                             AS peak_bat_power,
  -- v5.14 NEW: battery physical state averages
  AVG(battery_soh)                                                                 AS avg_battery_soh,
  AVG(battery_voltage)                                                             AS avg_battery_voltage,
  AVG(battery_temperature)                                                         AS avg_battery_temperature,
  COUNT(*)                                                                         AS count
FROM telemetry_history
WHERE recorded_at >= $1 AND recorded_at < $2
GROUP BY asset_id
```

### §4.3 UPSERT Enhancement

```sql
INSERT INTO asset_hourly_metrics
  (asset_id, hour_timestamp,
   total_charge_kwh, total_discharge_kwh,
   pv_generation_kwh, grid_import_kwh, grid_export_kwh,
   load_consumption_kwh, avg_battery_soc, peak_battery_power_kw,
   avg_battery_soh, avg_battery_voltage, avg_battery_temperature,
   data_points_count, created_at, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW())
ON CONFLICT (asset_id, hour_timestamp) DO UPDATE SET
  total_charge_kwh      = EXCLUDED.total_charge_kwh,
  total_discharge_kwh   = EXCLUDED.total_discharge_kwh,
  pv_generation_kwh     = EXCLUDED.pv_generation_kwh,
  grid_import_kwh       = EXCLUDED.grid_import_kwh,
  grid_export_kwh       = EXCLUDED.grid_export_kwh,
  load_consumption_kwh  = EXCLUDED.load_consumption_kwh,
  avg_battery_soc       = EXCLUDED.avg_battery_soc,
  peak_battery_power_kw = EXCLUDED.peak_battery_power_kw,
  avg_battery_soh       = EXCLUDED.avg_battery_soh,
  avg_battery_voltage   = EXCLUDED.avg_battery_voltage,
  avg_battery_temperature = EXCLUDED.avg_battery_temperature,
  data_points_count     = EXCLUDED.data_points_count,
  updated_at            = NOW()
```

---

## 5. 代碼變更清單

| 檔案 | 動作 | 說明 |
|------|------|------|
| `iot-hub/parsers/XuhengAdapter.ts` | **MODIFY** | Add 9 new `bat.properties` field parsing |
| `iot-hub/services/message-buffer.ts` | **MODIFY** | Add 4 new columns to INSERT statement |
| `iot-hub/services/telemetry-aggregator.ts` | **MODIFY** | Add 3 new AVG columns to SELECT + UPSERT |
| `shared/types/telemetry.ts` | **MODIFY** | Expand `XuhengRawMessage.batList.properties` (+9 fields) and `ParsedTelemetry` (+9 fields) |
| `iot-hub/handlers/mqtt-subscriber.ts` | **unchanged** | XuhengAdapter change is transparent |
| `iot-hub/services/device-asset-cache.ts` | **unchanged** | No impact |
| `iot-hub/handlers/ingest-telemetry.ts` | **unchanged** | AWS Lambda path stays untouched |

---

## 6. 測試策略

| Test Suite | Scope | v5.14 Changes |
|-----------|-------|---------------|
| `XuhengAdapter.test.ts` | Parse MSG#4 → ParsedTelemetry | Add assertions for 9 new fields; test with missing fields (should default to 0) |
| `mqtt-subscriber.test.ts` | Message routing | Add MSG#4 fixture with new bat.properties fields; verify all 13 values in ParsedTelemetry |
| `telemetry-aggregator.test.ts` | Enhanced aggregation | Insert test rows with battery_soh/voltage/temperature → run aggregation → verify 11 output columns |
| `message-buffer.test.ts` | DB write | Verify INSERT includes 4 new columns; verify NULL handling for 0 values |

### Test Data Patterns

```typescript
// v5.14: MSG#4 fixture with all 13 bat.properties
const MSG4_FIXTURE_V514: XuhengRawMessage = {
  clientId: "TEST_CLIENT_001",
  productKey: "ems",
  timeStamp: "1772620029130",
  data: {
    batList: [{ deviceSn: "BAT_SN_001", properties: {
      // v5.13 existing
      total_bat_soc: "75.5",
      total_bat_power: "-3.2",
      total_bat_dailyChargedEnergy: "12.5",
      total_bat_dailyDischargedEnergy: "8.3",
      // v5.14 new
      total_bat_soh: "98.2",
      total_bat_vlotage: "51.6",       // note: "vlotage" typo is in the source
      total_bat_current: "-6.2",
      total_bat_temperature: "28.5",
      total_bat_maxChargeVoltage: "57.6",
      total_bat_maxChargeCurrent: "25.0",
      total_bat_maxDischargeCurrent: "25.0",
      total_bat_totalChargedEnergy: "1250.8",
      total_bat_totalDischargedEnergy: "1180.3",
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

// Expected parsed output for new fields:
// batterySoh: 98.2, batteryVoltage: 51.6, batteryCurrent: -6.2,
// batteryTemperature: 28.5, maxChargeVoltage: 57.6, maxChargeCurrent: 25.0,
// maxDischargeCurrent: 25.0, totalChargeKwh: 1250.8, totalDischargeKwh: 1180.3
```

---

## 7. 受影響的組件

| 模組 | 影響 | 說明 |
|------|------|------|
| M1 IoT Hub | **PRIMARY** | 3 files modified (XuhengAdapter, MessageBuffer, aggregator) |
| Shared Layer | **dependency** | Type expansion in shared/types/telemetry.ts |
| Database | **dependency** | migration_v5.14.sql must run first |
| M4 Market & Billing | **downstream** | No direct impact — M4 reads existing columns from asset_hourly_metrics |
| M5 BFF | **downstream** | No direct impact — future battery health dashboards may read avg_battery_soh |

---

## Document History

| Version | Date | Summary |
|---------|------|---------|
| v5.2 | 2026-02-27 | 初始版本：IoT Hub Lambda + IoT Core |
| v5.3 | 2026-02-27 | HEMS 單戶場景 |
| v5.8 | 2026-03-02 | Data Contract — telemetry_history -> asset_hourly_metrics |
| v5.11 | 2026-03-05 | Dual Pool — Service Pool for telemetry-webhook + aggregator |
| v5.13 | 2026-03-05 | Block 1: mqtt-subscriber + XuhengAdapter + aggregator +6 columns + ems_health |
| **v5.14** | **2026-03-06** | **Block 1: XuhengAdapter +9 bat.properties (SoH, voltage, current, temperature, charge/discharge limits, cumulative energy); MessageBuffer writes 4 new telemetry_history columns; aggregator +3 AVG rollup columns (avg_battery_soh, avg_battery_voltage, avg_battery_temperature); AVG() rollup for physical state metrics** |
