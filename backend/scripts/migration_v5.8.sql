-- Migration v5.8: Closed-loop Telemetry Feedback & Data Contract
-- Run: sudo -u postgres psql -d solfacil_vpp -f backend/scripts/migration_v5.8.sql
BEGIN;

-- 1. Add energy_kwh to telemetry_history (delta kWh per reading, positive=charge, negative=discharge)
ALTER TABLE telemetry_history
  ADD COLUMN IF NOT EXISTS energy_kwh NUMERIC(10,4) DEFAULT 0;

-- 2. Create asset_hourly_metrics (Shared Contract Table — M1 writes, M4 reads)
CREATE TABLE IF NOT EXISTS asset_hourly_metrics (
  id                  BIGSERIAL PRIMARY KEY,
  asset_id            VARCHAR(50) NOT NULL REFERENCES assets(asset_id),
  hour_timestamp      TIMESTAMPTZ NOT NULL,
  total_charge_kwh    NUMERIC(10,4) NOT NULL DEFAULT 0,
  total_discharge_kwh NUMERIC(10,4) NOT NULL DEFAULT 0,
  data_points_count   INT NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_asset_hourly UNIQUE (asset_id, hour_timestamp)
);
CREATE INDEX IF NOT EXISTS idx_asset_hourly_asset_hour ON asset_hourly_metrics (asset_id, hour_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_asset_hourly_hour ON asset_hourly_metrics (hour_timestamp DESC);

-- 3. Create telemetry_history partition for 2026-04 (maintenance)
CREATE TABLE IF NOT EXISTS telemetry_history_2026_04
  PARTITION OF telemetry_history
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');

COMMIT;
