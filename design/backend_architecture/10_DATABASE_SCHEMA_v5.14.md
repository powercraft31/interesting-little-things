# Database Schema — v5.14 Formula Overhaul & Deep Telemetry

> **模組版本**: v5.14
> **上層文件**: [00_MASTER_ARCHITECTURE_v5.14.md](./00_MASTER_ARCHITECTURE_v5.14.md)
> **最後更新**: 2026-03-06
> **說明**: 4 tables altered (telemetry_history, asset_hourly_metrics, revenue_daily, assets); migration_v5.14.sql + seed_v5.14.sql
> **核心主題**: Deep telemetry columns + DP billing output columns + DP parameter columns

---

## Changes from v5.13

| Aspect | v5.13 | v5.14 |
|--------|-------|-------|
| New tables | 1 (ems_health) | 0 |
| Altered tables | 1 (asset_hourly_metrics +6 cols) | 4 (telemetry_history +4, asset_hourly_metrics +3, revenue_daily +4, assets +4) |
| Total tables | 24 | 24 (unchanged) |
| Total new columns | 6 | 15 |
| NULL strategy | Mixed (NOT NULL DEFAULT 0 for energy, NULL for avg/peak) | **All new columns NULL, no DEFAULT** (prevents long table locks) |

---

## 1. Schema Changes — `migration_v5.14.sql`

### Critical DDL Constraint

All new columns MUST be `NULL` with **NO DEFAULT** value. This prevents long table locks on high-volume tables like `telemetry_history`. PostgreSQL can add a nullable column without a DEFAULT in O(1) time (metadata-only change). Adding a DEFAULT requires rewriting the entire table.

### §1.1 Complete `migration_v5.14.sql`

```sql
-- ============================================================
-- migration_v5.14.sql — Formula Overhaul & Deep Telemetry
-- Date: 2026-03-06
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. telemetry_history — Deep BMS telemetry (4 new columns)
-- ────────────────────────────────────────────────────────────
-- These columns capture battery physical state from Xuheng bat.properties.
-- Written by M1 MessageBuffer. Read by M1 telemetry-aggregator for AVG rollup.

ALTER TABLE telemetry_history ADD COLUMN IF NOT EXISTS battery_soh REAL;
ALTER TABLE telemetry_history ADD COLUMN IF NOT EXISTS battery_voltage REAL;
ALTER TABLE telemetry_history ADD COLUMN IF NOT EXISTS battery_current REAL;
ALTER TABLE telemetry_history ADD COLUMN IF NOT EXISTS battery_temperature REAL;

-- Note: No DEFAULT, no NOT NULL. Existing rows remain NULL.
-- New rows from XuhengAdapter will populate these columns.
-- NULL means "BMS did not report this field" (valid semantics).

-- ────────────────────────────────────────────────────────────
-- 2. asset_hourly_metrics — Battery state rollup (3 new columns)
-- ────────────────────────────────────────────────────────────
-- Aggregated by M1 telemetry-aggregator using AVG() over the hour.
-- Physical state metrics: AVG is representative (slowly-changing values).

ALTER TABLE asset_hourly_metrics ADD COLUMN IF NOT EXISTS avg_battery_soh REAL;
ALTER TABLE asset_hourly_metrics ADD COLUMN IF NOT EXISTS avg_battery_voltage REAL;
ALTER TABLE asset_hourly_metrics ADD COLUMN IF NOT EXISTS avg_battery_temperature REAL;

-- ────────────────────────────────────────────────────────────
-- 3. revenue_daily — DP billing output (4 new columns)
-- ────────────────────────────────────────────────────────────
-- Written by M4 daily-billing-job. Read by M5 BFF for KPI display.
-- baseline_cost_reais: electricity cost with no PV + no battery
-- actual_cost_reais: actual grid import cost
-- best_tou_cost_reais: DP-optimal battery schedule cost
-- self_sufficiency_pct: (load - gridImport) / load * 100

ALTER TABLE revenue_daily ADD COLUMN IF NOT EXISTS baseline_cost_reais NUMERIC(10,2);
ALTER TABLE revenue_daily ADD COLUMN IF NOT EXISTS actual_cost_reais NUMERIC(10,2);
ALTER TABLE revenue_daily ADD COLUMN IF NOT EXISTS best_tou_cost_reais NUMERIC(10,2);
ALTER TABLE revenue_daily ADD COLUMN IF NOT EXISTS self_sufficiency_pct REAL;

-- Note: optimization_alpha column (if it exists) is NOT dropped.
-- It will stop being written by the billing job. Old data preserved.
-- Dropping columns in production requires coordination; defer to v6.0.

-- ────────────────────────────────────────────────────────────
-- 4. assets — DP parameters + ROI readiness (4 new columns)
-- ────────────────────────────────────────────────────────────
-- soc_min_pct: minimum SoC constraint for DP (e.g. 10% = battery won't go below 10%)
-- max_charge_rate_kw: maximum charge power (kW) for DP action space
-- max_discharge_rate_kw: maximum discharge power (kW) for DP action space
-- installation_cost_reais: equipment cost for future ROI calculation

ALTER TABLE assets ADD COLUMN IF NOT EXISTS installation_cost_reais NUMERIC(12,2);
ALTER TABLE assets ADD COLUMN IF NOT EXISTS soc_min_pct REAL DEFAULT 10;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS max_charge_rate_kw REAL;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS max_discharge_rate_kw REAL;

-- Note: soc_min_pct has DEFAULT 10 (only exception to NULL-only rule).
-- Rationale: 10% is the safe industry default. All existing batteries
-- should use this constraint immediately without manual configuration.
-- The billing job uses this value; NULL would require special handling.

-- ────────────────────────────────────────────────────────────
-- 5. Indexes — no new indexes needed
-- ────────────────────────────────────────────────────────────
-- Existing indexes cover v5.14 query patterns:
-- - idx_telemetry_asset_time: aggregator range scan (unchanged)
-- - idx_asset_hourly_asset_hour: billing GROUP BY (unchanged)
-- - revenue_daily (asset_id, date) UNIQUE: billing UPSERT (unchanged)
-- New columns are never used in WHERE/JOIN/ORDER BY clauses.
```

---

## 2. Updated Table Schemas (Post-Migration)

### §2.1 telemetry_history — Columns After v5.14

| Column | Type | NULL | Source |
|--------|------|------|--------|
| id | BIGSERIAL | NOT NULL | PK |
| asset_id | VARCHAR(50) | NOT NULL | FK to assets |
| recorded_at | TIMESTAMPTZ | NOT NULL | Parsed from timeStamp |
| battery_soc | NUMERIC(5,2) | | XuhengAdapter |
| battery_power | NUMERIC(8,3) | | XuhengAdapter (kW) |
| pv_power | NUMERIC(8,3) | | XuhengAdapter (kW) |
| grid_power_kw | NUMERIC(8,3) | | XuhengAdapter (kW) |
| load_power | NUMERIC(8,3) | | XuhengAdapter (kW) |
| grid_import_kwh | NUMERIC(10,4) | | XuhengAdapter (daily buy) |
| grid_export_kwh | NUMERIC(10,4) | | XuhengAdapter (daily sell) |
| **battery_soh** | **REAL** | **YES** | **v5.14: XuhengAdapter (BMS SoH %)** |
| **battery_voltage** | **REAL** | **YES** | **v5.14: XuhengAdapter (pack voltage V)** |
| **battery_current** | **REAL** | **YES** | **v5.14: XuhengAdapter (pack current A)** |
| **battery_temperature** | **REAL** | **YES** | **v5.14: XuhengAdapter (pack temp C)** |
| created_at | TIMESTAMPTZ | NOT NULL | DEFAULT NOW() |

### §2.2 asset_hourly_metrics — Columns After v5.14

| Column | Type | NULL | Rollup Function |
|--------|------|------|-----------------|
| id | BIGSERIAL | NOT NULL | PK |
| asset_id | VARCHAR(50) | NOT NULL | FK, GROUP BY |
| hour_timestamp | TIMESTAMPTZ | NOT NULL | Hour start |
| total_charge_kwh | NUMERIC(10,4) | NOT NULL | SUM(battery_power > 0 * interval) |
| total_discharge_kwh | NUMERIC(10,4) | NOT NULL | SUM(battery_power < 0 * interval) |
| pv_generation_kwh | NUMERIC(10,4) | NOT NULL | SUM(pv_power * interval) |
| grid_import_kwh | NUMERIC(10,4) | NOT NULL | SUM(grid > 0 * interval) |
| grid_export_kwh | NUMERIC(10,4) | NOT NULL | SUM(grid < 0 * interval) |
| load_consumption_kwh | NUMERIC(10,4) | NOT NULL | SUM(load_power * interval) |
| avg_battery_soc | NUMERIC(5,2) | YES | AVG(battery_soc) |
| peak_battery_power_kw | NUMERIC(8,3) | YES | MAX(ABS(battery_power)) |
| **avg_battery_soh** | **REAL** | **YES** | **AVG(battery_soh)** |
| **avg_battery_voltage** | **REAL** | **YES** | **AVG(battery_voltage)** |
| **avg_battery_temperature** | **REAL** | **YES** | **AVG(battery_temperature)** |
| data_points_count | INT | NOT NULL | COUNT(*) |
| created_at | TIMESTAMPTZ | NOT NULL | |
| updated_at | TIMESTAMPTZ | NOT NULL | |

### §2.3 revenue_daily — Columns After v5.14

| Column | Type | NULL | Source |
|--------|------|------|--------|
| id | BIGSERIAL | NOT NULL | PK |
| asset_id | VARCHAR(50) | NOT NULL | FK |
| date | DATE | NOT NULL | Billing date |
| vpp_arbitrage_profit_reais | NUMERIC(10,2) | | PLD placeholder |
| client_savings_reais | NUMERIC(10,2) | | v5.14: baseline - actual |
| revenue_reais | NUMERIC(10,2) | | = client_savings |
| cost_reais | NUMERIC(10,2) | | 0 |
| profit_reais | NUMERIC(10,2) | | = client_savings |
| actual_self_consumption_pct | REAL | | (pv - export) / pv |
| pv_energy_kwh | NUMERIC(10,4) | | Sum pv_generation |
| grid_export_kwh | NUMERIC(10,4) | | Sum grid_export |
| grid_import_kwh | NUMERIC(10,4) | | Sum grid_import |
| bat_discharged_kwh | NUMERIC(10,4) | | Sum discharge |
| **baseline_cost_reais** | **NUMERIC(10,2)** | **YES** | **v5.14: Sigma load[h] * rate(h)** |
| **actual_cost_reais** | **NUMERIC(10,2)** | **YES** | **v5.14: Sigma gridImport[h] * rate(h)** |
| **best_tou_cost_reais** | **NUMERIC(10,2)** | **YES** | **v5.14: DP optimal cost** |
| **self_sufficiency_pct** | **REAL** | **YES** | **v5.14: (load - gridImport) / load * 100** |
| tariff_schedule_id | VARCHAR(50) | YES | FK (future) |
| calculated_at | TIMESTAMPTZ | | NOW() |
| created_at | TIMESTAMPTZ | NOT NULL | |
| updated_at | TIMESTAMPTZ | NOT NULL | |

### §2.4 assets — Columns After v5.14 (DP parameters only)

| Column | Type | NULL | Default | Purpose |
|--------|------|------|---------|---------|
| **installation_cost_reais** | **NUMERIC(12,2)** | **YES** | **—** | **Future ROI calculation** |
| **soc_min_pct** | **REAL** | **YES** | **10** | **DP SoC lower bound constraint (%)** |
| **max_charge_rate_kw** | **REAL** | **YES** | **—** | **DP max charge action (kW)** |
| **max_discharge_rate_kw** | **REAL** | **YES** | **—** | **DP max discharge action (kW)** |

**Fallback behavior in billing job:**
- `soc_min_pct`: DEFAULT 10 in DDL, always available
- `max_charge_rate_kw`: if NULL, fallback to `capacity_kwh` (1C rate assumption)
- `max_discharge_rate_kw`: if NULL, fallback to `capacity_kwh` (1C rate assumption)
- `installation_cost_reais`: not used in v5.14 (ROI deferred)

---

## 3. Table Count Update

| Category | v5.13 Count | v5.14 Delta | v5.14 Count |
|----------|------------|-------------|-------------|
| M6 Identity | 3 | — | 3 |
| M1 IoT Hub | 6 | — | 6 |
| M2 Optimization | 2 | — | 2 |
| M3 DR Dispatcher | 2 | — | 2 |
| M4 Market & Billing | 5 | — | 5 |
| M8 Admin Control | 4 | — | 4 |
| Housing (v5.12) | 1 | — | 1 |
| Shared Contract | 1 | — | 1 |
| **Total** | **24** | **0** | **24** |

---

## 4. Seed Data Strategy — `seed_v5.14.sql`

### §4.1 assets — DP Parameters

```sql
-- seed_v5.14.sql — Realistic DP parameters for existing seed assets

UPDATE assets SET
  soc_min_pct = 10,
  max_charge_rate_kw = 5.0,
  max_discharge_rate_kw = 5.0,
  installation_cost_reais = 45000.00
WHERE asset_id = 'AST-001';

UPDATE assets SET
  soc_min_pct = 10,
  max_charge_rate_kw = 5.0,
  max_discharge_rate_kw = 5.0,
  installation_cost_reais = 45000.00
WHERE asset_id = 'AST-002';

UPDATE assets SET
  soc_min_pct = 5,
  max_charge_rate_kw = 3.0,
  max_discharge_rate_kw = 3.0,
  installation_cost_reais = 32000.00
WHERE asset_id = 'AST-003';
```

### §4.2 telemetry_history — Deep Battery Data

```sql
-- Add battery physical state to existing seed telemetry rows
-- These represent typical BMS readings from a healthy LFP battery pack

UPDATE telemetry_history SET
  battery_soh = 98.5,
  battery_voltage = 51.2,
  battery_current = CASE
    WHEN battery_power > 0 THEN battery_power / 0.0512   -- charge: positive current
    WHEN battery_power < 0 THEN battery_power / 0.0512   -- discharge: negative current
    ELSE 0
  END,
  battery_temperature = 25.0 + (RANDOM() * 8)  -- 25-33C typical operating range
WHERE asset_id = 'AST-001'
  AND battery_soh IS NULL;

UPDATE telemetry_history SET
  battery_soh = 97.8,
  battery_voltage = 51.0,
  battery_current = CASE
    WHEN battery_power > 0 THEN battery_power / 0.0510
    WHEN battery_power < 0 THEN battery_power / 0.0510
    ELSE 0
  END,
  battery_temperature = 24.0 + (RANDOM() * 8)
WHERE asset_id = 'AST-002'
  AND battery_soh IS NULL;

UPDATE telemetry_history SET
  battery_soh = 95.2,
  battery_voltage = 50.8,
  battery_current = CASE
    WHEN battery_power > 0 THEN battery_power / 0.0508
    WHEN battery_power < 0 THEN battery_power / 0.0508
    ELSE 0
  END,
  battery_temperature = 26.0 + (RANDOM() * 10)
WHERE asset_id = 'AST-003'
  AND battery_soh IS NULL;
```

### §4.3 asset_hourly_metrics — Battery State Rollup

```sql
-- Add AVG battery state to existing seed hourly metrics

UPDATE asset_hourly_metrics SET
  avg_battery_soh = 98.5,
  avg_battery_voltage = 51.2,
  avg_battery_temperature = 28.0
WHERE asset_id = 'AST-001'
  AND avg_battery_soh IS NULL;

UPDATE asset_hourly_metrics SET
  avg_battery_soh = 97.8,
  avg_battery_voltage = 51.0,
  avg_battery_temperature = 27.5
WHERE asset_id = 'AST-002'
  AND avg_battery_soh IS NULL;

UPDATE asset_hourly_metrics SET
  avg_battery_soh = 95.2,
  avg_battery_voltage = 50.8,
  avg_battery_temperature = 29.0
WHERE asset_id = 'AST-003'
  AND avg_battery_soh IS NULL;
```

### §4.4 revenue_daily — DP Billing Output

```sql
-- Seed revenue_daily with v5.14 billing columns for AST-001 (2026-03-04)
-- Using v5.13 seed data: load~13.3kWh, PV~15.6kWh, grid_import~10kWh

UPDATE revenue_daily SET
  baseline_cost_reais = 5.89,       -- Sigma load[h] * rate(h) across 24h
  actual_cost_reais = 2.50,         -- Sigma gridImport[h] * rate(h)
  best_tou_cost_reais = 1.15,       -- DP optimal
  self_sufficiency_pct = 24.8       -- (13.3 - 10.0) / 13.3 * 100
WHERE asset_id = 'AST-001' AND date = '2026-03-04';

-- Additional seed row for AST-002 (2026-03-04)
UPDATE revenue_daily SET
  baseline_cost_reais = 4.72,
  actual_cost_reais = 1.80,
  best_tou_cost_reais = 0.95,
  self_sufficiency_pct = 61.9
WHERE asset_id = 'AST-002' AND date = '2026-03-04';

-- AST-003 (2026-03-04) — smaller system, less PV
UPDATE revenue_daily SET
  baseline_cost_reais = 3.45,
  actual_cost_reais = 2.10,
  best_tou_cost_reais = 1.50,
  self_sufficiency_pct = 39.1
WHERE asset_id = 'AST-003' AND date = '2026-03-04';
```

### §4.5 Expected Calculation Results (for test assertions)

Using the seed data for AST-001 (2026-03-04):

| Metric | Formula | Expected Value |
|--------|---------|----------------|
| **Baseline cost** | Sigma load[h] * rate(h) | R$5.89 |
| **Actual cost** | Sigma gridImport[h] * rate(h) | R$2.50 |
| **Best TOU cost** | DP result | R$1.15 |
| **Client savings** | baseline - actual | R$3.39 |
| **Actual Savings %** | (5.89 - 2.50) / 5.89 * 100 | 57.6% |
| **Optimization Efficiency %** | (5.89 - 2.50) / (5.89 - 1.15) * 100 | 71.5% |
| **Self-Sufficiency %** | (13.3 - 10.0) / 13.3 * 100 | 24.8% |
| **Self-Consumption %** | (15.6 - 8.6) / 15.6 * 100 | 44.9% |

---

## 5. Index Analysis

Existing indexes are sufficient for v5.14 queries:

| Index | Table | Used By | v5.14 Impact |
|-------|-------|---------|--------------|
| `idx_telemetry_asset_time` | telemetry_history | M1 aggregator | No change — new columns not in WHERE |
| `idx_asset_hourly_asset_hour` | asset_hourly_metrics | M4 billing | No change — same GROUP BY pattern |
| `idx_asset_hourly_hour` | asset_hourly_metrics | M5 BFF revenue-trend | No change |
| `uq_asset_hourly` | asset_hourly_metrics | UPSERT ON CONFLICT | No change |
| `revenue_daily (asset_id, date)` | revenue_daily | UPSERT ON CONFLICT | No change — new columns in SET |
| `idx_ems_health_heartbeat` | ems_health | Offline detection | Unchanged |

**No new indexes needed.** All new columns are written/read in bulk operations (aggregator, billing job) that already have covering indexes. New columns are never used in WHERE, JOIN, or ORDER BY clauses.

---

## 6. Migration Safety Notes

1. **All ALTER TABLE ADD COLUMN statements use `IF NOT EXISTS`** — safe to re-run.
2. **NULL columns without DEFAULT** — O(1) metadata-only change in PostgreSQL. No table rewrite.
3. **Exception: `assets.soc_min_pct DEFAULT 10`** — `assets` table is small (< 1000 rows in pilot). Table rewrite is negligible.
4. **No DROP COLUMN** — `optimization_alpha` (if present in revenue_daily) is preserved but deprecated. No new data written.
5. **Backward compatibility** — existing queries reading old columns are unaffected. New columns are nullable, so old code that doesn't SELECT them continues to work.

---

## Document History

| Version | Date | Summary |
|---------|------|---------|
| v5.4 | 2026-02-27 | PostgreSQL 全面取代 — 19 表初始 DDL |
| v5.5 | 2026-02-28 | 雙層經濟模型 — revenue_daily 雙層欄位 |
| v5.7 | 2026-02-28 | pld_horario 批量匯入 |
| v5.8 | 2026-03-02 | asset_hourly_metrics Data Contract |
| v5.10 | 2026-03-05 | RLS Scope Formalization |
| v5.11 | 2026-03-05 | DDL Fix — RLS scope for tables missing org_id |
| v5.13 | 2026-03-05 | CREATE ems_health + ALTER asset_hourly_metrics +6 columns; total 23 -> 24 tables |
| **v5.14** | **2026-03-06** | **Formula Overhaul & Deep Telemetry: ALTER telemetry_history +4 cols (battery_soh/voltage/current/temperature); ALTER asset_hourly_metrics +3 cols (avg_battery_soh/voltage/temperature); ALTER revenue_daily +4 cols (baseline_cost/actual_cost/best_tou_cost/self_sufficiency_pct); ALTER assets +4 cols (installation_cost/soc_min_pct/max_charge_rate/max_discharge_rate); all NULL no DEFAULT (except soc_min_pct DEFAULT 10); total 24 tables unchanged; seed_v5.14.sql with DP parameters + battery state + billing output** |
