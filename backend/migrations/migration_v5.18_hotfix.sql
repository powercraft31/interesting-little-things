-- ============================================================
-- migration_v5.18_hotfix.sql — Add ems_health JSONB to gateways
-- Date: 2026-03-09
-- Depends on: migration_v5.18.sql
-- ============================================================

-- EMS health status snapshot (emsList payload from MSG#1)
ALTER TABLE gateways
  ADD COLUMN IF NOT EXISTS ems_health JSONB;

-- Device-side timestamp of the last emsList message
ALTER TABLE gateways
  ADD COLUMN IF NOT EXISTS ems_health_at TIMESTAMPTZ;

COMMENT ON COLUMN gateways.ems_health IS
  'Latest emsList payload from MSG#1 (firmware version, WiFi signal, uptime, errors). Written by FragmentAssembler.';
COMMENT ON COLUMN gateways.ems_health_at IS
  'Device-side timestamp of the last emsList message (from payload.timeStamp, NOT server clock).';
