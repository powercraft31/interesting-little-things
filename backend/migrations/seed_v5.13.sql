-- ============================================================
-- seed_v5.13.sql
-- Realistic Xuheng-parsed telemetry + pre-aggregated hourly data
-- Covers multiple Tarifa Branca periods for testing
-- ============================================================

-- Day 1: 2026-03-04 (good solar day)
-- Pattern: charge 02:00-06:00 (off-peak), PV 10:00-14:00, discharge 18:00-21:00 (peak)

-- === Telemetry History (15-min intervals) ===

-- Off-peak charging hours (02:00-05:00)
INSERT INTO telemetry_history
  (asset_id, recorded_at, battery_soc, battery_power, pv_power, grid_power_kw, load_power, grid_import_kwh, grid_export_kwh)
VALUES
  ('AST-001', '2026-03-04T02:00:00-03:00', 20.0, 2.5, 0, 2.5, 0, 0.63, 0),
  ('AST-001', '2026-03-04T02:15:00-03:00', 23.0, 2.5, 0, 2.5, 0, 0.63, 0),
  ('AST-001', '2026-03-04T02:30:00-03:00', 26.0, 2.5, 0, 2.5, 0, 0.63, 0),
  ('AST-001', '2026-03-04T02:45:00-03:00', 29.0, 2.5, 0, 2.5, 0, 0.63, 0),
  ('AST-001', '2026-03-04T03:00:00-03:00', 32.0, 2.8, 0, 2.8, 0, 0.70, 0),
  ('AST-001', '2026-03-04T03:15:00-03:00', 35.5, 2.8, 0, 2.8, 0, 0.70, 0),
  ('AST-001', '2026-03-04T03:30:00-03:00', 39.0, 2.8, 0, 2.8, 0, 0.70, 0),
  ('AST-001', '2026-03-04T03:45:00-03:00', 42.5, 2.8, 0, 2.8, 0, 0.70, 0),
  ('AST-001', '2026-03-04T04:00:00-03:00', 46.0, 2.6, 0, 2.6, 0, 0.65, 0),
  ('AST-001', '2026-03-04T04:15:00-03:00', 49.0, 2.6, 0, 2.6, 0, 0.65, 0),
  ('AST-001', '2026-03-04T04:30:00-03:00', 52.0, 2.6, 0, 2.6, 0, 0.65, 0),
  ('AST-001', '2026-03-04T04:45:00-03:00', 55.0, 2.6, 0, 2.6, 0, 0.65, 0),
  ('AST-001', '2026-03-04T05:00:00-03:00', 58.0, 2.1, 0, 2.1, 0, 0.53, 0),
  ('AST-001', '2026-03-04T05:15:00-03:00', 60.5, 2.1, 0, 2.1, 0, 0.53, 0),
  ('AST-001', '2026-03-04T05:30:00-03:00', 63.0, 2.1, 0, 2.1, 0, 0.53, 0),
  ('AST-001', '2026-03-04T05:45:00-03:00', 65.5, 2.1, 0, 2.1, 0, 0.53, 0),

-- Solar generation hours (10:00-14:00) with load and grid export
  ('AST-001', '2026-03-04T10:00:00-03:00', 80.0, 0.5, 3.2, -1.5, 1.2, 0, 0.38),
  ('AST-001', '2026-03-04T10:15:00-03:00', 80.5, 0.5, 3.2, -1.5, 1.2, 0, 0.38),
  ('AST-001', '2026-03-04T10:30:00-03:00', 81.0, 0.5, 3.2, -1.5, 1.2, 0, 0.38),
  ('AST-001', '2026-03-04T10:45:00-03:00', 81.5, 0.5, 3.2, -1.5, 1.2, 0, 0.38),
  ('AST-001', '2026-03-04T11:00:00-03:00', 82.0, 0.3, 4.1, -2.3, 1.5, 0, 0.58),
  ('AST-001', '2026-03-04T11:15:00-03:00', 83.0, 0.3, 4.1, -2.3, 1.5, 0, 0.58),
  ('AST-001', '2026-03-04T11:30:00-03:00', 84.0, 0.3, 4.1, -2.3, 1.5, 0, 0.58),
  ('AST-001', '2026-03-04T11:45:00-03:00', 85.0, 0.3, 4.1, -2.3, 1.5, 0, 0.58),
  ('AST-001', '2026-03-04T12:00:00-03:00', 86.0, 0.2, 4.5, -2.8, 1.5, 0, 0.70),
  ('AST-001', '2026-03-04T12:15:00-03:00', 87.0, 0.2, 4.5, -2.8, 1.5, 0, 0.70),
  ('AST-001', '2026-03-04T12:30:00-03:00', 88.0, 0.2, 4.5, -2.8, 1.5, 0, 0.70),
  ('AST-001', '2026-03-04T12:45:00-03:00', 89.0, 0.2, 4.5, -2.8, 1.5, 0, 0.70),
  ('AST-001', '2026-03-04T13:00:00-03:00', 90.0, 0.1, 3.8, -2.0, 1.7, 0, 0.50),
  ('AST-001', '2026-03-04T13:15:00-03:00', 90.5, 0.1, 3.8, -2.0, 1.7, 0, 0.50),
  ('AST-001', '2026-03-04T13:30:00-03:00', 91.0, 0.1, 3.8, -2.0, 1.7, 0, 0.50),
  ('AST-001', '2026-03-04T13:45:00-03:00', 91.5, 0.1, 3.8, -2.0, 1.7, 0, 0.50),

-- Peak discharge hours (18:00-21:00) — Tarifa Branca ponta
  ('AST-001', '2026-03-04T18:00:00-03:00', 88.0, -2.8, 0, 0.5, 2.3, 0.13, 0),
  ('AST-001', '2026-03-04T18:15:00-03:00', 85.0, -2.8, 0, 0.5, 2.3, 0.13, 0),
  ('AST-001', '2026-03-04T18:30:00-03:00', 82.0, -2.8, 0, 0.5, 2.3, 0.13, 0),
  ('AST-001', '2026-03-04T18:45:00-03:00', 79.0, -2.8, 0, 0.5, 2.3, 0.13, 0),
  ('AST-001', '2026-03-04T19:00:00-03:00', 76.0, -3.2, 0, 0.6, 2.6, 0.15, 0),
  ('AST-001', '2026-03-04T19:15:00-03:00', 72.0, -3.2, 0, 0.6, 2.6, 0.15, 0),
  ('AST-001', '2026-03-04T19:30:00-03:00', 68.0, -3.2, 0, 0.6, 2.6, 0.15, 0),
  ('AST-001', '2026-03-04T19:45:00-03:00', 64.0, -3.2, 0, 0.6, 2.6, 0.15, 0),
  ('AST-001', '2026-03-04T20:00:00-03:00', 60.0, -2.9, 0, 0.4, 2.5, 0.10, 0),
  ('AST-001', '2026-03-04T20:15:00-03:00', 57.0, -2.9, 0, 0.4, 2.5, 0.10, 0),
  ('AST-001', '2026-03-04T20:30:00-03:00', 54.0, -2.9, 0, 0.4, 2.5, 0.10, 0),
  ('AST-001', '2026-03-04T20:45:00-03:00', 51.0, -2.9, 0, 0.4, 2.5, 0.10, 0)
ON CONFLICT DO NOTHING;


-- === Pre-Aggregated asset_hourly_metrics ===

INSERT INTO asset_hourly_metrics
  (asset_id, hour_timestamp, total_charge_kwh, total_discharge_kwh,
   pv_generation_kwh, grid_import_kwh, grid_export_kwh,
   load_consumption_kwh, avg_battery_soc, peak_battery_power_kw, data_points_count)
VALUES
  -- Off-peak charging hours
  ('AST-001', '2026-03-04T02:00:00-03:00', 2.5, 0, 0, 2.5, 0, 0, 24.5, 2.5, 4),
  ('AST-001', '2026-03-04T03:00:00-03:00', 2.8, 0, 0, 2.8, 0, 0, 37.3, 2.8, 4),
  ('AST-001', '2026-03-04T04:00:00-03:00', 2.6, 0, 0, 2.6, 0, 0, 50.5, 2.6, 4),
  ('AST-001', '2026-03-04T05:00:00-03:00', 2.1, 0, 0, 2.1, 0, 0, 61.8, 2.1, 4),

  -- Solar generation hours
  ('AST-001', '2026-03-04T10:00:00-03:00', 0.5, 0, 3.2, 0, 1.5, 1.2, 80.8, 0.5, 4),
  ('AST-001', '2026-03-04T11:00:00-03:00', 0.3, 0, 4.1, 0, 2.3, 1.5, 83.5, 0.3, 4),
  ('AST-001', '2026-03-04T12:00:00-03:00', 0.2, 0, 4.5, 0, 2.8, 1.5, 87.5, 0.2, 4),
  ('AST-001', '2026-03-04T13:00:00-03:00', 0.1, 0, 3.8, 0, 2.0, 1.7, 90.8, 0.1, 4),

  -- Peak discharge hours (18:00 ponta, 19:00 ponta, 20:00 ponta)
  ('AST-001', '2026-03-04T18:00:00-03:00', 0, 2.8, 0, 0.5, 0, 2.3, 83.5, 2.8, 4),
  ('AST-001', '2026-03-04T19:00:00-03:00', 0, 3.2, 0, 0.6, 0, 2.6, 70.0, 3.2, 4),
  ('AST-001', '2026-03-04T20:00:00-03:00', 0, 2.9, 0, 0.4, 0, 2.5, 55.5, 2.9, 4)

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


-- === EMS Health Seed ===

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


-- === Revenue Daily Seed (for BFF testing) ===
-- Pre-calculated from the aggregated data above using Tarifa Branca defaults

INSERT INTO revenue_daily
  (asset_id, date,
   vpp_arbitrage_profit_reais, client_savings_reais,
   revenue_reais, cost_reais, profit_reais,
   actual_self_consumption_pct,
   pv_energy_kwh, grid_export_kwh, grid_import_kwh, bat_discharged_kwh,
   calculated_at)
VALUES
  ('AST-001', '2026-03-04',
   0, 4.80,
   4.80, 0, 4.80,
   44.9,
   15.6, 8.6, 9.0, 8.9,
   NOW())
ON CONFLICT (asset_id, date) DO UPDATE SET
  client_savings_reais        = EXCLUDED.client_savings_reais,
  revenue_reais               = EXCLUDED.revenue_reais,
  profit_reais                = EXCLUDED.profit_reais,
  actual_self_consumption_pct = EXCLUDED.actual_self_consumption_pct,
  pv_energy_kwh               = EXCLUDED.pv_energy_kwh,
  grid_export_kwh             = EXCLUDED.grid_export_kwh,
  grid_import_kwh             = EXCLUDED.grid_import_kwh,
  bat_discharged_kwh          = EXCLUDED.bat_discharged_kwh,
  calculated_at               = EXCLUDED.calculated_at;
