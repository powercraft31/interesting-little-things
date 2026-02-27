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

-- ── Schema 擴充（Stage 5）── 安全：ADD COLUMN IF NOT EXISTS
ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS investimento_brl  DECIMAL(14,2),
  ADD COLUMN IF NOT EXISTS roi_pct           DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS payback_str       VARCHAR(10),
  ADD COLUMN IF NOT EXISTS receita_mes_brl   DECIMAL(12,2);

ALTER TABLE device_state
  ADD COLUMN IF NOT EXISTS pv_daily_energy      DECIMAL(10,3) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bat_charged_today    DECIMAL(10,3) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bat_discharged_today DECIMAL(10,3) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS grid_import_kwh      DECIMAL(10,3) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS grid_export_kwh      DECIMAL(10,3) DEFAULT 0;

-- ── Assets 商業指標（Stage 5）──
UPDATE assets SET investimento_brl=4200000, roi_pct=19.2, payback_str='3,8', receita_mes_brl=412300 WHERE asset_id='ASSET_SP_001';
UPDATE assets SET investimento_brl=3800000, roi_pct=17.8, payback_str='4,1', receita_mes_brl=378500 WHERE asset_id='ASSET_RJ_002';
UPDATE assets SET investimento_brl=2900000, roi_pct=16.4, payback_str='4,5', receita_mes_brl=298400 WHERE asset_id='ASSET_MG_003';
UPDATE assets SET investimento_brl=1500000, roi_pct=15.1, payback_str='4,8', receita_mes_brl=145800 WHERE asset_id='ASSET_PR_004';

-- ── Device State 日累計能量（Stage 5）──
UPDATE device_state SET pv_daily_energy=22.4, bat_charged_today=8.1,  bat_discharged_today=12.3, grid_import_kwh=0.0,  grid_export_kwh=0.0  WHERE asset_id='ASSET_SP_001';
UPDATE device_state SET pv_daily_energy=28.6, bat_charged_today=14.2, bat_discharged_today=0.0,  grid_import_kwh=0.0,  grid_export_kwh=8.6  WHERE asset_id='ASSET_RJ_002';
UPDATE device_state SET pv_daily_energy=18.9, bat_charged_today=5.4,  bat_discharged_today=10.8, grid_import_kwh=0.0,  grid_export_kwh=0.0  WHERE asset_id='ASSET_MG_003';
UPDATE device_state SET pv_daily_energy=24.1, bat_charged_today=9.8,  bat_discharged_today=0.0,  grid_import_kwh=12.4, grid_export_kwh=0.0  WHERE asset_id='ASSET_PR_004';

-- ── Revenue Daily 今日結算（Stage 5）──
INSERT INTO revenue_daily (asset_id, date, pv_energy_kwh, grid_export_kwh, grid_import_kwh, bat_discharged_kwh, revenue_reais, cost_reais, profit_reais, calculated_at)
VALUES
  ('ASSET_SP_001', CURRENT_DATE, 22.4, 0.0, 0.0,  12.3, 18650, 4250, 14400, NOW()),
  ('ASSET_RJ_002', CURRENT_DATE, 28.6, 8.6, 0.0,  0.0,  16420, 3890, 12530, NOW()),
  ('ASSET_MG_003', CURRENT_DATE, 18.9, 0.0, 0.0,  10.8, 11280, 2680, 8600,  NOW()),
  ('ASSET_PR_004', CURRENT_DATE, 24.1, 0.0, 12.4, 0.0,  6100,  1895, 4205,  NOW())
ON CONFLICT (asset_id, date) DO UPDATE SET
  revenue_reais=EXCLUDED.revenue_reais, cost_reais=EXCLUDED.cost_reais,
  profit_reais=EXCLUDED.profit_reais, calculated_at=NOW();

-- ── RLS admin-bypass for revenue_daily（Stage 5）──
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy WHERE polname = 'rls_revenue_daily_admin'
      AND polrelid = 'revenue_daily'::regclass
  ) THEN
    EXECUTE 'CREATE POLICY rls_revenue_daily_admin ON revenue_daily FOR SELECT
      USING (current_setting(''app.current_org_id'', true) = ''''
             OR current_setting(''app.current_org_id'', true) IS NULL)';
  END IF;
END
$$;

COMMIT;
