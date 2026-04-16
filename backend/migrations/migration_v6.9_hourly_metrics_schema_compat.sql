-- ============================================================
-- migration_v6.9_hourly_metrics_schema_compat.sql
-- Ensure asset_hourly_metrics matches TelemetryAggregator contract
-- ============================================================

ALTER TABLE asset_hourly_metrics
  ADD COLUMN IF NOT EXISTS pv_generation_kwh     NUMERIC(10,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS grid_import_kwh       NUMERIC(10,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS grid_export_kwh       NUMERIC(10,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS load_consumption_kwh  NUMERIC(10,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_battery_soc       NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS peak_battery_power_kw NUMERIC(8,3);
