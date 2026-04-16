-- ============================================================
-- migration_v5.15.sql — SC/TOU Attribution & 5-min Telemetry
-- ============================================================

-- 1. New partitioned table: asset_5min_metrics
CREATE TABLE IF NOT EXISTS asset_5min_metrics (
  id                      BIGSERIAL,
  asset_id                VARCHAR(50)    NOT NULL REFERENCES assets(asset_id),
  window_start            TIMESTAMPTZ    NOT NULL,
  pv_energy_kwh           NUMERIC(10,4)  NOT NULL DEFAULT 0,
  bat_charge_kwh          NUMERIC(10,4)  NOT NULL DEFAULT 0,
  bat_discharge_kwh       NUMERIC(10,4)  NOT NULL DEFAULT 0,
  grid_import_kwh         NUMERIC(10,4)  NOT NULL DEFAULT 0,
  grid_export_kwh         NUMERIC(10,4)  NOT NULL DEFAULT 0,
  load_kwh                NUMERIC(10,4)  NOT NULL DEFAULT 0,
  bat_charge_from_grid_kwh NUMERIC(10,4) NOT NULL DEFAULT 0,
  avg_battery_soc         NUMERIC(5,2),
  data_points             INTEGER        NOT NULL DEFAULT 0,
  created_at              TIMESTAMPTZ    NOT NULL DEFAULT NOW()
) PARTITION BY RANGE (window_start);

-- Partition boundaries at 03:00 UTC (= BRT midnight) for single-partition M4 queries
-- Pre-create partitions for today and next 30 days (from BRT day perspective)
DO $$
DECLARE
  d DATE;
  pname TEXT;
  pstart TIMESTAMPTZ;
  pend   TIMESTAMPTZ;
BEGIN
  FOR d IN
    SELECT generate_series(CURRENT_DATE - 1, CURRENT_DATE + 30, '1 day'::interval)::date
  LOOP
    pname  := 'asset_5min_metrics_' || to_char(d, 'YYYYMMDD');
    pstart := (d::TEXT || ' 03:00:00+00')::TIMESTAMPTZ;
    pend   := ((d + 1)::TEXT || ' 03:00:00+00')::TIMESTAMPTZ;
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF asset_5min_metrics
       FOR VALUES FROM (%L) TO (%L)',
      pname, pstart, pend
    );
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_5min_asset_window ON asset_5min_metrics (asset_id, window_start);
CREATE INDEX IF NOT EXISTS idx_5min_window ON asset_5min_metrics (window_start);

-- 2. ALTER dispatch_records: add target_mode
ALTER TABLE dispatch_records
  ADD COLUMN IF NOT EXISTS target_mode VARCHAR(50);

-- Backfill: treat all existing dispatches as self_consumption
UPDATE dispatch_records SET target_mode = 'self_consumption' WHERE target_mode IS NULL;

-- 3. ALTER assets: add allow_export
ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS allow_export BOOLEAN DEFAULT false;

-- 4. ALTER homes: add contracted_demand_kw (PS pre-work for v5.16)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'homes'
  ) THEN
    ALTER TABLE homes
      ADD COLUMN IF NOT EXISTS contracted_demand_kw REAL;
  END IF;
END $$;

-- 5. ALTER revenue_daily: add SC/TOU columns
ALTER TABLE revenue_daily
  ADD COLUMN IF NOT EXISTS sc_savings_reais  NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS tou_savings_reais NUMERIC(10,2);
