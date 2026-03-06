-- ============================================================
-- migration_v5.13.sql
-- Block 1: ems_health + partition
-- Block 2: asset_hourly_metrics +6 columns
-- ============================================================

-- 1. New aggregation columns for asset_hourly_metrics
ALTER TABLE asset_hourly_metrics
  ADD COLUMN IF NOT EXISTS pv_generation_kwh     NUMERIC(10,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS grid_import_kwh       NUMERIC(10,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS grid_export_kwh       NUMERIC(10,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS load_consumption_kwh  NUMERIC(10,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_battery_soc       NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS peak_battery_power_kw NUMERIC(8,3);

-- 2. Verify UNIQUE constraint exists (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_asset_hourly'
  ) THEN
    ALTER TABLE asset_hourly_metrics
      ADD CONSTRAINT uq_asset_hourly UNIQUE (asset_id, hour_timestamp);
  END IF;
END
$$;

-- 3. EMS health tracking (Block 1: parsed from MSG#0 emsList)
CREATE TABLE IF NOT EXISTS ems_health (
  id               SERIAL       PRIMARY KEY,
  asset_id         VARCHAR(50)  NOT NULL REFERENCES assets(asset_id) ON DELETE CASCADE,
  client_id        VARCHAR(100) NOT NULL,
  firmware_version VARCHAR(50),
  wifi_signal_dbm  INTEGER,
  uptime_seconds   BIGINT,
  error_codes      JSONB        DEFAULT '[]',
  last_heartbeat   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_ems_health_asset UNIQUE (asset_id)
);

CREATE INDEX IF NOT EXISTS idx_ems_health_heartbeat
  ON ems_health (last_heartbeat DESC);

-- 4. Next-month partition for telemetry_history
CREATE TABLE IF NOT EXISTS telemetry_history_2026_04
  PARTITION OF telemetry_history
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
