-- ============================================================
-- SOLFACIL VPP v5.10 Migration — Dual-Role RLS Architecture
-- ============================================================
-- Changes:
--   1. Fix feature_flags UNIQUE constraint (COALESCE expression)
--   2. Enable RLS on dispatch_commands (pure tenant isolation)
--   3. Add composite index for dashboard KPI aggregation
--   4. Remove all legacy admin bypass RLS policies
--   5. Create solfacil_service role (BYPASSRLS)
-- Idempotent: safe to run multiple times.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Fix feature_flags UNIQUE constraint
-- ============================================================
-- Old (invalid SQL): UNIQUE (flag_name, COALESCE(org_id, ''))
-- New (correct SQL): CREATE UNIQUE INDEX

ALTER TABLE feature_flags DROP CONSTRAINT IF EXISTS feature_flags_flag_name_coalesce_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_feature_flags_name_org
  ON feature_flags (flag_name, COALESCE(org_id, ''));

-- ============================================================
-- 2. Enable RLS on dispatch_commands (pure tenant isolation)
-- ============================================================

ALTER TABLE dispatch_commands ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'dispatch_commands'
      AND policyname = 'rls_dispatch_commands_tenant'
  ) THEN
    CREATE POLICY rls_dispatch_commands_tenant ON dispatch_commands
      USING (org_id = current_setting('app.current_org_id', true));
  END IF;
END
$$;

-- ============================================================
-- 3. Dashboard KPI composite index
-- ============================================================
-- Query pattern:
--   SELECT COUNT(*) FILTER (WHERE status = 'completed')
--   FROM dispatch_commands
--   WHERE org_id = $1 AND dispatched_at >= CURRENT_DATE
-- Index order: org_id (RLS filter), status (FILTER), dispatched_at DESC (range scan)

CREATE INDEX IF NOT EXISTS idx_dispatch_commands_status_org
  ON dispatch_commands (org_id, status, dispatched_at DESC);

-- ============================================================
-- 4. Remove all legacy admin bypass RLS policies
-- ============================================================
-- v5.10 replaces "IS NULL OR = ''" admin bypass with dual-role architecture.

DROP POLICY IF EXISTS rls_assets_admin_bypass ON assets;
-- trades, revenue_daily, dispatch_records have no org_id → no RLS policies to drop
DROP POLICY IF EXISTS rls_dispatch_commands_admin_bypass ON dispatch_commands;
DROP POLICY IF EXISTS rls_tariff_schedules_admin_bypass ON tariff_schedules;
DROP POLICY IF EXISTS rls_vpp_strategies_admin_bypass ON vpp_strategies;
DROP POLICY IF EXISTS rls_parser_rules_admin_bypass ON parser_rules;
DROP POLICY IF EXISTS rls_feature_flags_admin_bypass ON feature_flags;
DROP POLICY IF EXISTS rls_trade_schedules_admin_bypass ON trade_schedules;
DROP POLICY IF EXISTS rls_algorithm_metrics_admin_bypass ON algorithm_metrics;

-- ============================================================
-- 5. Create solfacil_service role (BYPASSRLS)
-- ============================================================
-- Cron Jobs (M2/M3/M4) use this role to legitimately bypass RLS.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'solfacil_service') THEN
    CREATE ROLE solfacil_service LOGIN PASSWORD 'CHANGE_ME_IN_PRODUCTION' BYPASSRLS;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE solfacil_vpp TO solfacil_service;
GRANT USAGE ON SCHEMA public TO solfacil_service;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO solfacil_service;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO solfacil_service;

-- ============================================================
-- 6. Ensure solfacil_app role exists
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'solfacil_app') THEN
    CREATE ROLE solfacil_app LOGIN PASSWORD 'CHANGE_ME_IN_PRODUCTION';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE solfacil_vpp TO solfacil_app;
GRANT USAGE ON SCHEMA public TO solfacil_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO solfacil_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO solfacil_app;

COMMIT;
