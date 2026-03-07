# M1: IoT Hub Module -- 5-min Aggregator & Factor Fix

> **Module Version**: v5.15
> **Parent**: [00_MASTER_ARCHITECTURE_v5.15.md](./00_MASTER_ARCHITECTURE_v5.15.md)
> **Last Updated**: 2026-03-07
> **Description**: New 5-min aggregator + hourly aggregator source/factor fix
> **Core Theme**: 5-minute telemetry pipeline for SC/TOU attribution + P0 energy inflation bug fix

---

## Changes from v5.14

| Aspect | v5.14 | v5.15 |
|--------|-------|-------|
| Aggregation pipeline | Raw telemetry -> hourly (direct) | Raw -> **5-min** -> hourly (two-stage) |
| 5-min aggregator | Does not exist | **NEW**: `telemetry-5min-aggregator.ts` |
| Hourly aggregator source | `telemetry_history` | **`asset_5min_metrics`** |
| Hourly aggregator factor | `1.0/4` (WRONG -- assumes 15-min) | Removed (5-min data is already kWh) |
| Energy value accuracy | **3x inflated** (factor 1/4 for 5-min data) | **Correct** |
| New table written | None | `asset_5min_metrics` (partitioned) |
| XuhengAdapter | v5.14 (13 fields) | Unchanged |
| MessageBuffer | v5.14 (11 cols) | Unchanged |
| mqtt-subscriber | v5.13 | Unchanged |

---

## 1. Architecture Overview

```
EMQX Broker (1883)
  | topic: xuheng/+/+/data (~5s interval)
  |
  v
mqtt-subscriber.ts          (v5.13 -- no changes in v5.15)
  |
  +- classify message type (MSG#0-4)
  +- MSG#4 --> XuhengAdapter.parse()   (v5.14: 13 fields -- unchanged)
  |              |
  |              v
  |           ParsedTelemetry (23 fields -- unchanged)
  |              |
  |              +-->  MessageBuffer (2s debounce)
  |              |       |
  |              |       v
  |              |    writer --> INSERT telemetry_history (11 cols -- unchanged)
  |              |
  |              +-->  state-updater --> UPSERT device_state (unchanged)
  |
  +- MSG#0 --> ems-health-updater --> UPSERT ems_health (unchanged)
  +- MSG#1-3 --> (log + ignore)

telemetry-5min-aggregator.ts    <-- v5.15 NEW
  | cron: every 5 min (:00, :05, :10, ..., :55)
  | source: telemetry_history (last 5 min)
  | target: asset_5min_metrics (partitioned by day)
  | factor: 1/12 (CORRECT: 5-min window = 1/12 of an hour)
  |
  v
asset_5min_metrics (partitioned)
  +-- pv_energy_kwh, load_kwh, grid_import_kwh, grid_export_kwh,
      bat_charge_kwh, bat_discharge_kwh, battery_soc, battery_power_kw

telemetry-aggregator.ts         <-- v5.15 MODIFIED
  | cron: every hour at :05
  | source: asset_5min_metrics (NOT telemetry_history)    <-- CHANGED
  | target: asset_hourly_metrics (unchanged schema)
  | factor: none (5-min data is already in kWh)           <-- FIXED
  |
  v
asset_hourly_metrics (11 data columns -- unchanged)
```

### Pool Assignment (unchanged from v5.14)

| Component | Pool | Rationale |
|-----------|------|-----------|
| mqtt-subscriber | **Service Pool** | Hardware data, no JWT |
| XuhengAdapter | N/A (pure function) | No DB access |
| MessageBuffer | N/A (in-memory) | No DB access |
| writer (INSERT telemetry_history) | **Service Pool** | Cron/subscriber component |
| state-updater (UPSERT device_state) | **Service Pool** | Cron/subscriber component |
| ems-health-updater (UPSERT ems_health) | **Service Pool** | Cron/subscriber component |
| **telemetry-5min-aggregator (cron)** | **Service Pool** | **v5.15 NEW** |
| telemetry-aggregator (cron) | **Service Pool** | Unchanged from v5.11 |

---

## 2. New Service: `telemetry-5min-aggregator.ts`

### S2.1 Purpose

Aggregates raw telemetry from `telemetry_history` into 5-minute windows in `asset_5min_metrics`. This provides the granularity needed for SC/TOU mode attribution in M4 billing.

### S2.2 Cron Schedule

```typescript
// Run every 5 minutes, at :00, :05, :10, ..., :55
cron.schedule("*/5 * * * *", () => run5MinAggregation(pool));
```

### S2.3 Time Window

```typescript
// Aggregate the PREVIOUS 5-min window
// e.g. if now is 14:07, aggregate 14:00-14:05
const now = new Date();
const windowEnd = new Date(now);
windowEnd.setSeconds(0, 0);
windowEnd.setMinutes(Math.floor(now.getMinutes() / 5) * 5);
const windowStart = new Date(windowEnd);
windowStart.setMinutes(windowStart.getMinutes() - 5);
```

### S2.4 Aggregation SQL

```sql
SELECT
  asset_id,
  -- Energy metrics: power (kW) * 1/12 hour = kWh for a 5-min window
  SUM(CASE WHEN battery_power > 0 THEN battery_power * (1.0/12) ELSE 0 END)       AS bat_charge,
  SUM(CASE WHEN battery_power < 0 THEN ABS(battery_power) * (1.0/12) ELSE 0 END)  AS bat_discharge,
  SUM(COALESCE(pv_power, 0) * (1.0/12))                                             AS pv_energy,
  SUM(CASE WHEN grid_power_kw > 0 THEN grid_power_kw * (1.0/12) ELSE 0 END)        AS grid_import,
  SUM(CASE WHEN grid_power_kw < 0 THEN ABS(grid_power_kw) * (1.0/12) ELSE 0 END)   AS grid_export,
  SUM(COALESCE(load_power, 0) * (1.0/12))                                            AS load_energy,
  AVG(battery_soc)                                                                    AS avg_soc,
  AVG(COALESCE(battery_power, 0))                                                    AS avg_power,
  COUNT(*)                                                                            AS count
FROM telemetry_history
WHERE recorded_at >= $1 AND recorded_at < $2
GROUP BY asset_id
```

**Factor explanation:** Raw telemetry arrives every ~5 seconds. Within a 5-minute window, there are ~60 data points. Each data point is instantaneous power (kW). To convert to energy (kWh) for the 5-minute period: `power_kW * (5 minutes / 60 minutes) = power_kW * (1/12)`. The `SUM` across all data points in the window with `1/12` factor gives the total energy. Since data points are approximately uniform (~5s each), and a 5-min window is 1/12 of an hour, the total energy contribution per data point is `power * (1/12) / num_points * num_points = power * (1/12)` for each point. However, with ~60 data points per 5 minutes, each point represents ~5 seconds = 1/720 hour. So the correct per-point factor is `1/720`, not `1/12`.

**Corrected factor:** `power * (1.0/720)` per raw data point, **OR** `AVG(power) * (1.0/12)` per 5-min window.

Using AVG approach (cleaner):

```sql
SELECT
  asset_id,
  -- AVG power over window * (5 min / 60 min) = kWh for 5-min window
  GREATEST(0, AVG(CASE WHEN battery_power > 0 THEN battery_power END)) * (1.0/12) AS bat_charge,
  GREATEST(0, AVG(CASE WHEN battery_power < 0 THEN ABS(battery_power) END)) * (1.0/12) AS bat_discharge,
  COALESCE(AVG(pv_power), 0) * (1.0/12)                                        AS pv_energy,
  GREATEST(0, AVG(CASE WHEN grid_power_kw > 0 THEN grid_power_kw END)) * (1.0/12) AS grid_import,
  GREATEST(0, AVG(CASE WHEN grid_power_kw < 0 THEN ABS(grid_power_kw) END)) * (1.0/12) AS grid_export,
  COALESCE(AVG(load_power), 0) * (1.0/12)                                       AS load_energy,
  AVG(battery_soc)                                                               AS avg_soc,
  AVG(COALESCE(battery_power, 0))                                                AS avg_power,
  COUNT(*)                                                                        AS count
FROM telemetry_history
WHERE recorded_at >= $1 AND recorded_at < $2
GROUP BY asset_id
```

### S2.5 UPSERT into `asset_5min_metrics`

```sql
INSERT INTO asset_5min_metrics
  (asset_id, recorded_at,
   pv_energy_kwh, load_kwh, grid_import_kwh, grid_export_kwh,
   bat_charge_kwh, bat_discharge_kwh,
   battery_soc, battery_power_kw,
   data_points_count, created_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
ON CONFLICT (asset_id, recorded_at) DO UPDATE SET
  pv_energy_kwh     = EXCLUDED.pv_energy_kwh,
  load_kwh          = EXCLUDED.load_kwh,
  grid_import_kwh   = EXCLUDED.grid_import_kwh,
  grid_export_kwh   = EXCLUDED.grid_export_kwh,
  bat_charge_kwh    = EXCLUDED.bat_charge_kwh,
  bat_discharge_kwh = EXCLUDED.bat_discharge_kwh,
  battery_soc       = EXCLUDED.battery_soc,
  battery_power_kw  = EXCLUDED.battery_power_kw,
  data_points_count = EXCLUDED.data_points_count
```

---

## 3. Modified Service: `telemetry-aggregator.ts`

### S3.1 Changes

1. **Source table**: `telemetry_history` -> `asset_5min_metrics`
2. **Factor removal**: No `* (1.0/4)` or `* (1.0/12)` -- data is already in kWh
3. **Aggregation**: Simple `SUM()` of 12 five-minute windows per hour

### S3.2 Updated Aggregation SQL

```sql
-- v5.15: Source is asset_5min_metrics (already in kWh)
-- No conversion factor needed -- just SUM the 12 five-minute windows

SELECT
  asset_id,
  SUM(bat_charge_kwh)                    AS charge,
  SUM(bat_discharge_kwh)                 AS discharge,
  SUM(pv_energy_kwh)                     AS pv_generation,
  SUM(grid_import_kwh)                   AS grid_import,
  SUM(grid_export_kwh)                   AS grid_export,
  SUM(load_kwh)                          AS load_consumption,
  AVG(battery_soc)                       AS avg_soc,
  MAX(ABS(COALESCE(battery_power_kw, 0))) AS peak_bat_power,
  -- v5.14 columns: still read from telemetry_history for battery physical state
  -- (SoH/voltage/temperature not in asset_5min_metrics)
  NULL                                   AS avg_battery_soh,
  NULL                                   AS avg_battery_voltage,
  NULL                                   AS avg_battery_temperature,
  SUM(data_points_count)                 AS count
FROM asset_5min_metrics
WHERE recorded_at >= $1 AND recorded_at < $2
GROUP BY asset_id
```

**Note on battery physical state (SoH/voltage/temperature):** These columns exist in `telemetry_history` but NOT in `asset_5min_metrics` (they are not needed for SC/TOU attribution). The hourly aggregator should still query `telemetry_history` for these three AVG columns in a separate query, or they can be added to `asset_5min_metrics` in a future version. For v5.15, use a supplementary query:

```sql
-- Supplementary: battery physical state from telemetry_history
SELECT
  asset_id,
  AVG(battery_soh)          AS avg_battery_soh,
  AVG(battery_voltage)      AS avg_battery_voltage,
  AVG(battery_temperature)  AS avg_battery_temperature
FROM telemetry_history
WHERE recorded_at >= $1 AND recorded_at < $2
GROUP BY asset_id
```

The hourly aggregator merges both result sets by asset_id before writing to `asset_hourly_metrics`.

### S3.3 UPSERT

Unchanged from v5.14. Same 14-column UPSERT into `asset_hourly_metrics`.

### S3.4 Bug Fix Impact

| Metric | Before (v5.14, factor 1/4) | After (v5.15, correct) | Ratio |
|--------|---------------------------|------------------------|-------|
| charge kWh | 3x inflated | Correct | 1/3 |
| discharge kWh | 3x inflated | Correct | 1/3 |
| PV generation kWh | 3x inflated | Correct | 1/3 |
| grid import kWh | 3x inflated | Correct | 1/3 |
| grid export kWh | 3x inflated | Correct | 1/3 |
| load consumption kWh | 3x inflated | Correct | 1/3 |
| AVG SoC | Correct (AVG not affected by count) | Correct | 1x |
| Peak power | Correct (MAX not affected by factor) | Correct | 1x |

**Downstream impact:** All M4 billing calculations (baseline cost, actual cost, bestTou cost, savings) will produce values approximately 1/3 of their current values after this fix. Revenue figures will decrease. This is the correct behavior -- current values are inflated.

---

## 4. What Stays Unchanged

| Component | v5.14 Version | v5.15 Status |
|-----------|--------------|-------------|
| mqtt-subscriber.ts | v5.13 | Unchanged |
| XuhengAdapter.ts | v5.14 (13 fields) | Unchanged |
| message-buffer.ts | v5.14 (11 cols) | Unchanged |
| device-asset-cache.ts | v5.13 | Unchanged |
| ingest-telemetry.ts | AWS Lambda path | Unchanged |
| shared/types/telemetry.ts | v5.14 (23 fields) | Unchanged |

---

## 5. Code Change List

| File | Action | Description |
|------|--------|-------------|
| `iot-hub/services/telemetry-5min-aggregator.ts` | **NEW** | 5-min cron: reads telemetry_history, writes asset_5min_metrics (partitioned) |
| `iot-hub/services/telemetry-aggregator.ts` | **MODIFY** | Source: asset_5min_metrics (not telemetry_history); remove factor 1/4; SUM 5-min windows; supplementary query for SoH/voltage/temp |
| All other M1 files | **unchanged** | No impact |

---

## 6. Test Strategy

| Test Suite | Scope | v5.15 Changes |
|-----------|-------|---------------|
| `telemetry-5min-aggregator.test.ts` | **NEW** | 5-min window calculation; factor 1/12 correctness; writes to asset_5min_metrics; handles missing data; idempotent UPSERT |
| `telemetry-aggregator.test.ts` | **MODIFY** | Source changed to asset_5min_metrics; no factor in SQL; SUM of 12 windows = hourly total; supplementary SoH/voltage/temp query |
| `XuhengAdapter.test.ts` | Unchanged | v5.14 tests still pass |
| `mqtt-subscriber.test.ts` | Unchanged | v5.14 tests still pass |

### Key Test Scenarios

```typescript
// Test: 5-min aggregator produces correct kWh
// Given: 60 raw data points in 5 min, each with pv_power = 6.0 kW
// Expected: pv_energy_kwh = 6.0 * (1/12) = 0.5 kWh
// (AVG power = 6.0 kW, 5 min = 1/12 hour)

// Test: hourly aggregator correctly sums 12 five-minute windows
// Given: 12 windows each with pv_energy_kwh = 0.5
// Expected: pv_generation_kwh = 6.0 kWh

// Test: bug fix -- old factor would produce 1.5 kWh (6.0 * 1/4), new produces 0.5 (6.0 * 1/12)
```

---

## 7. Affected Components

| Module | Impact | Description |
|--------|--------|-------------|
| M1 IoT Hub | **PRIMARY** | 1 new file, 1 modified file |
| Database | **dependency** | migration_v5.15.sql must create asset_5min_metrics + partitions first |
| M4 Market & Billing | **downstream** | Reads asset_5min_metrics for SC/TOU attribution |
| M5 BFF | **downstream** | Dashboard queries hit asset_hourly_metrics (now correct values) |

---

## Document History

| Version | Date | Summary |
|---------|------|---------|
| v5.2 | 2026-02-27 | Initial: IoT Hub Lambda + IoT Core |
| v5.3 | 2026-02-27 | HEMS single-home |
| v5.8 | 2026-03-02 | Data Contract -- telemetry_history -> asset_hourly_metrics |
| v5.11 | 2026-03-05 | Dual Pool -- Service Pool for subscriber + aggregator |
| v5.13 | 2026-03-05 | Block 1: mqtt-subscriber + XuhengAdapter + aggregator +6 cols + ems_health |
| v5.14 | 2026-03-06 | Block 1: XuhengAdapter +9 bat.properties; aggregator +3 AVG rollup cols |
| **v5.15** | **2026-03-07** | **New telemetry-5min-aggregator.ts (cron */5, writes asset_5min_metrics partitioned); hourly aggregator source changed from telemetry_history to asset_5min_metrics; factor fix 1/4->removed (5-min data already kWh); P0 3x energy inflation bug fixed; supplementary query for battery physical state** |
