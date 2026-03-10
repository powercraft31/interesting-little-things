-- ============================================================
-- SOLFACIL VPP — Migration v5.19
-- Schema consolidation: homes → gateways, gateway_id → SN
-- Date: 2026-03-10
-- Depends on: migration_v5.18_hotfix.sql
-- ============================================================

BEGIN;

-- ============================================================
-- PHASE 1: 擴展 gateways 表（新增 homes 欄位）
-- ============================================================

ALTER TABLE gateways
  ADD COLUMN IF NOT EXISTS name VARCHAR(200),
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS contracted_demand_kw REAL;

-- v5.18 新增: ems_health JSONB + timestamp（若 hotfix 未 apply）
ALTER TABLE gateways
  ADD COLUMN IF NOT EXISTS ems_health JSONB DEFAULT '{}';
ALTER TABLE gateways
  ADD COLUMN IF NOT EXISTS ems_health_at TIMESTAMPTZ;

-- ============================================================
-- PHASE 2: 從 homes 表遷移數據到 gateways
-- ============================================================

UPDATE gateways g
SET
  name = h.name,
  address = h.address,
  contracted_demand_kw = h.contracted_demand_kw
FROM homes h
WHERE g.home_id = h.home_id;

-- 對無 home 的 gateway（GW-TEST-001），設 name
UPDATE gateways
SET name = 'Test Gateway'
WHERE gateway_id = 'GW-TEST-001' AND name IS NULL;

-- 2b: 從 assets.home_id → gateways.home_id 對齊 gateway_id
-- 確保所有有 home_id 但無 gateway_id 的 assets 都對齊到正確 gateway
UPDATE assets a
SET gateway_id = g.gateway_id
FROM gateways g
WHERE a.home_id = g.home_id
  AND a.gateway_id IS NULL
  AND a.home_id IS NOT NULL;

-- ============================================================
-- PHASE 3: gateway_id PK 值 → SN
-- 必須先解除所有 FK → 改值 → 重建 FK
-- ============================================================

-- 3a: 解除 FK 約束
ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_gateway_id_fkey;
ALTER TABLE device_command_logs DROP CONSTRAINT IF EXISTS device_command_logs_gateway_id_fkey;

-- 3b: 更新 gateways PK 值（舊 → SN）
UPDATE gateways SET gateway_id = 'WKRD24070202100144F' WHERE gateway_id = 'GW-SF-001';
UPDATE gateways SET gateway_id = 'WKRD24070202100228G' WHERE gateway_id = 'GW-SF-002';
UPDATE gateways SET gateway_id = 'WKRD24070202100212P' WHERE gateway_id = 'GW-SF-003';
UPDATE gateways SET gateway_id = 'WKRD24070202100141I' WHERE gateway_id = 'GW-TEST-001';

-- 3c: 更新 assets.gateway_id FK 值
UPDATE assets SET gateway_id = 'WKRD24070202100144F' WHERE gateway_id = 'GW-SF-001';
UPDATE assets SET gateway_id = 'WKRD24070202100228G' WHERE gateway_id = 'GW-SF-002';
UPDATE assets SET gateway_id = 'WKRD24070202100212P' WHERE gateway_id = 'GW-SF-003';
UPDATE assets SET gateway_id = 'WKRD24070202100141I' WHERE gateway_id = 'GW-TEST-001';

-- 3d: 更新 device_command_logs.gateway_id FK 值
UPDATE device_command_logs SET gateway_id = 'WKRD24070202100144F' WHERE gateway_id = 'GW-SF-001';
UPDATE device_command_logs SET gateway_id = 'WKRD24070202100228G' WHERE gateway_id = 'GW-SF-002';
UPDATE device_command_logs SET gateway_id = 'WKRD24070202100212P' WHERE gateway_id = 'GW-SF-003';
UPDATE device_command_logs SET gateway_id = 'WKRD24070202100141I' WHERE gateway_id = 'GW-TEST-001';

-- 3e: 更新 device_command_logs.client_id（SN 就是 client_id）
UPDATE device_command_logs SET client_id = gateway_id;

-- 3f: 重建 FK 約束
ALTER TABLE assets
  ADD CONSTRAINT assets_gateway_id_fkey
  FOREIGN KEY (gateway_id) REFERENCES gateways(gateway_id);

ALTER TABLE device_command_logs
  ADD CONSTRAINT device_command_logs_gateway_id_fkey
  FOREIGN KEY (gateway_id) REFERENCES gateways(gateway_id);

-- ============================================================
-- PHASE 4: 刪除冗餘欄位
-- ============================================================

-- 4a: 刪除 gateways.client_id（SN = client_id = gateway_id）
ALTER TABLE gateways DROP COLUMN IF EXISTS client_id;

-- 4b: 刪除 gateways.home_id FK（homes 將被刪除）
ALTER TABLE gateways DROP CONSTRAINT IF EXISTS gateways_home_id_fkey;
ALTER TABLE gateways DROP COLUMN IF EXISTS home_id;
DROP INDEX IF EXISTS idx_gateways_home;

-- 4c: 刪除 assets.home_id FK（改用 gateway_id）
ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_home_id_fkey;
ALTER TABLE assets DROP COLUMN IF EXISTS home_id;
DROP INDEX IF EXISTS idx_assets_home;

-- 4d: 刪除 device_command_logs.client_id（= gateway_id，冗餘）
ALTER TABLE device_command_logs DROP COLUMN IF EXISTS client_id;

-- ============================================================
-- PHASE 5: 刪除 homes 表
-- ============================================================

-- 5a: 先刪 RLS policy 和相關物件
DROP POLICY IF EXISTS rls_homes_tenant ON homes;
DO $$ BEGIN
  ALTER TABLE homes DISABLE ROW LEVEL SECURITY;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;
DROP INDEX IF EXISTS idx_homes_org;

-- 5b: 刪除 homes 表
DROP TABLE IF EXISTS homes;

-- ============================================================
-- PHASE 6: RLS for gateways（修復防線破口）
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'gateways' AND policyname = 'rls_gateways_tenant'
  ) THEN
    EXECUTE 'CREATE POLICY rls_gateways_tenant ON gateways USING (org_id = current_setting(''app.current_org_id'', true))';
  END IF;
END $$;

-- 確保 RLS 已啟用
ALTER TABLE gateways ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- PHASE 7: 更新 gateways name 為含客戶名的格式
-- ============================================================

UPDATE gateways SET name = 'Casa Silva · Home-1' WHERE gateway_id = 'WKRD24070202100144F';
UPDATE gateways SET name = 'Casa Santos · Home-2' WHERE gateway_id = 'WKRD24070202100228G';
UPDATE gateways SET name = 'Casa Oliveira · Home-3' WHERE gateway_id = 'WKRD24070202100212P';
UPDATE gateways SET name = 'Test Gateway' WHERE gateway_id = 'WKRD24070202100141I';

COMMIT;
