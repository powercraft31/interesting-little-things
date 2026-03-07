-- ============================================================
-- seed_v5.16.sql — Test data for Peak Shaving Attribution
-- ============================================================

-- 1. Update tariff to have demand charge rate and power factor
UPDATE tariff_schedules SET
  demand_charge_rate_per_kva = 35.00,
  billing_power_factor = 0.92
WHERE effective_to IS NULL;

-- 2. Update one home with contracted demand
UPDATE homes SET contracted_demand_kw = 50.0
WHERE home_id = (SELECT home_id FROM homes ORDER BY home_id LIMIT 1);

-- 3. Insert sample telemetry rows with DO0 transitions for ASSET_SP_001
INSERT INTO telemetry_history
  (asset_id, recorded_at, battery_soc, pv_power, battery_power, grid_power_kw, load_power, do0_active, do1_active)
VALUES
  ('ASSET_SP_001', ((CURRENT_DATE - 1)::TEXT || ' 21:57:00+00')::TIMESTAMPTZ, 65, 0, -3.5, 8.5, 12.0, false, false),
  ('ASSET_SP_001', ((CURRENT_DATE - 1)::TEXT || ' 22:00:00+00')::TIMESTAMPTZ, 64, 0, -4.0, 5.0, 9.0, true, false),
  ('ASSET_SP_001', ((CURRENT_DATE - 1)::TEXT || ' 22:05:00+00')::TIMESTAMPTZ, 62, 0, -4.0, 4.8, 8.8, true, false),
  ('ASSET_SP_001', ((CURRENT_DATE - 1)::TEXT || ' 22:10:00+00')::TIMESTAMPTZ, 60, 0, -3.5, 5.2, 8.7, true, false);

-- 4. Insert dispatch_records for peak_shaving mode
INSERT INTO dispatch_records
  (asset_id, dispatched_at, dispatch_type, commanded_power_kw, target_mode)
VALUES
  ('ASSET_SP_001', ((CURRENT_DATE - 1)::TEXT || ' 21:00:00+00')::TIMESTAMPTZ, 'peak_shaving', 5.0, 'peak_shaving');

-- 5. Insert asset_5min_metrics rows for PS window
INSERT INTO asset_5min_metrics
  (asset_id, window_start, pv_energy_kwh, bat_charge_kwh, bat_discharge_kwh,
   grid_import_kwh, grid_export_kwh, load_kwh, bat_charge_from_grid_kwh,
   avg_battery_soc, data_points)
VALUES
  ('ASSET_SP_001', ((CURRENT_DATE - 1)::TEXT || ' 22:00:00+00')::TIMESTAMPTZ, 0, 0, 0.3333, 0.7083, 0, 1.0000, 0, 64, 60),
  ('ASSET_SP_001', ((CURRENT_DATE - 1)::TEXT || ' 22:05:00+00')::TIMESTAMPTZ, 0, 0, 0.3333, 0.6667, 0, 1.0000, 0, 62, 60),
  ('ASSET_SP_001', ((CURRENT_DATE - 1)::TEXT || ' 22:10:00+00')::TIMESTAMPTZ, 0, 0, 0.2917, 0.7250, 0, 1.0000, 0, 60, 60);
