-- ============================================================
-- v7.1 Production Schema Compatibility
--
-- Purpose:
--   Codify the production additive schema fixes that were first applied
--   during the 2026-04-28 Solfacil production schema-drift recovery.
--
-- Scope:
--   - P2 gateway detail + M1 deviceList rated-spec fields on assets
--   - P4 HEMS batch targeting/history fields on device_command_logs
--   - P5 strategy trigger tables and runtime grants
--
-- This migration is intentionally additive and idempotent.
-- ============================================================

\set ON_ERROR_STOP on

BEGIN;

-- P2/M1: gateway detail reads rated_max_power_kw; deviceList ingestion writes all four rated spec columns.
ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS rated_max_power_kw REAL,
  ADD COLUMN IF NOT EXISTS rated_max_current_a REAL,
  ADD COLUMN IF NOT EXISTS rated_min_power_kw REAL,
  ADD COLUMN IF NOT EXISTS rated_min_current_a REAL;

-- P4: HEMS batch dispatch/history contract.
ALTER TABLE public.device_command_logs
  ADD COLUMN IF NOT EXISTS batch_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS source VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_device_command_logs_batch_id
  ON public.device_command_logs(batch_id)
  WHERE batch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_device_command_logs_gateway_batch
  ON public.device_command_logs(gateway_id, batch_id, created_at DESC)
  WHERE batch_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.assets TO solfacil_app, solfacil_service;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.device_command_logs TO solfacil_app, solfacil_service;
GRANT SELECT, USAGE ON SEQUENCE public.device_command_logs_id_seq TO solfacil_app, solfacil_service;

COMMIT;

-- P5: strategy triggers. Keep this outside the transaction so this migration can
-- be run from psql with the canonical artifact preserved instead of duplicating it.
\ir ../src/shared/migrations/001_p5_strategy_triggers.sql

-- Runtime grants for in-place production upgrades. Bootstrap grants may hide this
-- locally, but production additive migrations need explicit runtime-role grants.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.strategy_intents TO solfacil_app, solfacil_service;
GRANT SELECT, USAGE ON SEQUENCE public.strategy_intents_id_seq TO solfacil_app, solfacil_service;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.posture_overrides TO solfacil_app, solfacil_service;
GRANT SELECT, USAGE ON SEQUENCE public.posture_overrides_id_seq TO solfacil_app, solfacil_service;
