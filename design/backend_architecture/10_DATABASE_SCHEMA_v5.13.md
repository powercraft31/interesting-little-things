# Database Schema — v5.13 Column Expansion & Seed Strategy

> **模組版本**: v5.13
> **上層文件**: [00_MASTER_ARCHITECTURE_v5.13.md](./00_MASTER_ARCHITECTURE_v5.13.md)
> **最後更新**: 2026-03-05
> **說明**: asset_hourly_metrics 新增欄位（PV/Grid/Load/SOC 聚合）、ems_health 新表、migration_v5.13.sql + seed_v5.13.sql 策略
> **核心主題**: Block 1 data pipeline output tables + Block 2 aggregator expansion

---

## v5.13 升版說明

### 問題陳述

1. **Block 1:** The MQTT subscriber needs to write to `ems_health` (EMS hardware status from MSG#0). This table exists in the Phase 1 Bridge migration (`mqtt-bridge/migrations/001_phase1_schema.sql`, commit `00a6133`) but was never added to the main backend DDL.
2. **Block 2:** The aggregator currently only computes `total_charge_kwh` and `total_discharge_kwh` in `asset_hourly_metrics`. To calculate Tarifa Branca savings, self-consumption ratio, and Optimization Alpha, we need additional hourly aggregates: PV generation, grid import/export, load consumption, and average battery SOC.
3. **Seed data:** Need realistic Xuheng MSG#4-format mock data in `seed_v5.13.sql` to test the full pipeline (MQTT → parse → DB → aggregate → billing → BFF).

### 解決方案

- ALTER `asset_hourly_metrics` — add 6 new columns
- CREATE `ems_health` — new table for EMS hardware status
- New partition: `telemetry_history_2026_04` (next month prep)
- `seed_v5.13.sql` — Xuheng-format mock samples + pre-aggregated hourly data

---

## 1. Schema Changes — `migration_v5.13.sql`

### 1.1 ALTER asset_hourly_metrics — Add Aggregation Columns

```sql
-- ============================================================
-- migration_v5.13.sql — Block 2: Aggregator Expansion
-- ============================================================

-- 1. New aggregation columns for asset_hourly_metrics
ALTER TABLE asset_hourly_metrics
  ADD COLUMN IF NOT EXISTS pv_generation_kwh    NUMERIC(10,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS grid_import_kwh      NUMERIC(10,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS grid_export_kwh      NUMERIC(10,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS load_consumption_kwh NUMERIC(10,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_battery_soc      NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS peak_battery_power_kw NUMERIC(8,3);
```

**Column Definitions:**

| Column | Type | Default | Source (aggregator SQL) |
|--------|------|---------|----------------------|
| `pv_generation_kwh` | NUMERIC(10,4) | 0 | `SUM(pv_power * interval_hours)` from telemetry_history |
| `grid_import_kwh` | NUMERIC(10,4) | 0 | `SUM(CASE WHEN grid_power_kw > 0 THEN grid_power_kw * interval_hours ELSE 0 END)` |
| `grid_export_kwh` | NUMERIC(10,4) | 0 | `SUM(CASE WHEN grid_power_kw < 0 THEN ABS(grid_power_kw) * interval_hours ELSE 0 END)` |
| `load_consumption_kwh` | NUMERIC(10,4) | 0 | `SUM(load_power * interval_hours)` |
| `avg_battery_soc` | NUMERIC(5,2) | NULL | `AVG(battery_soc)` |
| `peak_battery_power_kw` | NUMERIC(8,3) | NULL | `MAX(ABS(battery_power))` — useful for peak shaving analysis |

### 1.2 CREATE ems_health — EMS Hardware Status

```sql
-- 2. EMS health tracking (Block 1: parsed from MSG#0 emsList)
CREATE TABLE IF NOT EXISTS ems_health (
  id              SERIAL       PRIMARY KEY,
  asset_id        VARCHAR(50)  NOT NULL REFERENCES assets(asset_id) ON DELETE CASCADE,
  client_id       VARCHAR(100) NOT NULL,
  firmware_version VARCHAR(50),
  wifi_signal_dbm  INTEGER,
  uptime_seconds   BIGINT,
  error_codes      JSONB        DEFAULT '[]',
  last_heartbeat   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_ems_health_asset UNIQUE (asset_id)
);

CREATE INDEX IF NOT EXISTS idx_ems_health_heartbeat
  ON ems_health (last_heartbeat DESC);
```

**Usage:**
- Written by: M1 `mqtt-subscriber.ts` (UPSERT on MSG#0)
- Read by: M5 BFF (fleet health dashboards, future scope)
- Pool: Service Pool (M1 component)

### 1.3 New Partition (Housekeeping)

```sql
-- 3. Next-month partition for telemetry_history
CREATE TABLE IF NOT EXISTS telemetry_history_2026_04
  PARTITION OF telemetry_history
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
```

### 1.4 RLS for ems_health

```sql
-- 4. ems_health has no org_id — scoped via asset_id FK JOIN to assets
-- No RLS policy needed (same pattern as device_state)
-- BFF access: JOIN assets a ON a.asset_id = eh.asset_id (RLS on assets filters)
```

---

## 2. Updated asset_hourly_metrics — Full Column List

After migration, the complete table schema:

```sql
CREATE TABLE asset_hourly_metrics (
  id                    BIGSERIAL    PRIMARY KEY,
  asset_id              VARCHAR(50)  NOT NULL REFERENCES assets(asset_id),
  hour_timestamp        TIMESTAMPTZ  NOT NULL,
  -- v5.8 original columns
  total_charge_kwh      NUMERIC(10,4) NOT NULL DEFAULT 0,
  total_discharge_kwh   NUMERIC(10,4) NOT NULL DEFAULT 0,
  data_points_count     INT           NOT NULL DEFAULT 0,
  -- v5.13 new columns
  pv_generation_kwh     NUMERIC(10,4) NOT NULL DEFAULT 0,
  grid_import_kwh       NUMERIC(10,4) NOT NULL DEFAULT 0,
  grid_export_kwh       NUMERIC(10,4) NOT NULL DEFAULT 0,
  load_consumption_kwh  NUMERIC(10,4) NOT NULL DEFAULT 0,
  avg_battery_soc       NUMERIC(5,2),
  peak_battery_power_kw NUMERIC(8,3),
  -- timestamps
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_asset_hourly UNIQUE (asset_id, hour_timestamp)
);
```

---

## 3. Table Count Update

| Category | v5.12 Count | v5.13 Delta | v5.13 Count |
|----------|------------|-------------|-------------|
| M6 Identity | 3 | — | 3 |
| M1 IoT Hub | 5 | +1 (ems_health) | 6 |
| M2 Optimization | 2 | — | 2 |
| M3 DR Dispatcher | 2 | — | 2 |
| M4 Market & Billing | 5 | — | 5 |
| M8 Admin Control | 4 | — | 4 |
| Housing (v5.12) | 1 | — | 1 |
| Shared Contract | 1 (asset_hourly_metrics) | — | 1 |
| **Total** | **23** | **+1** | **24** |

> Note: v5.12 master doc counted 22 tables, but including `asset_hourly_metrics` as shared contract table brings the actual count to 23. Adding `ems_health` → 24.

---

## 4. Seed Data Strategy — `seed_v5.13.sql`

### 4.1 Xuheng MSG#4 Mock Telemetry Rows

Insert realistic telemetry_history rows that mimic Xuheng-parsed data for asset `AST-001` over 48 hours (2 full days). Each hour gets 4 rows (15-min intervals).

```sql
-- seed_v5.13.sql — Realistic Xuheng-parsed telemetry for 2 days

-- Day 1: 2026-03-04 (yesterday) — good solar day
-- Pattern: charge 00:00-06:00 (off-peak), PV generation 06:00-18:00,
--          discharge 18:00-21:00 (peak), idle overnight

-- Example rows (hour 19:00 = peak discharge):
INSERT INTO telemetry_history
  (asset_id, recorded_at, battery_soc, battery_power, pv_power, grid_power_kw, load_power, grid_import_kwh, grid_export_kwh)
VALUES
  ('AST-001', '2026-03-04T19:00:00-03:00', 72.5, -3.2, 0.0, -1.8, 1.4, 0, 0.45),
  ('AST-001', '2026-03-04T19:15:00-03:00', 68.1, -3.1, 0.0, -1.6, 1.5, 0, 0.40),
  ('AST-001', '2026-03-04T19:30:00-03:00', 63.8, -3.3, 0.0, -1.9, 1.4, 0, 0.48),
  ('AST-001', '2026-03-04T19:45:00-03:00', 59.2, -3.0, 0.0, -1.5, 1.5, 0, 0.38);
-- ... (full 48h × 4 rows = 192 rows generated by seed script)
```

### 4.2 Pre-Aggregated asset_hourly_metrics

For testing Block 2 formulas without running the aggregator:

```sql
-- Pre-aggregated hourly metrics for AST-001, 2026-03-04

-- Off-peak charging hours (02:00-06:00)
INSERT INTO asset_hourly_metrics
  (asset_id, hour_timestamp, total_charge_kwh, total_discharge_kwh,
   pv_generation_kwh, grid_import_kwh, grid_export_kwh,
   load_consumption_kwh, avg_battery_soc, peak_battery_power_kw, data_points_count)
VALUES
  ('AST-001', '2026-03-04T02:00:00-03:00', 2.5, 0, 0, 2.5, 0, 0, 25.0, 2.5, 4),
  ('AST-001', '2026-03-04T03:00:00-03:00', 2.8, 0, 0, 2.8, 0, 0, 40.0, 2.8, 4),
  ('AST-001', '2026-03-04T04:00:00-03:00', 2.6, 0, 0, 2.6, 0, 0, 55.0, 2.6, 4),
  ('AST-001', '2026-03-04T05:00:00-03:00', 2.1, 0, 0, 2.1, 0, 0, 70.0, 2.1, 4),

-- Solar generation hours (10:00-14:00)
  ('AST-001', '2026-03-04T10:00:00-03:00', 0.5, 0, 3.2, 0, 1.5, 1.2, 82.0, 0.5, 4),
  ('AST-001', '2026-03-04T11:00:00-03:00', 0.3, 0, 4.1, 0, 2.3, 1.5, 85.0, 0.3, 4),
  ('AST-001', '2026-03-04T12:00:00-03:00', 0.2, 0, 4.5, 0, 2.8, 1.5, 88.0, 0.2, 4),
  ('AST-001', '2026-03-04T13:00:00-03:00', 0.1, 0, 3.8, 0, 2.0, 1.7, 90.0, 0.1, 4),

-- Peak discharge hours (18:00-21:00)
  ('AST-001', '2026-03-04T18:00:00-03:00', 0, 2.8, 0, 0, 0.5, 2.3, 85.0, 2.8, 4),
  ('AST-001', '2026-03-04T19:00:00-03:00', 0, 3.2, 0, 0, 0.6, 2.6, 72.0, 3.3, 4),
  ('AST-001', '2026-03-04T20:00:00-03:00', 0, 2.9, 0, 0, 0.4, 2.5, 58.0, 3.0, 4)

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
  updated_at            = NOW();
```

### 4.3 Expected Calculation Results (for test assertions)

Using the seed data above with Tarifa Branca default rates:

| Metric | Calculation | Expected Value |
|--------|------------|----------------|
| **Daily charge cost** | (2.5+2.8+2.6+2.1) × R$0.25 | R$2.50 |
| **Peak discharge revenue** | (2.8+3.2+2.9) × R$0.82 | R$7.30 |
| **Daily savings** | R$7.30 - R$2.50 | R$4.80 |
| **PV generation** | 3.2+4.1+4.5+3.8 | 15.6 kWh |
| **Grid export** | 1.5+2.3+2.8+2.0 | 8.6 kWh |
| **Self-consumption** | (15.6-8.6)/15.6 × 100 | 44.9% |
| **Optimization Alpha** | 4.80 / (10 × 0.57 × 1) × 100 | 84.2% |

### 4.4 ems_health Seed

```sql
INSERT INTO ems_health
  (asset_id, client_id, firmware_version, wifi_signal_dbm, uptime_seconds, error_codes, last_heartbeat)
VALUES
  ('AST-001', 'WKRD24070202100141I', 'v2.3.1', -45, 864000, '[]', NOW()),
  ('AST-002', 'WKRD24070202100142I', 'v2.3.1', -52, 432000, '[]', NOW()),
  ('AST-003', 'WKRD24070202100143I', 'v2.3.0', -68, 172800, '["E0x12"]', NOW() - INTERVAL '3 hours')
ON CONFLICT (asset_id) DO UPDATE SET
  firmware_version = EXCLUDED.firmware_version,
  wifi_signal_dbm  = EXCLUDED.wifi_signal_dbm,
  uptime_seconds   = EXCLUDED.uptime_seconds,
  error_codes      = EXCLUDED.error_codes,
  last_heartbeat   = EXCLUDED.last_heartbeat,
  updated_at       = NOW();
```

---

## 5. Index Analysis

Existing indexes are sufficient for v5.13 queries:

| Index | Table | Used By |
|-------|-------|---------|
| `idx_asset_hourly_asset_hour` | asset_hourly_metrics | M4 billing (GROUP BY asset_id, filter by hour_timestamp) |
| `idx_asset_hourly_hour` | asset_hourly_metrics | M5 BFF revenue-trend (filter by hour_timestamp range) |
| `idx_telemetry_asset_time` | telemetry_history | M1 aggregator (range scan per asset per hour) |
| `idx_ems_health_heartbeat` | ems_health (NEW) | Offline detection query |

No new indexes needed beyond `idx_ems_health_heartbeat`.

---

## Document History

| Version | Date | Summary |
|---------|------|---------|
| v5.4 | 2026-02-27 | PostgreSQL 全面取代 — 19 表初始 DDL |
| v5.5 | 2026-02-28 | 雙層經濟模型 — revenue_daily 雙層欄位 |
| v5.7 | 2026-02-28 | pld_horario 批量匯入 |
| v5.8 | 2026-03-02 | asset_hourly_metrics Data Contract |
| v5.10 | 2026-03-05 | RLS Scope Formalization、feature_flags UNIQUE fix |
| v5.11 | 2026-03-05 | DDL Fix — formalize RLS scope for tables missing org_id |
| **v5.13** | **2026-03-05** | **Block 1: CREATE ems_health + telemetry_history_2026_04 partition; Block 2: ALTER asset_hourly_metrics +6 columns (pv_generation_kwh, grid_import/export_kwh, load_consumption_kwh, avg_battery_soc, peak_battery_power_kw); seed_v5.13.sql with Xuheng MSG#4 mock data + pre-aggregated hourly records; total tables 23→24** |
