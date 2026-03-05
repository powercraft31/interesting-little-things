-- ============================================================
-- SOLFACIL VPP v5.12 — Migration (ALTER statements for existing tables)
-- Run AFTER ddl_base.sql has been applied with v5.12 changes.
-- For existing deployments that already have the old schema.
-- ============================================================

BEGIN;

-- ── homes table (new) ──
CREATE TABLE IF NOT EXISTS homes (
  home_id     VARCHAR(50)  PRIMARY KEY,
  org_id      VARCHAR(50)  NOT NULL REFERENCES organizations(org_id),
  name        VARCHAR(200) NOT NULL,
  address     TEXT,
  created_at  TIMESTAMPTZ  DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_homes_org ON homes(org_id);

-- ── assets ALTER — unified device model ──
ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS asset_type       VARCHAR(30) NOT NULL DEFAULT 'INVERTER_BATTERY',
  ADD COLUMN IF NOT EXISTS home_id          VARCHAR(50) REFERENCES homes(home_id),
  ADD COLUMN IF NOT EXISTS brand            VARCHAR(100),
  ADD COLUMN IF NOT EXISTS model            VARCHAR(100),
  ADD COLUMN IF NOT EXISTS serial_number    VARCHAR(100),
  ADD COLUMN IF NOT EXISTS commissioned_at  TIMESTAMPTZ;

-- Add CHECK constraint for asset_type (if not already present)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'assets_asset_type_check'
  ) THEN
    ALTER TABLE assets ADD CONSTRAINT assets_asset_type_check
      CHECK (asset_type IN ('INVERTER_BATTERY','SMART_METER','HVAC','EV_CHARGER','SOLAR_PANEL'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_assets_home ON assets(home_id);
CREATE INDEX IF NOT EXISTS idx_assets_type ON assets(asset_type);

-- ── device_state ALTER — telemetry_json ──
ALTER TABLE device_state
  ADD COLUMN IF NOT EXISTS telemetry_json JSONB DEFAULT '{}';

-- ── tariff_schedules ALTER — intermediate rate + disco ──
ALTER TABLE tariff_schedules
  ADD COLUMN IF NOT EXISTS intermediate_rate  DECIMAL(8,4),
  ADD COLUMN IF NOT EXISTS intermediate_start TIME,
  ADD COLUMN IF NOT EXISTS intermediate_end   TIME,
  ADD COLUMN IF NOT EXISTS disco              VARCHAR(50);

UPDATE tariff_schedules SET
  intermediate_rate = (peak_rate + offpeak_rate) / 2.0,
  intermediate_start = '16:00',
  intermediate_end = '21:00',
  disco = schedule_name
WHERE intermediate_rate IS NULL;

-- ── offline_events table (new) ──
CREATE TABLE IF NOT EXISTS offline_events (
  id            SERIAL       PRIMARY KEY,
  asset_id      VARCHAR(50)  NOT NULL REFERENCES assets(asset_id),
  org_id        VARCHAR(50)  NOT NULL REFERENCES organizations(org_id),
  started_at    TIMESTAMPTZ  NOT NULL,
  ended_at      TIMESTAMPTZ,
  cause         VARCHAR(50)  DEFAULT 'unknown',
  backfill      BOOLEAN      DEFAULT false,
  created_at    TIMESTAMPTZ  DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_offline_events_asset ON offline_events(asset_id, started_at DESC);

-- ── daily_uptime_snapshots table (new) ──
CREATE TABLE IF NOT EXISTS daily_uptime_snapshots (
  id            SERIAL       PRIMARY KEY,
  org_id        VARCHAR(50)  NOT NULL REFERENCES organizations(org_id),
  date          DATE         NOT NULL,
  total_assets  INTEGER      NOT NULL,
  online_assets INTEGER      NOT NULL,
  uptime_pct    DECIMAL(5,2) NOT NULL,
  created_at    TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE (org_id, date)
);
CREATE INDEX IF NOT EXISTS idx_uptime_org_date ON daily_uptime_snapshots(org_id, date DESC);

-- ── telemetry_history performance index ──
CREATE INDEX IF NOT EXISTS idx_telemetry_asset_time
  ON telemetry_history (asset_id, recorded_at DESC);

-- ── RLS for new tables ──
ALTER TABLE homes ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'rls_homes_tenant') THEN
    CREATE POLICY rls_homes_tenant ON homes
      USING (org_id = current_setting('app.current_org_id', true));
  END IF;
END $$;

ALTER TABLE offline_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'rls_offline_events_tenant') THEN
    CREATE POLICY rls_offline_events_tenant ON offline_events
      USING (org_id = current_setting('app.current_org_id', true));
  END IF;
END $$;

ALTER TABLE daily_uptime_snapshots ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'rls_uptime_tenant') THEN
    CREATE POLICY rls_uptime_tenant ON daily_uptime_snapshots
      USING (org_id = current_setting('app.current_org_id', true));
  END IF;
END $$;

COMMIT;
