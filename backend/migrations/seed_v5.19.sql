-- ============================================================
-- seed_v5.19.sql — Comprehensive seed for v5.19 schema
-- Date: 2026-03-10
-- Depends on: ddl_base.sql (v5.19)
-- Replaces: seed_v5.18.sql + scripts/seed_v5.12.sql (for clean DB)
-- Idempotent: ON CONFLICT DO NOTHING / DO UPDATE
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Organizations
-- ============================================================

INSERT INTO organizations (org_id, name, plan_tier)
VALUES
  ('ORG_ENERGIA_001', 'Solfacil Pilot Corp',    'ENTERPRISE'),
  ('ORG_SOLARBR_002', 'Solar BR Distribuidora', 'PROFESSIONAL')
ON CONFLICT (org_id) DO NOTHING;

-- ============================================================
-- 2. Users & Roles
-- ============================================================

INSERT INTO users (user_id, email, name, hashed_password, is_active)
VALUES
  ('USER_ADMIN_001', 'admin@solfacil.com.br', 'Solfacil Admin',
   '$2b$12$placeholder_hash_admin_001_solfacil2026demo_xxxxxx', true)
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO user_org_roles (user_id, org_id, role)
VALUES
  ('USER_ADMIN_001', 'ORG_ENERGIA_001', 'SOLFACIL_ADMIN')
ON CONFLICT (user_id, org_id) DO NOTHING;

-- ============================================================
-- 3. Gateways (SN as PK, no client_id, no home_id)
-- ============================================================

INSERT INTO gateways (gateway_id, org_id, name, address, contracted_demand_kw,
                      mqtt_broker_host, mqtt_broker_port,
                      mqtt_username, mqtt_password,
                      device_name, product_key, status)
VALUES
  ('WKRD24070202100144F', 'ORG_ENERGIA_001', 'Casa Silva · Home-1',
   'Rua das Flores 123, São Paulo - SP', 15.0,
   '18.141.63.142', 1883, 'xuheng', 'xuheng8888!',
   'EMS_N2', 'ems', 'online'),

  ('WKRD24070202100228G', 'ORG_ENERGIA_001', 'Casa Santos · Home-2',
   'Av. Copacabana 456, Rio de Janeiro - RJ', 12.0,
   '18.141.63.142', 1883, 'xuheng', 'xuheng8888!',
   'EMS_N2', 'ems', 'online'),

  ('WKRD24070202100212P', 'ORG_ENERGIA_001', 'Casa Oliveira · Home-3',
   'Rua Pampulha 789, Belo Horizonte - MG', 10.0,
   '18.141.63.142', 1883, 'xuheng', 'xuheng8888!',
   'EMS_N2', 'ems', 'offline'),

  ('WKRD24070202100141I', 'ORG_ENERGIA_001', 'Test Gateway',
   NULL, NULL,
   '18.141.63.142', 1883, 'xuheng', 'xuheng8888!',
   'EMS_N2', 'ems', 'online')
ON CONFLICT (gateway_id) DO NOTHING;

-- ============================================================
-- 4. Assets (gateway_id = SN, no home_id)
-- ============================================================

-- 4a: Original 4 assets
INSERT INTO assets (asset_id, org_id, name, region, capacidade_kw, capacity_kwh,
                    operation_mode, asset_type, brand, model, serial_number,
                    commissioned_at, is_active, gateway_id)
VALUES
  ('ASSET_SP_001', 'ORG_ENERGIA_001', 'São Paulo - Casa Verde',
   'SP', 5.2, 13.5, 'peak_valley_arbitrage', 'INVERTER_BATTERY',
   'Growatt', 'MIN 5000TL-XH', 'GW-SP001-2024',
   '2024-03-15T10:00:00Z', true, 'WKRD24070202100144F'),

  ('ASSET_RJ_002', 'ORG_ENERGIA_001', 'Rio de Janeiro - Copacabana',
   'RJ', 4.8, 10.0, 'self_consumption', 'INVERTER_BATTERY',
   'Huawei', 'SUN2000-5KTL-L1', 'HW-RJ002-2024',
   '2024-07-22T14:00:00Z', true, 'WKRD24070202100228G'),

  ('ASSET_MG_003', 'ORG_SOLARBR_002', 'Belo Horizonte - Pampulha',
   'MG', 3.6, 11.5, 'peak_valley_arbitrage', 'INVERTER_BATTERY',
   'Sungrow', 'SH5.0RS', 'SG-MG003-2024',
   '2024-09-10T09:00:00Z', true, 'WKRD24070202100212P'),

  ('ASSET_PR_004', 'ORG_SOLARBR_002', 'Curitiba - Batel',
   'PR', 2.0, 14.0, 'peak_shaving', 'INVERTER_BATTERY',
   'Deye', 'SUN-5K-SG03LP1', 'DY-PR004-2024',
   '2024-11-05T11:00:00Z', true, 'WKRD24070202100212P')
ON CONFLICT (asset_id) DO NOTHING;

-- 4b: Gateway 1 (Casa Silva) — 12 more devices (total 13)
INSERT INTO assets (asset_id, org_id, name, region, capacidade_kw, capacity_kwh,
                    operation_mode, asset_type, brand, model, serial_number,
                    commissioned_at, gateway_id)
VALUES
  ('DEV-005', 'ORG_ENERGIA_001', 'Casa Silva - Inverter 2',    'SP', 5.0, 10.0, 'self_consumption',       'INVERTER_BATTERY', 'Growatt',    'MIN 5000TL-XH',  'GW-005', '2024-04-01T10:00:00Z', 'WKRD24070202100144F'),
  ('DEV-006', 'ORG_ENERGIA_001', 'Casa Silva - Inverter 3',    'SP', 3.6, 7.2,  'peak_valley_arbitrage',  'INVERTER_BATTERY', 'Huawei',     'SUN2000-4KTL-L1', 'HW-006', '2024-04-15T10:00:00Z', 'WKRD24070202100144F'),
  ('DEV-007', 'ORG_ENERGIA_001', 'Casa Silva - Smart Meter 1', 'SP', 0.0, 0.0,  'self_consumption',       'SMART_METER',      'Landis+Gyr', 'E450',            'LG-007', '2024-03-20T08:00:00Z', 'WKRD24070202100144F'),
  ('DEV-008', 'ORG_ENERGIA_001', 'Casa Silva - Smart Meter 2', 'SP', 0.0, 0.0,  'self_consumption',       'SMART_METER',      'Landis+Gyr', 'E450',            'LG-008', '2024-03-20T08:30:00Z', 'WKRD24070202100144F'),
  ('DEV-009', 'ORG_ENERGIA_001', 'Casa Silva - AC 1',          'SP', 1.5, 0.0,  'self_consumption',       'HVAC',             'Midea',      'Inverter 12000',  'MD-009', '2024-05-01T10:00:00Z', 'WKRD24070202100144F'),
  ('DEV-010', 'ORG_ENERGIA_001', 'Casa Silva - AC 2',          'SP', 2.0, 0.0,  'self_consumption',       'HVAC',             'Midea',      'Inverter 18000',  'MD-010', '2024-05-01T11:00:00Z', 'WKRD24070202100144F'),
  ('DEV-011', 'ORG_ENERGIA_001', 'Casa Silva - AC 3',          'SP', 1.5, 0.0,  'peak_shaving',           'HVAC',             'LG',         'Dual Inverter',   'LG-011', '2024-06-01T10:00:00Z', 'WKRD24070202100144F'),
  ('DEV-012', 'ORG_ENERGIA_001', 'Casa Silva - EV Charger 1',  'SP', 7.4, 0.0,  'peak_valley_arbitrage',  'EV_CHARGER',       'Wallbox',    'Pulsar Plus',     'WB-012', '2024-07-01T10:00:00Z', 'WKRD24070202100144F'),
  ('DEV-013', 'ORG_ENERGIA_001', 'Casa Silva - Inverter 4',    'SP', 5.0, 13.0, 'peak_valley_arbitrage',  'INVERTER_BATTERY', 'Growatt',    'SPH5000',         'GW-013', '2024-08-01T10:00:00Z', 'WKRD24070202100144F'),
  ('DEV-014', 'ORG_ENERGIA_001', 'Casa Silva - Inverter 5',    'SP', 3.0, 6.0,  'self_consumption',       'INVERTER_BATTERY', 'Deye',       'SUN-3K-SG03LP1',  'DY-014', '2024-08-15T10:00:00Z', 'WKRD24070202100144F'),
  ('DEV-015', 'ORG_ENERGIA_001', 'Casa Silva - Smart Meter 3', 'SP', 0.0, 0.0,  'self_consumption',       'SMART_METER',      'Nansen',     'Polaris P3',      'NS-015', '2024-03-25T08:00:00Z', 'WKRD24070202100144F'),
  ('DEV-016', 'ORG_ENERGIA_001', 'Casa Silva - AC 4',          'SP', 1.2, 0.0,  'self_consumption',       'HVAC',             'Samsung',    'WindFree',        'SS-016', '2024-09-01T10:00:00Z', 'WKRD24070202100144F')
ON CONFLICT (asset_id) DO NOTHING;

-- 4c: Gateway 2 (Casa Santos) — 14 more devices (total 15)
INSERT INTO assets (asset_id, org_id, name, region, capacidade_kw, capacity_kwh,
                    operation_mode, asset_type, brand, model, serial_number,
                    commissioned_at, gateway_id)
VALUES
  ('DEV-017', 'ORG_ENERGIA_001', 'Casa Santos - Inverter 2',    'RJ', 5.0, 10.0, 'self_consumption',       'INVERTER_BATTERY', 'Huawei',     'SUN2000-5KTL-L1', 'HW-017', '2024-07-25T10:00:00Z', 'WKRD24070202100228G'),
  ('DEV-018', 'ORG_ENERGIA_001', 'Casa Santos - Inverter 3',    'RJ', 4.0, 8.0,  'peak_valley_arbitrage',  'INVERTER_BATTERY', 'Sungrow',    'SH5.0RS',         'SG-018', '2024-08-01T10:00:00Z', 'WKRD24070202100228G'),
  ('DEV-019', 'ORG_ENERGIA_001', 'Casa Santos - Inverter 4',    'RJ', 3.6, 7.2,  'peak_shaving',           'INVERTER_BATTERY', 'Growatt',    'SPH3600',         'GW-019', '2024-08-15T10:00:00Z', 'WKRD24070202100228G'),
  ('DEV-020', 'ORG_ENERGIA_001', 'Casa Santos - Smart Meter 1', 'RJ', 0.0, 0.0,  'self_consumption',       'SMART_METER',      'Landis+Gyr', 'E450',            'LG-020', '2024-07-22T08:00:00Z', 'WKRD24070202100228G'),
  ('DEV-021', 'ORG_ENERGIA_001', 'Casa Santos - Smart Meter 2', 'RJ', 0.0, 0.0,  'self_consumption',       'SMART_METER',      'Nansen',     'Polaris P3',      'NS-021', '2024-07-22T08:30:00Z', 'WKRD24070202100228G'),
  ('DEV-022', 'ORG_ENERGIA_001', 'Casa Santos - AC 1',          'RJ', 2.0, 0.0,  'self_consumption',       'HVAC',             'Midea',      'Inverter 18000',  'MD-022', '2024-08-01T10:00:00Z', 'WKRD24070202100228G'),
  ('DEV-023', 'ORG_ENERGIA_001', 'Casa Santos - AC 2',          'RJ', 1.5, 0.0,  'peak_shaving',           'HVAC',             'LG',         'Dual Inverter',   'LG-023', '2024-08-15T10:00:00Z', 'WKRD24070202100228G'),
  ('DEV-024', 'ORG_ENERGIA_001', 'Casa Santos - EV Charger 1',  'RJ', 7.4, 0.0,  'peak_valley_arbitrage',  'EV_CHARGER',       'Wallbox',    'Pulsar Plus',     'WB-024', '2024-09-01T10:00:00Z', 'WKRD24070202100228G'),
  ('DEV-025', 'ORG_ENERGIA_001', 'Casa Santos - Inverter 5',    'RJ', 5.2, 13.5, 'self_consumption',       'INVERTER_BATTERY', 'Deye',       'SUN-5K-SG03LP1',  'DY-025', '2024-09-15T10:00:00Z', 'WKRD24070202100228G'),
  ('DEV-026', 'ORG_ENERGIA_001', 'Casa Santos - Inverter 6',    'RJ', 4.8, 10.0, 'peak_valley_arbitrage',  'INVERTER_BATTERY', 'Growatt',    'MIN 5000TL-XH',  'GW-026', '2024-10-01T10:00:00Z', 'WKRD24070202100228G'),
  ('DEV-027', 'ORG_ENERGIA_001', 'Casa Santos - Smart Meter 3', 'RJ', 0.0, 0.0,  'self_consumption',       'SMART_METER',      'Landis+Gyr', 'E450',            'LG-027', '2024-10-01T08:00:00Z', 'WKRD24070202100228G'),
  ('DEV-028', 'ORG_ENERGIA_001', 'Casa Santos - AC 3',          'RJ', 1.5, 0.0,  'self_consumption',       'HVAC',             'Samsung',    'WindFree',        'SS-028', '2024-10-15T10:00:00Z', 'WKRD24070202100228G'),
  ('DEV-029', 'ORG_ENERGIA_001', 'Casa Santos - AC 4',          'RJ', 1.2, 0.0,  'peak_shaving',           'HVAC',             'Midea',      'Inverter 9000',   'MD-029', '2024-11-01T10:00:00Z', 'WKRD24070202100228G'),
  ('DEV-030', 'ORG_ENERGIA_001', 'Casa Santos - EV Charger 2',  'RJ', 11.0, 0.0, 'peak_valley_arbitrage',  'EV_CHARGER',       'ABB',        'Terra AC W22-T-0', 'ABB-030', '2024-11-15T10:00:00Z', 'WKRD24070202100228G')
ON CONFLICT (asset_id) DO NOTHING;

-- 4d: Gateway 3 (Casa Oliveira) — 14 more devices (total 16)
INSERT INTO assets (asset_id, org_id, name, region, capacidade_kw, capacity_kwh,
                    operation_mode, asset_type, brand, model, serial_number,
                    commissioned_at, gateway_id)
VALUES
  ('DEV-031', 'ORG_SOLARBR_002', 'Casa Oliveira - Inverter 3',    'MG', 5.0, 10.0, 'peak_valley_arbitrage', 'INVERTER_BATTERY', 'Sungrow',    'SH5.0RS',         'SG-031', '2024-09-15T10:00:00Z', 'WKRD24070202100212P'),
  ('DEV-032', 'ORG_SOLARBR_002', 'Casa Oliveira - Inverter 4',    'MG', 3.6, 7.2,  'self_consumption',      'INVERTER_BATTERY', 'Growatt',    'SPH3600',         'GW-032', '2024-10-01T10:00:00Z', 'WKRD24070202100212P'),
  ('DEV-033', 'ORG_SOLARBR_002', 'Casa Oliveira - Inverter 5',    'MG', 5.0, 13.0, 'peak_shaving',          'INVERTER_BATTERY', 'Huawei',     'SUN2000-5KTL-L1', 'HW-033', '2024-10-15T10:00:00Z', 'WKRD24070202100212P'),
  ('DEV-034', 'ORG_SOLARBR_002', 'Casa Oliveira - Smart Meter 1', 'MG', 0.0, 0.0,  'self_consumption',      'SMART_METER',      'Landis+Gyr', 'E450',            'LG-034', '2024-09-10T08:00:00Z', 'WKRD24070202100212P'),
  ('DEV-035', 'ORG_SOLARBR_002', 'Casa Oliveira - Smart Meter 2', 'MG', 0.0, 0.0,  'self_consumption',      'SMART_METER',      'Nansen',     'Polaris P3',      'NS-035', '2024-09-10T08:30:00Z', 'WKRD24070202100212P'),
  ('DEV-036', 'ORG_SOLARBR_002', 'Casa Oliveira - Smart Meter 3', 'MG', 0.0, 0.0,  'self_consumption',      'SMART_METER',      'Landis+Gyr', 'E360',            'LG-036', '2024-09-15T08:00:00Z', 'WKRD24070202100212P'),
  ('DEV-037', 'ORG_SOLARBR_002', 'Casa Oliveira - AC 1',          'MG', 2.0, 0.0,  'self_consumption',      'HVAC',             'Midea',      'Inverter 18000',  'MD-037', '2024-10-01T10:00:00Z', 'WKRD24070202100212P'),
  ('DEV-038', 'ORG_SOLARBR_002', 'Casa Oliveira - AC 2',          'MG', 1.5, 0.0,  'peak_shaving',          'HVAC',             'LG',         'Dual Inverter',   'LG-038', '2024-10-15T10:00:00Z', 'WKRD24070202100212P'),
  ('DEV-039', 'ORG_SOLARBR_002', 'Casa Oliveira - AC 3',          'MG', 1.2, 0.0,  'self_consumption',      'HVAC',             'Samsung',    'WindFree',        'SS-039', '2024-11-01T10:00:00Z', 'WKRD24070202100212P'),
  ('DEV-040', 'ORG_SOLARBR_002', 'Casa Oliveira - EV Charger 1',  'MG', 7.4, 0.0,  'peak_valley_arbitrage', 'EV_CHARGER',       'Wallbox',    'Pulsar Plus',     'WB-040', '2024-11-15T10:00:00Z', 'WKRD24070202100212P'),
  ('DEV-041', 'ORG_SOLARBR_002', 'Casa Oliveira - Inverter 6',    'PR', 4.8, 10.0, 'self_consumption',      'INVERTER_BATTERY', 'Deye',       'SUN-5K-SG03LP1',  'DY-041', '2024-12-01T10:00:00Z', 'WKRD24070202100212P'),
  ('DEV-042', 'ORG_SOLARBR_002', 'Casa Oliveira - Inverter 7',    'PR', 3.0, 6.0,  'peak_valley_arbitrage', 'INVERTER_BATTERY', 'Growatt',    'MIN 3000TL-XH',  'GW-042', '2024-12-15T10:00:00Z', 'WKRD24070202100212P'),
  ('DEV-043', 'ORG_SOLARBR_002', 'Casa Oliveira - AC 4',          'MG', 1.5, 0.0,  'peak_shaving',          'HVAC',             'Midea',      'Inverter 12000',  'MD-043', '2025-01-01T10:00:00Z', 'WKRD24070202100212P'),
  ('DEV-044', 'ORG_SOLARBR_002', 'Casa Oliveira - EV Charger 2',  'MG', 11.0, 0.0, 'peak_valley_arbitrage', 'EV_CHARGER',       'ABB',        'Terra AC W22-T-0', 'ABB-044', '2025-01-15T10:00:00Z', 'WKRD24070202100212P')
ON CONFLICT (asset_id) DO NOTHING;

-- 4e: Unassigned assets (no gateway)
INSERT INTO assets (asset_id, org_id, name, region, capacidade_kw, capacity_kwh,
                    operation_mode, asset_type, brand, model, serial_number)
VALUES
  ('DEV-045', 'ORG_ENERGIA_001', 'Unassigned Inverter 1', 'SP', 5.0, 10.0, 'self_consumption',      'INVERTER_BATTERY', 'Growatt', 'MIN 5000TL-XH', 'GW-045'),
  ('DEV-046', 'ORG_SOLARBR_002', 'Unassigned Smart Meter', 'MG', 0.0, 0.0, 'self_consumption',      'SMART_METER',      'Nansen',  'Polaris P3',    'NS-046'),
  ('DEV-047', 'ORG_ENERGIA_001', 'Unassigned EV Charger',  'RJ', 7.4, 0.0, 'peak_valley_arbitrage', 'EV_CHARGER',       'Wallbox', 'Pulsar Plus',   'WB-047')
ON CONFLICT (asset_id) DO NOTHING;

-- ============================================================
-- 5. Device State (all 51 assets)
-- ============================================================

INSERT INTO device_state (asset_id, battery_soc, bat_soh, bat_work_status, battery_voltage,
                          bat_cycle_count, pv_power, battery_power, grid_power_kw, load_power,
                          inverter_temp, is_online, grid_frequency, telemetry_json)
VALUES
  -- Original 4
  ('ASSET_SP_001', 65.0, 98.0, 'discharging', 51.6, 312, 3.2, -1.8, 0.0, 5.0, 38.2, true,  60.02, '{}'),
  ('ASSET_RJ_002', 72.0, 97.0, 'charging',    52.1, 198, 4.5, 2.0,  -1.0, 5.5, 35.8, true,  60.01, '{}'),
  ('ASSET_MG_003', 58.0, 95.0, 'discharging', 50.4, 415, 2.8, -1.5, 0.5,  4.8, 37.5, true,  60.00, '{}'),
  ('ASSET_PR_004', 45.0, 96.0, 'idle',        49.8, 280, 1.0, 0.0,  0.8,  1.8, 34.0, false, 60.01, '{}'),
  -- Gateway 1 devices
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
  -- Gateway 2 devices
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
  -- Gateway 3 devices
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
  -- Unassigned
  ('DEV-045', 30.0, 99.0, 'idle',        48.5, 50,  0.0, 0.0,  0.0,  0.0, 25.0, true,  60.00, '{}'),
  ('DEV-046', NULL,  NULL, NULL,          NULL,  NULL, 0.0, 0.0,  0.0,  0.0, NULL,  true,  60.01, '{"consumption": 0, "voltage": 220, "current": 0, "powerFactor": 1.0}'),
  ('DEV-047', NULL,  NULL, NULL,          NULL,  NULL, 0.0, 0.0,  0.0,  0.0, NULL,  true,  60.00, '{"charging": false, "chargeRate": 0, "sessionEnergy": 0, "evSoc": 0}')
ON CONFLICT (asset_id) DO NOTHING;

-- ============================================================
-- 6. Tariff Schedules (CEMIG Tarifa Branca)
-- ============================================================

-- Idempotent: only insert if no tariff exists for this org + effective_from
INSERT INTO tariff_schedules (org_id, schedule_name, peak_start, peak_end,
                              peak_rate, offpeak_rate, feed_in_rate,
                              intermediate_rate, intermediate_start, intermediate_end,
                              demand_charge_rate_per_kva, billing_power_factor,
                              disco, effective_from)
SELECT 'ORG_ENERGIA_001', 'CEMIG Tarifa Branca',
       '17:00'::TIME, '20:00'::TIME,
       0.89, 0.41, 0.25,
       0.62, '16:00'::TIME, '21:00'::TIME,
       5.50, 0.92,
       'CEMIG', '2026-01-01'::DATE
WHERE NOT EXISTS (
  SELECT 1 FROM tariff_schedules
  WHERE org_id = 'ORG_ENERGIA_001' AND effective_from = '2026-01-01'
);

INSERT INTO tariff_schedules (org_id, schedule_name, peak_start, peak_end,
                              peak_rate, offpeak_rate, feed_in_rate,
                              intermediate_rate, intermediate_start, intermediate_end,
                              demand_charge_rate_per_kva, billing_power_factor,
                              disco, effective_from)
SELECT 'ORG_SOLARBR_002', 'CEMIG Tarifa Branca',
       '17:00'::TIME, '20:00'::TIME,
       0.89, 0.41, 0.25,
       0.62, '16:00'::TIME, '21:00'::TIME,
       5.50, 0.92,
       'CEMIG', '2026-01-01'::DATE
WHERE NOT EXISTS (
  SELECT 1 FROM tariff_schedules
  WHERE org_id = 'ORG_SOLARBR_002' AND effective_from = '2026-01-01'
);

-- ============================================================
-- 7. VPP Strategies (default per org)
-- ============================================================

-- Idempotent: only insert if no default strategy exists for this org
INSERT INTO vpp_strategies (org_id, strategy_name, target_mode,
                            min_soc, max_soc, max_charge_rate_kw,
                            charge_window_start, charge_window_end,
                            discharge_window_start,
                            target_self_consumption_pct,
                            is_default, is_active)
SELECT 'ORG_ENERGIA_001', 'Default SC Strategy', 'self_consumption',
       20, 95, 5.0,
       '00:00'::TIME, '06:00'::TIME, '17:00'::TIME,
       80.0, true, true
WHERE NOT EXISTS (
  SELECT 1 FROM vpp_strategies
  WHERE org_id = 'ORG_ENERGIA_001' AND is_default = true AND is_active = true
);

INSERT INTO vpp_strategies (org_id, strategy_name, target_mode,
                            min_soc, max_soc, max_charge_rate_kw,
                            charge_window_start, charge_window_end,
                            discharge_window_start,
                            target_self_consumption_pct,
                            is_default, is_active)
SELECT 'ORG_SOLARBR_002', 'Default SC Strategy', 'self_consumption',
       20, 95, 5.0,
       '00:00'::TIME, '06:00'::TIME, '17:00'::TIME,
       80.0, true, true
WHERE NOT EXISTS (
  SELECT 1 FROM vpp_strategies
  WHERE org_id = 'ORG_SOLARBR_002' AND is_default = true AND is_active = true
);

-- ============================================================
-- 8. Offline Events (sample)
-- ============================================================

INSERT INTO offline_events (asset_id, org_id, started_at, ended_at, cause, backfill)
VALUES
  ('DEV-016', 'ORG_ENERGIA_001', NOW() - INTERVAL '2 hours',  NULL,                        'network',         false),
  ('DEV-029', 'ORG_ENERGIA_001', NOW() - INTERVAL '4 hours',  NULL,                        'hardware',        false),
  ('DEV-039', 'ORG_SOLARBR_002', NOW() - INTERVAL '1 hour',   NULL,                        'firmware_update', false),
  ('DEV-007', 'ORG_ENERGIA_001', NOW() - INTERVAL '26 hours',  NOW() - INTERVAL '22 hours', 'network',         true),
  ('DEV-034', 'ORG_SOLARBR_002', NOW() - INTERVAL '48 hours',  NOW() - INTERVAL '44 hours', 'hardware',        true),
  ('DEV-012', 'ORG_ENERGIA_001', NOW() - INTERVAL '72 hours',  NOW() - INTERVAL '68 hours', 'firmware_update', true),
  ('DEV-025', 'ORG_ENERGIA_001', NOW() - INTERVAL '96 hours',  NOW() - INTERVAL '94 hours', 'unknown',         false),
  ('DEV-040', 'ORG_SOLARBR_002', NOW() - INTERVAL '120 hours', NOW() - INTERVAL '118 hours', 'network',        true),
  ('DEV-013', 'ORG_ENERGIA_001', NOW() - INTERVAL '150 hours', NOW() - INTERVAL '146 hours 30 minutes', 'hardware', true),
  ('DEV-031', 'ORG_SOLARBR_002', NOW() - INTERVAL '200 hours', NOW() - INTERVAL '196 hours', 'firmware_update', true);

-- ============================================================
-- 9. Daily Uptime Snapshots (28 days x 2 orgs)
-- ============================================================

INSERT INTO daily_uptime_snapshots (org_id, date, total_assets, online_assets, uptime_pct)
SELECT
  org_id,
  d::DATE AS date,
  CASE org_id WHEN 'ORG_ENERGIA_001' THEN 30 ELSE 21 END AS total_assets,
  CASE org_id
    WHEN 'ORG_ENERGIA_001' THEN 30 - FLOOR(RANDOM() * 3)::INT
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

COMMIT;
