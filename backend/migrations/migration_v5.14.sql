-- ============================================================
-- migration_v5.14.sql — Formula Overhaul & Deep Telemetry
-- Date: 2026-03-06
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. telemetry_history — Deep BMS telemetry (4 new columns)
-- ────────────────────────────────────────────────────────────

ALTER TABLE telemetry_history ADD COLUMN IF NOT EXISTS battery_soh REAL;
ALTER TABLE telemetry_history ADD COLUMN IF NOT EXISTS battery_voltage REAL;
ALTER TABLE telemetry_history ADD COLUMN IF NOT EXISTS battery_current REAL;
ALTER TABLE telemetry_history ADD COLUMN IF NOT EXISTS battery_temperature REAL;

-- ────────────────────────────────────────────────────────────
-- 2. asset_hourly_metrics — Battery state rollup (3 new columns)
-- ────────────────────────────────────────────────────────────

ALTER TABLE asset_hourly_metrics ADD COLUMN IF NOT EXISTS avg_battery_soh REAL;
ALTER TABLE asset_hourly_metrics ADD COLUMN IF NOT EXISTS avg_battery_voltage REAL;
ALTER TABLE asset_hourly_metrics ADD COLUMN IF NOT EXISTS avg_battery_temperature REAL;

-- ────────────────────────────────────────────────────────────
-- 3. revenue_daily — DP billing output (4 new columns)
-- ────────────────────────────────────────────────────────────

ALTER TABLE revenue_daily ADD COLUMN IF NOT EXISTS baseline_cost_reais NUMERIC(10,2);
ALTER TABLE revenue_daily ADD COLUMN IF NOT EXISTS actual_cost_reais NUMERIC(10,2);
ALTER TABLE revenue_daily ADD COLUMN IF NOT EXISTS best_tou_cost_reais NUMERIC(10,2);
ALTER TABLE revenue_daily ADD COLUMN IF NOT EXISTS self_sufficiency_pct REAL;

-- ────────────────────────────────────────────────────────────
-- 4. assets — DP parameters + ROI readiness (4 new columns)
-- ────────────────────────────────────────────────────────────

ALTER TABLE assets ADD COLUMN IF NOT EXISTS installation_cost_reais NUMERIC(12,2);
ALTER TABLE assets ADD COLUMN IF NOT EXISTS soc_min_pct REAL DEFAULT 10;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS max_charge_rate_kw REAL;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS max_discharge_rate_kw REAL;
