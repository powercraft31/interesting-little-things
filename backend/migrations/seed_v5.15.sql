-- ============================================================
-- seed_v5.15.sql — Test data for SC/TOU Attribution
-- ============================================================

-- 1. Update dispatch_records: set target_mode for existing rows
UPDATE dispatch_records
SET target_mode = 'peak_valley_arbitrage'
WHERE asset_id = 'SP-BAT-001'
  AND target_mode = 'self_consumption'
  AND dispatched_at >= CURRENT_DATE - INTERVAL '2 days'
ORDER BY dispatched_at DESC
LIMIT 2;

-- 2. Update 1 asset to have allow_export = true
UPDATE assets SET allow_export = true WHERE asset_id = 'SP-BAT-001';

-- 3. Insert 10 asset_5min_metrics rows for SP-BAT-001 (2 windows x 5 rows each pattern)
INSERT INTO asset_5min_metrics
  (asset_id, window_start, pv_energy_kwh, bat_charge_kwh, bat_discharge_kwh,
   grid_import_kwh, grid_export_kwh, load_kwh, bat_charge_from_grid_kwh,
   avg_battery_soc, data_points)
VALUES
  -- Window 1: yesterday 10:00 BRT (13:00 UTC) — SC mode expected
  ('SP-BAT-001', (CURRENT_DATE - 1)::TEXT || ' 13:00:00+00', 0.8333, 0.0000, 0.0000, 0.0000, 0.0833, 0.6667, 0.0000, 75.0, 60),
  ('SP-BAT-001', (CURRENT_DATE - 1)::TEXT || ' 13:05:00+00', 0.7500, 0.0000, 0.0000, 0.0000, 0.0000, 0.7083, 0.0000, 74.5, 60),
  ('SP-BAT-001', (CURRENT_DATE - 1)::TEXT || ' 13:10:00+00', 0.9167, 0.0000, 0.0000, 0.0000, 0.1250, 0.7500, 0.0000, 74.0, 60),
  ('SP-BAT-001', (CURRENT_DATE - 1)::TEXT || ' 13:15:00+00', 0.8750, 0.0833, 0.0000, 0.0000, 0.0417, 0.7917, 0.0000, 74.2, 60),
  ('SP-BAT-001', (CURRENT_DATE - 1)::TEXT || ' 13:20:00+00', 0.7917, 0.0000, 0.0000, 0.0417, 0.0000, 0.8333, 0.0000, 73.8, 60),
  -- Window 2: yesterday 19:00 BRT (22:00 UTC) — TOU peak mode expected
  ('SP-BAT-001', (CURRENT_DATE - 1)::TEXT || ' 22:00:00+00', 0.0000, 0.0000, 0.4167, 0.4167, 0.0000, 0.8333, 0.0000, 60.0, 60),
  ('SP-BAT-001', (CURRENT_DATE - 1)::TEXT || ' 22:05:00+00', 0.0000, 0.0000, 0.5000, 0.3333, 0.0000, 0.8333, 0.0000, 58.0, 60),
  ('SP-BAT-001', (CURRENT_DATE - 1)::TEXT || ' 22:10:00+00', 0.0000, 0.0000, 0.4583, 0.3750, 0.0000, 0.8333, 0.0000, 56.5, 60),
  ('SP-BAT-001', (CURRENT_DATE - 1)::TEXT || ' 22:15:00+00', 0.0000, 0.0000, 0.3750, 0.4583, 0.0000, 0.8333, 0.0000, 55.0, 60),
  ('SP-BAT-001', (CURRENT_DATE - 1)::TEXT || ' 22:20:00+00', 0.0000, 0.0000, 0.4167, 0.4167, 0.0000, 0.8333, 0.0000, 53.5, 60);
