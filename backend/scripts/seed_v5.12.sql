-- ============================================================
-- SOLFACIL VPP v5.12 — Seed Data
-- 3 homes, 47 assets (unified model), offline events, uptime data
-- Idempotent: ON CONFLICT DO NOTHING
-- Run as superuser (postgres) after migration_v5.12.sql
-- ============================================================

BEGIN;

-- ============================================================
-- Part A: Homes (3 homes across 2 orgs)
-- ============================================================

INSERT INTO homes (home_id, org_id, name, address) VALUES
  ('HOME-001', 'ORG_ENERGIA_001', 'Casa Silva', 'Rua das Flores 123, São Paulo - SP'),
  ('HOME-002', 'ORG_ENERGIA_001', 'Casa Santos', 'Av. Copacabana 456, Rio de Janeiro - RJ'),
  ('HOME-003', 'ORG_SOLARBR_002', 'Casa Oliveira', 'Rua Pampulha 789, Belo Horizonte - MG')
ON CONFLICT (home_id) DO NOTHING;

-- ============================================================
-- Part B: Update existing 4 assets with v5.12 columns
-- ============================================================

UPDATE assets SET
  asset_type = 'INVERTER_BATTERY',
  home_id = 'HOME-001',
  brand = 'Growatt',
  model = 'MIN 5000TL-XH',
  serial_number = 'GW-SP001-2024',
  commissioned_at = '2024-03-15T10:00:00Z'
WHERE asset_id = 'ASSET_SP_001';

UPDATE assets SET
  asset_type = 'INVERTER_BATTERY',
  home_id = 'HOME-002',
  brand = 'Huawei',
  model = 'SUN2000-5KTL-L1',
  serial_number = 'HW-RJ002-2024',
  commissioned_at = '2024-07-22T14:00:00Z'
WHERE asset_id = 'ASSET_RJ_002';

UPDATE assets SET
  asset_type = 'INVERTER_BATTERY',
  home_id = 'HOME-003',
  brand = 'Sungrow',
  model = 'SH5.0RS',
  serial_number = 'SG-MG003-2024',
  commissioned_at = '2024-09-10T09:00:00Z'
WHERE asset_id = 'ASSET_MG_003';

UPDATE assets SET
  asset_type = 'INVERTER_BATTERY',
  home_id = 'HOME-003',
  brand = 'Deye',
  model = 'SUN-5K-SG03LP1',
  serial_number = 'DY-PR004-2024',
  commissioned_at = '2024-11-05T11:00:00Z'
WHERE asset_id = 'ASSET_PR_004';

-- ============================================================
-- Part C: 43 additional assets (total = 4 existing + 43 new = 47)
-- Distribution: HOME-001: 16 assets, HOME-002: 15 assets, HOME-003: 16 assets
-- Types: Inverter+Battery, Smart Meter, HVAC, EV Charger
-- ============================================================

-- HOME-001 (Casa Silva, ORG_ENERGIA_001) — 12 more (already has SP_001 → total 13)
INSERT INTO assets (asset_id, org_id, name, region, capacidade_kw, capacity_kwh, operation_mode, asset_type, home_id, brand, model, serial_number, commissioned_at) VALUES
  ('DEV-005', 'ORG_ENERGIA_001', 'Casa Silva - Inverter 2',    'SP', 5.0, 10.0, 'self_consumption',       'INVERTER_BATTERY', 'HOME-001', 'Growatt',  'MIN 5000TL-XH',  'GW-005', '2024-04-01T10:00:00Z'),
  ('DEV-006', 'ORG_ENERGIA_001', 'Casa Silva - Inverter 3',    'SP', 3.6, 7.2,  'peak_valley_arbitrage',  'INVERTER_BATTERY', 'HOME-001', 'Huawei',   'SUN2000-4KTL-L1', 'HW-006', '2024-04-15T10:00:00Z'),
  ('DEV-007', 'ORG_ENERGIA_001', 'Casa Silva - Smart Meter 1', 'SP', 0.0, 0.0,  'self_consumption',       'SMART_METER',      'HOME-001', 'Landis+Gyr', 'E450',          'LG-007', '2024-03-20T08:00:00Z'),
  ('DEV-008', 'ORG_ENERGIA_001', 'Casa Silva - Smart Meter 2', 'SP', 0.0, 0.0,  'self_consumption',       'SMART_METER',      'HOME-001', 'Landis+Gyr', 'E450',          'LG-008', '2024-03-20T08:30:00Z'),
  ('DEV-009', 'ORG_ENERGIA_001', 'Casa Silva - AC 1',          'SP', 1.5, 0.0,  'self_consumption',       'HVAC',             'HOME-001', 'Midea',    'Inverter 12000',  'MD-009', '2024-05-01T10:00:00Z'),
  ('DEV-010', 'ORG_ENERGIA_001', 'Casa Silva - AC 2',          'SP', 2.0, 0.0,  'self_consumption',       'HVAC',             'HOME-001', 'Midea',    'Inverter 18000',  'MD-010', '2024-05-01T11:00:00Z'),
  ('DEV-011', 'ORG_ENERGIA_001', 'Casa Silva - AC 3',          'SP', 1.5, 0.0,  'peak_shaving',           'HVAC',             'HOME-001', 'LG',       'Dual Inverter',   'LG-011', '2024-06-01T10:00:00Z'),
  ('DEV-012', 'ORG_ENERGIA_001', 'Casa Silva - EV Charger 1',  'SP', 7.4, 0.0,  'peak_valley_arbitrage',  'EV_CHARGER',       'HOME-001', 'Wallbox',  'Pulsar Plus',     'WB-012', '2024-07-01T10:00:00Z'),
  ('DEV-013', 'ORG_ENERGIA_001', 'Casa Silva - Inverter 4',    'SP', 5.0, 13.0, 'peak_valley_arbitrage',  'INVERTER_BATTERY', 'HOME-001', 'Growatt',  'SPH5000',         'GW-013', '2024-08-01T10:00:00Z'),
  ('DEV-014', 'ORG_ENERGIA_001', 'Casa Silva - Inverter 5',    'SP', 3.0, 6.0,  'self_consumption',       'INVERTER_BATTERY', 'HOME-001', 'Deye',     'SUN-3K-SG03LP1',  'DY-014', '2024-08-15T10:00:00Z'),
  ('DEV-015', 'ORG_ENERGIA_001', 'Casa Silva - Smart Meter 3', 'SP', 0.0, 0.0,  'self_consumption',       'SMART_METER',      'HOME-001', 'Nansen',   'Polaris P3',      'NS-015', '2024-03-25T08:00:00Z'),
  ('DEV-016', 'ORG_ENERGIA_001', 'Casa Silva - AC 4',          'SP', 1.2, 0.0,  'self_consumption',       'HVAC',             'HOME-001', 'Samsung',  'WindFree',        'SS-016', '2024-09-01T10:00:00Z')
ON CONFLICT (asset_id) DO NOTHING;

-- HOME-002 (Casa Santos, ORG_ENERGIA_001) — 14 more (already has RJ_002 → total 15)
INSERT INTO assets (asset_id, org_id, name, region, capacidade_kw, capacity_kwh, operation_mode, asset_type, home_id, brand, model, serial_number, commissioned_at) VALUES
  ('DEV-017', 'ORG_ENERGIA_001', 'Casa Santos - Inverter 2',    'RJ', 5.0, 10.0, 'self_consumption',       'INVERTER_BATTERY', 'HOME-002', 'Huawei',     'SUN2000-5KTL-L1', 'HW-017', '2024-07-25T10:00:00Z'),
  ('DEV-018', 'ORG_ENERGIA_001', 'Casa Santos - Inverter 3',    'RJ', 4.0, 8.0,  'peak_valley_arbitrage',  'INVERTER_BATTERY', 'HOME-002', 'Sungrow',    'SH5.0RS',         'SG-018', '2024-08-01T10:00:00Z'),
  ('DEV-019', 'ORG_ENERGIA_001', 'Casa Santos - Inverter 4',    'RJ', 3.6, 7.2,  'peak_shaving',           'INVERTER_BATTERY', 'HOME-002', 'Growatt',    'SPH3600',         'GW-019', '2024-08-15T10:00:00Z'),
  ('DEV-020', 'ORG_ENERGIA_001', 'Casa Santos - Smart Meter 1', 'RJ', 0.0, 0.0,  'self_consumption',       'SMART_METER',      'HOME-002', 'Landis+Gyr', 'E450',            'LG-020', '2024-07-22T08:00:00Z'),
  ('DEV-021', 'ORG_ENERGIA_001', 'Casa Santos - Smart Meter 2', 'RJ', 0.0, 0.0,  'self_consumption',       'SMART_METER',      'HOME-002', 'Nansen',     'Polaris P3',      'NS-021', '2024-07-22T08:30:00Z'),
  ('DEV-022', 'ORG_ENERGIA_001', 'Casa Santos - AC 1',          'RJ', 2.0, 0.0,  'self_consumption',       'HVAC',             'HOME-002', 'Midea',      'Inverter 18000',  'MD-022', '2024-08-01T10:00:00Z'),
  ('DEV-023', 'ORG_ENERGIA_001', 'Casa Santos - AC 2',          'RJ', 1.5, 0.0,  'peak_shaving',           'HVAC',             'HOME-002', 'LG',         'Dual Inverter',   'LG-023', '2024-08-15T10:00:00Z'),
  ('DEV-024', 'ORG_ENERGIA_001', 'Casa Santos - EV Charger 1',  'RJ', 7.4, 0.0,  'peak_valley_arbitrage',  'EV_CHARGER',       'HOME-002', 'Wallbox',    'Pulsar Plus',     'WB-024', '2024-09-01T10:00:00Z'),
  ('DEV-025', 'ORG_ENERGIA_001', 'Casa Santos - Inverter 5',    'RJ', 5.2, 13.5, 'self_consumption',       'INVERTER_BATTERY', 'HOME-002', 'Deye',       'SUN-5K-SG03LP1',  'DY-025', '2024-09-15T10:00:00Z'),
  ('DEV-026', 'ORG_ENERGIA_001', 'Casa Santos - Inverter 6',    'RJ', 4.8, 10.0, 'peak_valley_arbitrage',  'INVERTER_BATTERY', 'HOME-002', 'Growatt',    'MIN 5000TL-XH',  'GW-026', '2024-10-01T10:00:00Z'),
  ('DEV-027', 'ORG_ENERGIA_001', 'Casa Santos - Smart Meter 3', 'RJ', 0.0, 0.0,  'self_consumption',       'SMART_METER',      'HOME-002', 'Landis+Gyr', 'E450',            'LG-027', '2024-10-01T08:00:00Z'),
  ('DEV-028', 'ORG_ENERGIA_001', 'Casa Santos - AC 3',          'RJ', 1.5, 0.0,  'self_consumption',       'HVAC',             'HOME-002', 'Samsung',    'WindFree',        'SS-028', '2024-10-15T10:00:00Z'),
  ('DEV-029', 'ORG_ENERGIA_001', 'Casa Santos - AC 4',          'RJ', 1.2, 0.0,  'peak_shaving',           'HVAC',             'HOME-002', 'Midea',      'Inverter 9000',   'MD-029', '2024-11-01T10:00:00Z'),
  ('DEV-030', 'ORG_ENERGIA_001', 'Casa Santos - EV Charger 2',  'RJ', 11.0, 0.0, 'peak_valley_arbitrage',  'EV_CHARGER',       'HOME-002', 'ABB',        'Terra AC W22-T-0', 'ABB-030', '2024-11-15T10:00:00Z')
ON CONFLICT (asset_id) DO NOTHING;

-- HOME-003 (Casa Oliveira, ORG_SOLARBR_002) — 14 more (already has MG_003, PR_004 → total 16)
INSERT INTO assets (asset_id, org_id, name, region, capacidade_kw, capacity_kwh, operation_mode, asset_type, home_id, brand, model, serial_number, commissioned_at) VALUES
  ('DEV-031', 'ORG_SOLARBR_002', 'Casa Oliveira - Inverter 3',    'MG', 5.0, 10.0, 'peak_valley_arbitrage', 'INVERTER_BATTERY', 'HOME-003', 'Sungrow',    'SH5.0RS',         'SG-031', '2024-09-15T10:00:00Z'),
  ('DEV-032', 'ORG_SOLARBR_002', 'Casa Oliveira - Inverter 4',    'MG', 3.6, 7.2,  'self_consumption',      'INVERTER_BATTERY', 'HOME-003', 'Growatt',    'SPH3600',         'GW-032', '2024-10-01T10:00:00Z'),
  ('DEV-033', 'ORG_SOLARBR_002', 'Casa Oliveira - Inverter 5',    'MG', 5.0, 13.0, 'peak_shaving',          'INVERTER_BATTERY', 'HOME-003', 'Huawei',     'SUN2000-5KTL-L1', 'HW-033', '2024-10-15T10:00:00Z'),
  ('DEV-034', 'ORG_SOLARBR_002', 'Casa Oliveira - Smart Meter 1', 'MG', 0.0, 0.0,  'self_consumption',      'SMART_METER',      'HOME-003', 'Landis+Gyr', 'E450',            'LG-034', '2024-09-10T08:00:00Z'),
  ('DEV-035', 'ORG_SOLARBR_002', 'Casa Oliveira - Smart Meter 2', 'MG', 0.0, 0.0,  'self_consumption',      'SMART_METER',      'HOME-003', 'Nansen',     'Polaris P3',      'NS-035', '2024-09-10T08:30:00Z'),
  ('DEV-036', 'ORG_SOLARBR_002', 'Casa Oliveira - Smart Meter 3', 'MG', 0.0, 0.0,  'self_consumption',      'SMART_METER',      'HOME-003', 'Landis+Gyr', 'E360',            'LG-036', '2024-09-15T08:00:00Z'),
  ('DEV-037', 'ORG_SOLARBR_002', 'Casa Oliveira - AC 1',          'MG', 2.0, 0.0,  'self_consumption',      'HVAC',             'HOME-003', 'Midea',      'Inverter 18000',  'MD-037', '2024-10-01T10:00:00Z'),
  ('DEV-038', 'ORG_SOLARBR_002', 'Casa Oliveira - AC 2',          'MG', 1.5, 0.0,  'peak_shaving',          'HVAC',             'HOME-003', 'LG',         'Dual Inverter',   'LG-038', '2024-10-15T10:00:00Z'),
  ('DEV-039', 'ORG_SOLARBR_002', 'Casa Oliveira - AC 3',          'MG', 1.2, 0.0,  'self_consumption',      'HVAC',             'HOME-003', 'Samsung',    'WindFree',        'SS-039', '2024-11-01T10:00:00Z'),
  ('DEV-040', 'ORG_SOLARBR_002', 'Casa Oliveira - EV Charger 1',  'MG', 7.4, 0.0,  'peak_valley_arbitrage', 'EV_CHARGER',       'HOME-003', 'Wallbox',    'Pulsar Plus',     'WB-040', '2024-11-15T10:00:00Z'),
  ('DEV-041', 'ORG_SOLARBR_002', 'Casa Oliveira - Inverter 6',    'PR', 4.8, 10.0, 'self_consumption',      'INVERTER_BATTERY', 'HOME-003', 'Deye',       'SUN-5K-SG03LP1',  'DY-041', '2024-12-01T10:00:00Z'),
  ('DEV-042', 'ORG_SOLARBR_002', 'Casa Oliveira - Inverter 7',    'PR', 3.0, 6.0,  'peak_valley_arbitrage', 'INVERTER_BATTERY', 'HOME-003', 'Growatt',    'MIN 3000TL-XH',  'GW-042', '2024-12-15T10:00:00Z'),
  ('DEV-043', 'ORG_SOLARBR_002', 'Casa Oliveira - AC 4',          'MG', 1.5, 0.0,  'peak_shaving',          'HVAC',             'HOME-003', 'Midea',      'Inverter 12000',  'MD-043', '2025-01-01T10:00:00Z'),
  ('DEV-044', 'ORG_SOLARBR_002', 'Casa Oliveira - EV Charger 2',  'MG', 11.0, 0.0, 'peak_valley_arbitrage', 'EV_CHARGER',       'HOME-003', 'ABB',        'Terra AC W22-T-0', 'ABB-044', '2025-01-15T10:00:00Z')
ON CONFLICT (asset_id) DO NOTHING;

-- 3 unassigned assets (no home — testing unassigned device list)
INSERT INTO assets (asset_id, org_id, name, region, capacidade_kw, capacity_kwh, operation_mode, asset_type, brand, model, serial_number) VALUES
  ('DEV-045', 'ORG_ENERGIA_001', 'Unassigned Inverter 1', 'SP', 5.0, 10.0, 'self_consumption', 'INVERTER_BATTERY', 'Growatt', 'MIN 5000TL-XH', 'GW-045'),
  ('DEV-046', 'ORG_SOLARBR_002', 'Unassigned Smart Meter', 'MG', 0.0, 0.0, 'self_consumption', 'SMART_METER', 'Nansen', 'Polaris P3', 'NS-046'),
  ('DEV-047', 'ORG_ENERGIA_001', 'Unassigned EV Charger',  'RJ', 7.4, 0.0, 'peak_valley_arbitrage', 'EV_CHARGER', 'Wallbox', 'Pulsar Plus', 'WB-047')
ON CONFLICT (asset_id) DO NOTHING;

-- ============================================================
-- Part D: Device State for new assets (43 new)
-- ============================================================

INSERT INTO device_state (asset_id, battery_soc, bat_soh, bat_work_status, battery_voltage, bat_cycle_count, pv_power, battery_power, grid_power_kw, load_power, inverter_temp, is_online, grid_frequency, telemetry_json) VALUES
  -- HOME-001 devices
  ('DEV-005', 70.0, 97.0, 'charging',    51.2, 250, 4.2, 1.5,  -0.3, 4.4, 36.5, true,  60.01, '{}'),
  ('DEV-006', 55.0, 96.0, 'discharging', 50.8, 310, 2.8, -1.2, 0.2,  3.8, 37.2, true,  60.00, '{}'),
  ('DEV-007', NULL,  NULL, NULL,          NULL,  NULL, 0.0, 0.0,  0.0,  3.2, NULL,  true,  60.01, '{"consumption": 3.2, "voltage": 220, "current": 14.5, "powerFactor": 0.92}'),
  ('DEV-008', NULL,  NULL, NULL,          NULL,  NULL, 0.0, 0.0,  0.0,  2.8, NULL,  true,  60.00, '{"consumption": 2.8, "voltage": 221, "current": 12.7, "powerFactor": 0.91}'),
  ('DEV-009', NULL,  NULL, NULL,          NULL,  NULL, 0.0, 0.0,  0.0,  1.5, NULL,  true,  60.01, '{"on": true, "setTemp": 23, "roomTemp": 25, "powerDraw": 1.5}'),
  ('DEV-010', NULL,  NULL, NULL,          NULL,  NULL, 0.0, 0.0,  0.0,  2.0, NULL,  true,  60.00, '{"on": true, "setTemp": 22, "roomTemp": 24, "powerDraw": 2.0}'),
  ('DEV-011', NULL,  NULL, NULL,          NULL,  NULL, 0.0, 0.0,  0.0,  1.5, NULL,  true,  60.01, '{"on": false, "setTemp": 24, "roomTemp": 26, "powerDraw": 0}'),
  ('DEV-012', NULL,  NULL, NULL,          NULL,  NULL, 0.0, 0.0,  0.0,  7.2, NULL,  true,  60.00, '{"charging": true, "chargeRate": 7.2, "sessionEnergy": 15.3, "evSoc": 65}'),
  ('DEV-013', 82.0, 98.0, 'charging',    52.0, 180, 5.0, 2.0,  -1.0, 4.0, 35.8, true,  60.01, '{}'),
  ('DEV-014', 45.0, 99.0, 'idle',        49.5, 120, 1.5, 0.0,  0.5,  2.0, 34.2, true,  60.00, '{}'),
  ('DEV-015', NULL,  NULL, NULL,          NULL,  NULL, 0.0, 0.0,  0.0,  4.1, NULL,  true,  60.01, '{"consumption": 4.1, "voltage": 219, "current": 18.7, "powerFactor": 0.93}'),
  ('DEV-016', NULL,  NULL, NULL,          NULL,  NULL, 0.0, 0.0,  0.0,  1.2, NULL,  false, 60.00, '{"on": false, "setTemp": 25, "roomTemp": 28, "powerDraw": 0}'),
  -- HOME-002 devices
  ('DEV-017', 68.0, 96.0, 'discharging', 51.0, 220, 4.0, -1.8, 0.0,  5.8, 37.0, true,  60.01, '{}'),
  ('DEV-018', 78.0, 97.0, 'charging',    51.5, 195, 3.6, 1.2,  -0.2, 3.6, 36.0, true,  60.00, '{}'),
  ('DEV-019', 42.0, 95.0, 'discharging', 50.0, 380, 2.4, -0.8, 0.4,  3.6, 38.5, true,  60.01, '{}'),
  ('DEV-020', NULL,  NULL, NULL,          NULL,  NULL, 0.0, 0.0,  0.0,  3.5, NULL,  true,  60.00, '{"consumption": 3.5, "voltage": 222, "current": 15.8, "powerFactor": 0.94}'),
  ('DEV-021', NULL,  NULL, NULL,          NULL,  NULL, 0.0, 0.0,  0.0,  2.9, NULL,  true,  60.01, '{"consumption": 2.9, "voltage": 220, "current": 13.2, "powerFactor": 0.90}'),
  ('DEV-022', NULL,  NULL, NULL,          NULL,  NULL, 0.0, 0.0,  0.0,  2.0, NULL,  true,  60.00, '{"on": true, "setTemp": 24, "roomTemp": 26, "powerDraw": 2.0}'),
  ('DEV-023', NULL,  NULL, NULL,          NULL,  NULL, 0.0, 0.0,  0.0,  1.5, NULL,  true,  60.01, '{"on": true, "setTemp": 22, "roomTemp": 25, "powerDraw": 1.5}'),
  ('DEV-024', NULL,  NULL, NULL,          NULL,  NULL, 0.0, 0.0,  0.0,  7.0, NULL,  true,  60.00, '{"charging": true, "chargeRate": 7.0, "sessionEnergy": 22.1, "evSoc": 78}'),
  ('DEV-025', 61.0, 98.0, 'idle',        50.5, 160, 5.2, 0.0,  0.3,  5.5, 35.5, true,  60.01, '{}'),
  ('DEV-026', 75.0, 97.0, 'charging',    51.8, 200, 4.8, 2.2,  -1.5, 3.5, 36.8, true,  60.00, '{}'),
  ('DEV-027', NULL,  NULL, NULL,          NULL,  NULL, 0.0, 0.0,  0.0,  3.8, NULL,  true,  60.01, '{"consumption": 3.8, "voltage": 221, "current": 17.2, "powerFactor": 0.93}'),
  ('DEV-028', NULL,  NULL, NULL,          NULL,  NULL, 0.0, 0.0,  0.0,  1.5, NULL,  true,  60.00, '{"on": true, "setTemp": 23, "roomTemp": 25, "powerDraw": 1.5}'),
  ('DEV-029', NULL,  NULL, NULL,          NULL,  NULL, 0.0, 0.0,  0.0,  1.0, NULL,  false, 60.01, '{"on": false, "setTemp": 24, "roomTemp": 29, "powerDraw": 0}'),
  ('DEV-030', NULL,  NULL, NULL,          NULL,  NULL, 0.0, 0.0,  0.0, 11.0, NULL,  true,  60.00, '{"charging": true, "chargeRate": 11.0, "sessionEnergy": 35.8, "evSoc": 42}'),
  -- HOME-003 devices
  ('DEV-031', 63.0, 96.0, 'discharging', 50.8, 280, 3.8, -1.5, 0.0,  5.3, 38.0, true,  60.01, '{}'),
  ('DEV-032', 50.0, 97.0, 'idle',        50.2, 150, 2.0, 0.0,  0.5,  2.5, 35.0, true,  60.00, '{}'),
  ('DEV-033', 88.0, 98.0, 'charging',    52.5, 140, 5.0, 2.5,  -1.5, 4.0, 34.5, true,  60.01, '{}'),
  ('DEV-034', NULL,  NULL, NULL,          NULL,  NULL, 0.0, 0.0,  0.0,  4.2, NULL,  true,  60.00, '{"consumption": 4.2, "voltage": 218, "current": 19.3, "powerFactor": 0.91}'),
  ('DEV-035', NULL,  NULL, NULL,          NULL,  NULL, 0.0, 0.0,  0.0,  3.0, NULL,  true,  60.01, '{"consumption": 3.0, "voltage": 220, "current": 13.6, "powerFactor": 0.92}'),
  ('DEV-036', NULL,  NULL, NULL,          NULL,  NULL, 0.0, 0.0,  0.0,  2.5, NULL,  true,  60.00, '{"consumption": 2.5, "voltage": 221, "current": 11.3, "powerFactor": 0.93}'),
  ('DEV-037', NULL,  NULL, NULL,          NULL,  NULL, 0.0, 0.0,  0.0,  2.0, NULL,  true,  60.01, '{"on": true, "setTemp": 25, "roomTemp": 27, "powerDraw": 2.0}'),
  ('DEV-038', NULL,  NULL, NULL,          NULL,  NULL, 0.0, 0.0,  0.0,  1.5, NULL,  true,  60.00, '{"on": true, "setTemp": 23, "roomTemp": 25, "powerDraw": 1.5}'),
  ('DEV-039', NULL,  NULL, NULL,          NULL,  NULL, 0.0, 0.0,  0.0,  1.2, NULL,  false, 60.01, '{"on": false, "setTemp": 22, "roomTemp": 30, "powerDraw": 0}'),
  ('DEV-040', NULL,  NULL, NULL,          NULL,  NULL, 0.0, 0.0,  0.0,  7.4, NULL,  true,  60.00, '{"charging": false, "chargeRate": 0, "sessionEnergy": 0, "evSoc": 100}'),
  ('DEV-041', 56.0, 98.0, 'discharging', 50.5, 100, 4.8, -2.0, 0.2,  7.0, 36.2, true,  60.01, '{}'),
  ('DEV-042', 40.0, 99.0, 'charging',    49.8, 80,  1.5, 1.0,  0.5,  2.0, 33.8, true,  60.00, '{}'),
  ('DEV-043', NULL,  NULL, NULL,          NULL,  NULL, 0.0, 0.0,  0.0,  1.5, NULL,  true,  60.01, '{"on": true, "setTemp": 24, "roomTemp": 26, "powerDraw": 1.5}'),
  ('DEV-044', NULL,  NULL, NULL,          NULL,  NULL, 0.0, 0.0,  0.0, 11.0, NULL,  true,  60.00, '{"charging": true, "chargeRate": 11.0, "sessionEnergy": 8.5, "evSoc": 25}'),
  -- Unassigned devices
  ('DEV-045', 30.0, 99.0, 'idle',        48.5, 50,  0.0, 0.0,  0.0,  0.0, 25.0, true,  60.00, '{}'),
  ('DEV-046', NULL,  NULL, NULL,          NULL,  NULL, 0.0, 0.0,  0.0,  0.0, NULL,  true,  60.01, '{"consumption": 0, "voltage": 220, "current": 0, "powerFactor": 1.0}'),
  ('DEV-047', NULL,  NULL, NULL,          NULL,  NULL, 0.0, 0.0,  0.0,  0.0, NULL,  true,  60.00, '{"charging": false, "chargeRate": 0, "sessionEnergy": 0, "evSoc": 0}')
ON CONFLICT (asset_id) DO NOTHING;

-- ============================================================
-- Part E: Offline Events (~10 events)
-- ============================================================

INSERT INTO offline_events (asset_id, org_id, started_at, ended_at, cause, backfill) VALUES
  ('DEV-016', 'ORG_ENERGIA_001', NOW() - INTERVAL '2 hours',  NULL,                            'network',         false),
  ('DEV-029', 'ORG_ENERGIA_001', NOW() - INTERVAL '4 hours',  NULL,                            'hardware',        false),
  ('DEV-039', 'ORG_SOLARBR_002', NOW() - INTERVAL '1 hour',   NULL,                            'firmware_update', false),
  ('DEV-007', 'ORG_ENERGIA_001', NOW() - INTERVAL '26 hours', NOW() - INTERVAL '22 hours',     'network',         true),
  ('DEV-034', 'ORG_SOLARBR_002', NOW() - INTERVAL '48 hours', NOW() - INTERVAL '44 hours',     'hardware',        true),
  ('DEV-012', 'ORG_ENERGIA_001', NOW() - INTERVAL '72 hours', NOW() - INTERVAL '68 hours',     'firmware_update', true),
  ('DEV-025', 'ORG_ENERGIA_001', NOW() - INTERVAL '96 hours', NOW() - INTERVAL '94 hours',     'unknown',         false),
  ('DEV-040', 'ORG_SOLARBR_002', NOW() - INTERVAL '120 hours', NOW() - INTERVAL '118 hours',   'network',         true),
  ('DEV-013', 'ORG_ENERGIA_001', NOW() - INTERVAL '150 hours', NOW() - INTERVAL '146 hours 30 minutes', 'hardware', true),
  ('DEV-031', 'ORG_SOLARBR_002', NOW() - INTERVAL '200 hours', NOW() - INTERVAL '196 hours',   'firmware_update', true);

-- ============================================================
-- Part F: Daily Uptime Snapshots (28 days × 2 orgs)
-- ============================================================

INSERT INTO daily_uptime_snapshots (org_id, date, total_assets, online_assets, uptime_pct)
SELECT
  org_id,
  d::DATE AS date,
  CASE org_id WHEN 'ORG_ENERGIA_001' THEN 26 ELSE 21 END AS total_assets,
  CASE org_id
    WHEN 'ORG_ENERGIA_001' THEN 26 - FLOOR(RANDOM() * 3)::INT
    ELSE 21 - FLOOR(RANDOM() * 2)::INT
  END AS online_assets,
  ROUND((90 + RANDOM() * 10)::NUMERIC, 1) AS uptime_pct
FROM
  (VALUES ('ORG_ENERGIA_001'), ('ORG_SOLARBR_002')) AS orgs(org_id),
  generate_series(
    CURRENT_DATE - INTERVAL '27 days',
    CURRENT_DATE,
    '1 day'
  ) AS d
ON CONFLICT (org_id, date) DO NOTHING;

-- ============================================================
-- Part G: Update tariff_schedules with intermediate rate data
-- ============================================================

UPDATE tariff_schedules SET
  intermediate_rate = (peak_rate + offpeak_rate) / 2.0,
  intermediate_start = '16:00',
  intermediate_end = '21:00',
  disco = schedule_name
WHERE intermediate_rate IS NULL;

COMMIT;
