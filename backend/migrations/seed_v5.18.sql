-- ============================================================
-- seed_v5.18.sql — Gateway registry + 3 homes for Solfacil pilot
-- Date: 2026-03-09
-- Depends on: migration_v5.18.sql
-- ============================================================

-- ============================================================
-- 1. Ensure Solfacil org exists (idempotent)
-- ============================================================

INSERT INTO organizations (org_id, name, plan_tier)
VALUES ('ORG_ENERGIA_001', 'Solfacil Pilot Corp', 'ENTERPRISE')
ON CONFLICT (org_id) DO NOTHING;

-- ============================================================
-- 2. Insert 3 Homes (one per gateway)
-- ============================================================

INSERT INTO homes (home_id, org_id, name, address)
VALUES
  ('HOME-SF-001', 'ORG_ENERGIA_001', 'Home-1', 'São Paulo, SP'),
  ('HOME-SF-002', 'ORG_ENERGIA_001', 'Home-2', 'São Paulo, SP'),
  ('HOME-SF-003', 'ORG_ENERGIA_001', 'Home-3', 'São Paulo, SP')
ON CONFLICT (home_id) DO NOTHING;

-- ============================================================
-- 3. Insert 3 Gateways (one per home)
-- ============================================================
-- Broker: 18.141.63.142:1883, user: xuheng, pass: xuheng8888!

INSERT INTO gateways (gateway_id, client_id, org_id, home_id,
                      mqtt_broker_host, mqtt_broker_port,
                      mqtt_username, mqtt_password,
                      device_name, product_key, status)
VALUES
  ('GW-SF-001', 'WKRD24070202100144F', 'ORG_ENERGIA_001', 'HOME-SF-001',
   '18.141.63.142', 1883, 'xuheng', 'xuheng8888!',
   'EMS_N2', 'ems', 'online'),

  ('GW-SF-002', 'WKRD24070202100228G', 'ORG_ENERGIA_001', 'HOME-SF-002',
   '18.141.63.142', 1883, 'xuheng', 'xuheng8888!',
   'EMS_N2', 'ems', 'online'),

  ('GW-SF-003', 'WKRD24070202100212P', 'ORG_ENERGIA_001', 'HOME-SF-003',
   '18.141.63.142', 1883, 'xuheng', 'xuheng8888!',
   'EMS_N2', 'ems', 'online'),

  ('GW-TEST-001', 'WKRD24070202100141I', 'ORG_ENERGIA_001', NULL,
   '18.141.63.142', 1883, 'xuheng', 'xuheng8888!',
   'EMS_N2', 'ems', 'online')
ON CONFLICT (gateway_id) DO NOTHING;

-- ============================================================
-- 4. Update existing assets: link to gateways where possible
-- ============================================================
-- ASSET_SP_001 is under ORG_ENERGIA_001 → assign to GW-SF-001
-- ASSET_RJ_002 is under ORG_ENERGIA_001 → assign to GW-SF-002

UPDATE assets SET gateway_id = 'GW-SF-001', home_id = 'HOME-SF-001'
WHERE asset_id = 'ASSET_SP_001' AND gateway_id IS NULL AND home_id IS NULL;

UPDATE assets SET gateway_id = 'GW-SF-002', home_id = 'HOME-SF-002'
WHERE asset_id = 'ASSET_RJ_002' AND gateway_id IS NULL AND home_id IS NULL;
