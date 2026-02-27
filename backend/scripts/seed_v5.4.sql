-- ==========================================================
-- SOLFACIL VPP v5.4 — Seed Data
-- 冪等性：可重複執行，衝突時跳過（ON CONFLICT DO NOTHING）
-- 執行身份：postgres superuser（bypass RLS）
-- ==========================================================
BEGIN;

-- ── 1. Organizations ──────────────────────────────────────
-- Note: organizations table has no is_active column
INSERT INTO organizations (org_id, name, plan_tier)
VALUES
  ('ORG_ENERGIA_001', 'Solfacil Pilot Corp',    'ENTERPRISE'),
  ('ORG_SOLARBR_002', 'Solar BR Distribuidora', 'PROFESSIONAL')
ON CONFLICT (org_id) DO NOTHING;

-- ── 2. Users & Roles ──────────────────────────────────────
INSERT INTO users (user_id, email, name, hashed_password, is_active)
VALUES
  ('USER_ADMIN_001', 'admin@solfacil.com.br', 'Solfacil Admin',
   -- bcrypt placeholder hash (auth not implemented yet)
   '$2b$12$placeholder_hash_admin_001_solfacil2026demo_xxxxxx',
   true)
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO user_org_roles (user_id, org_id, role)
VALUES
  ('USER_ADMIN_001', 'ORG_ENERGIA_001', 'SOLFACIL_ADMIN')
ON CONFLICT (user_id, org_id) DO NOTHING;

-- ── 3. Assets（精準對應 get-assets.ts mock 數據）─────────

-- SP_001：São Paulo - Casa Verde（峰谷套利）
INSERT INTO assets (asset_id, org_id, name, region, capacidade_kw, capacity_kwh, operation_mode, is_active)
VALUES
  ('ASSET_SP_001', 'ORG_ENERGIA_001', 'São Paulo - Casa Verde',
   'SP', 5.2, 13.5, 'peak_valley_arbitrage', true)
ON CONFLICT (asset_id) DO NOTHING;

-- RJ_002：Rio de Janeiro - Copacabana（自發自用）
INSERT INTO assets (asset_id, org_id, name, region, capacidade_kw, capacity_kwh, operation_mode, is_active)
VALUES
  ('ASSET_RJ_002', 'ORG_ENERGIA_001', 'Rio de Janeiro - Copacabana',
   'RJ', 4.8, 10.0, 'self_consumption', true)
ON CONFLICT (asset_id) DO NOTHING;

-- MG_003：Belo Horizonte - Pampulha（VPP調度）
INSERT INTO assets (asset_id, org_id, name, region, capacidade_kw, capacity_kwh, operation_mode, is_active)
VALUES
  ('ASSET_MG_003', 'ORG_SOLARBR_002', 'Belo Horizonte - Pampulha',
   'MG', 3.6, 11.5, 'peak_valley_arbitrage', true)
ON CONFLICT (asset_id) DO NOTHING;

-- PR_004：Curitiba - Batel（削峰）
INSERT INTO assets (asset_id, org_id, name, region, capacidade_kw, capacity_kwh, operation_mode, is_active)
VALUES
  ('ASSET_PR_004', 'ORG_SOLARBR_002', 'Curitiba - Batel',
   'PR', 2.0, 14.0, 'peak_shaving', true)
ON CONFLICT (asset_id) DO NOTHING;

-- ── 4. Device State（初始遙測快照，對應 mock status + metering）──

-- SP_001：放電中，SOC=65%
INSERT INTO device_state (
  asset_id, battery_soc, bat_soh, bat_work_status, battery_voltage,
  bat_cycle_count, pv_power, battery_power, grid_power_kw, load_power,
  inverter_temp, is_online, grid_frequency
)
VALUES (
  'ASSET_SP_001', 65.0, 98.0, 'discharging', 51.6,
  312, 3.2, -1.8, 0.0, 5.0,
  38.2, true, 60.02
)
ON CONFLICT (asset_id) DO NOTHING;

-- RJ_002：充電中，SOC=72%
INSERT INTO device_state (
  asset_id, battery_soc, bat_soh, bat_work_status, battery_voltage,
  bat_cycle_count, pv_power, battery_power, grid_power_kw, load_power,
  inverter_temp, is_online, grid_frequency
)
VALUES (
  'ASSET_RJ_002', 72.0, 97.0, 'charging', 51.8,
  198, 4.5, 1.0, -0.5, 3.0,
  35.1, true, 60.0
)
ON CONFLICT (asset_id) DO NOTHING;

-- MG_003：放電中，SOC=58%
INSERT INTO device_state (
  asset_id, battery_soc, bat_soh, bat_work_status, battery_voltage,
  bat_cycle_count, pv_power, battery_power, grid_power_kw, load_power,
  inverter_temp, is_online, grid_frequency
)
VALUES (
  'ASSET_MG_003', 58.0, 95.0, 'discharging', 50.4,
  445, 2.8, -1.5, 0.0, 4.3,
  40.5, true, 60.01
)
ON CONFLICT (asset_id) DO NOTHING;

-- PR_004：充電中，SOC=34%
INSERT INTO device_state (
  asset_id, battery_soc, bat_soh, bat_work_status, battery_voltage,
  bat_cycle_count, pv_power, battery_power, grid_power_kw, load_power,
  inverter_temp, is_online, grid_frequency
)
VALUES (
  'ASSET_PR_004', 34.0, 99.0, 'charging', 47.2,
  87, 3.6, 2.0, 1.4, 3.0,
  33.6, true, 60.01
)
ON CONFLICT (asset_id) DO NOTHING;

-- ── 5. Tariff Schedules（巴西 ANEEL 標準 TOU 電價）────────
-- tariff_schedules PK is auto-increment id, no unique constraint on (org_id, schedule_name).
-- Use WHERE NOT EXISTS to ensure idempotency on re-run.

-- ORG_ENERGIA_001: ANEEL TOU 2025 - SP Residencial
INSERT INTO tariff_schedules (
  org_id, schedule_name, peak_start, peak_end,
  peak_rate, offpeak_rate, feed_in_rate,
  currency, effective_from, effective_to
)
SELECT
  'ORG_ENERGIA_001', 'ANEEL TOU 2025 - SP Residencial',
  '17:00'::time, '21:59'::time,
  0.9521, 0.4832, 0.2418,
  'BRL', '2025-01-01'::date, NULL::date
WHERE NOT EXISTS (
  SELECT 1 FROM tariff_schedules
  WHERE org_id = 'ORG_ENERGIA_001'
    AND schedule_name = 'ANEEL TOU 2025 - SP Residencial'
);

-- ORG_SOLARBR_002: ANEEL TOU 2025 - MG/PR Residencial
INSERT INTO tariff_schedules (
  org_id, schedule_name, peak_start, peak_end,
  peak_rate, offpeak_rate, feed_in_rate,
  currency, effective_from, effective_to
)
SELECT
  'ORG_SOLARBR_002', 'ANEEL TOU 2025 - MG/PR Residencial',
  '17:00'::time, '21:59'::time,
  0.8934, 0.4521, 0.2350,
  'BRL', '2025-01-01'::date, NULL::date
WHERE NOT EXISTS (
  SELECT 1 FROM tariff_schedules
  WHERE org_id = 'ORG_SOLARBR_002'
    AND schedule_name = 'ANEEL TOU 2025 - MG/PR Residencial'
);

COMMIT;
