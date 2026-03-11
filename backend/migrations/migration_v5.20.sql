-- ============================================================
-- SOLFACIL VPP — Migration v5.20
-- Permissions fix + schema updates
-- Date: 2026-03-11
-- Depends on: migration_v5.19.sql
-- ============================================================

BEGIN;

-- ============================================================
-- PHASE 1: Permission GRANTs missing from v5.19
-- ============================================================

-- gateways: app pool needs SELECT (BFF read), service pool needs full CRUD
GRANT SELECT, INSERT, UPDATE ON gateways TO solfacil_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON gateways TO solfacil_service;

-- device_command_logs: app pool writes commands, service pool processes them
GRANT SELECT, INSERT, UPDATE, DELETE ON device_command_logs TO solfacil_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON device_command_logs TO solfacil_service;

-- Sequences (if auto-increment IDs)
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO solfacil_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO solfacil_service;

-- ============================================================
-- PHASE 2: device_command_logs schema updates for M3
-- ============================================================

ALTER TABLE device_command_logs
  ADD COLUMN IF NOT EXISTS dispatched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS acked_at TIMESTAMPTZ;

-- Index for M3 polling query
CREATE INDEX IF NOT EXISTS idx_dcl_pending_dispatch
  ON device_command_logs (status, created_at)
  WHERE status = 'pending_dispatch';

COMMIT;
