-- ============================================================
-- SOLFACIL VPP — Base DDL (v5.10)
-- Extracted from design/backend_architecture/10_DATABASE_SCHEMA_v5.10.md §3
-- 19 tables total. Run as superuser (postgres).
-- ============================================================

BEGIN;

-- ============================================================
-- M6 Identity
-- ============================================================

CREATE TABLE IF NOT EXISTS organizations (
  org_id        VARCHAR(50) PRIMARY KEY,
  name          VARCHAR(200) NOT NULL,
  plan_tier     VARCHAR(20)  NOT NULL DEFAULT 'standard',
  timezone      VARCHAR(50)  NOT NULL DEFAULT 'America/Sao_Paulo',
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  user_id         VARCHAR(50)  PRIMARY KEY,
  email           VARCHAR(255) UNIQUE NOT NULL,
  name            VARCHAR(200),
  hashed_password VARCHAR(255),
  is_active       BOOLEAN      NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_org_roles (
  user_id    VARCHAR(50) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  org_id     VARCHAR(50) NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  role       VARCHAR(30) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, org_id)
);

-- ============================================================
-- M1 IoT Hub
-- ============================================================

CREATE TABLE IF NOT EXISTS assets (
  asset_id       VARCHAR(50)  PRIMARY KEY,
  org_id         VARCHAR(50)  NOT NULL REFERENCES organizations(org_id),
  name           VARCHAR(200) NOT NULL,
  region         VARCHAR(10),
  capacidade_kw  DECIMAL(6,2),
  capacity_kwh   DECIMAL(6,2) NOT NULL,
  operation_mode VARCHAR(50),
  submercado           VARCHAR(10) NOT NULL DEFAULT 'SUDESTE'
      CHECK (submercado IN ('SUDESTE','SUL','NORDESTE','NORTE')),
  retail_buy_rate_kwh  NUMERIC(8,4) NOT NULL DEFAULT 0.80,
  retail_sell_rate_kwh NUMERIC(8,4) NOT NULL DEFAULT 0.25,
  is_active      BOOLEAN      NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_assets_org ON assets (org_id);

CREATE TABLE IF NOT EXISTS device_state (
  asset_id        VARCHAR(50)  PRIMARY KEY REFERENCES assets(asset_id) ON DELETE CASCADE,
  battery_soc     DECIMAL(5,2),
  bat_soh         DECIMAL(5,2),
  bat_work_status VARCHAR(20),
  battery_voltage DECIMAL(6,2),
  bat_cycle_count INTEGER,
  pv_power        DECIMAL(8,3),
  battery_power   DECIMAL(8,3),
  grid_power_kw   DECIMAL(8,3),
  load_power      DECIMAL(8,3),
  inverter_temp   DECIMAL(5,2),
  is_online       BOOLEAN      NOT NULL DEFAULT false,
  grid_frequency  DECIMAL(6,3),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS telemetry_history (
  id             BIGSERIAL,
  asset_id       VARCHAR(50)  NOT NULL,
  recorded_at    TIMESTAMPTZ  NOT NULL,
  battery_soc    DECIMAL(5,2),
  pv_power       DECIMAL(8,3),
  battery_power  DECIMAL(8,3),
  grid_power_kw  DECIMAL(8,3),
  load_power     DECIMAL(8,3),
  bat_work_status VARCHAR(20),
  grid_import_kwh DECIMAL(10,3),
  grid_export_kwh DECIMAL(10,3),
  PRIMARY KEY (id, recorded_at)
) PARTITION BY RANGE (recorded_at);

CREATE TABLE IF NOT EXISTS telemetry_history_2026_02
  PARTITION OF telemetry_history
  FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');

CREATE TABLE IF NOT EXISTS telemetry_history_2026_03
  PARTITION OF telemetry_history
  FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');

CREATE TABLE IF NOT EXISTS telemetry_history_default
  PARTITION OF telemetry_history DEFAULT;

CREATE INDEX IF NOT EXISTS idx_telemetry_asset_time
  ON telemetry_history (asset_id, recorded_at DESC);

-- ============================================================
-- Shared Contract Tables (v5.8)
-- ============================================================

CREATE TABLE IF NOT EXISTS asset_hourly_metrics (
  id              BIGSERIAL PRIMARY KEY,
  asset_id        VARCHAR(50) NOT NULL REFERENCES assets(asset_id),
  hour_timestamp  TIMESTAMPTZ NOT NULL,
  total_charge_kwh    NUMERIC(10,4) NOT NULL DEFAULT 0,
  total_discharge_kwh NUMERIC(10,4) NOT NULL DEFAULT 0,
  data_points_count   INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_asset_hourly UNIQUE (asset_id, hour_timestamp)
);
CREATE INDEX IF NOT EXISTS idx_asset_hourly_asset_hour ON asset_hourly_metrics (asset_id, hour_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_asset_hourly_hour ON asset_hourly_metrics (hour_timestamp DESC);

-- ============================================================
-- M4 Market & Billing
-- ============================================================

CREATE TABLE IF NOT EXISTS tariff_schedules (
  id             SERIAL       PRIMARY KEY,
  org_id         VARCHAR(50)  NOT NULL REFERENCES organizations(org_id),
  schedule_name  VARCHAR(100) NOT NULL,
  peak_start     TIME         NOT NULL,
  peak_end       TIME         NOT NULL,
  peak_rate      DECIMAL(8,4) NOT NULL,
  offpeak_rate   DECIMAL(8,4) NOT NULL,
  feed_in_rate   DECIMAL(8,4) NOT NULL,
  currency       VARCHAR(3)   NOT NULL DEFAULT 'BRL',
  effective_from DATE         NOT NULL,
  effective_to   DATE,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS weather_cache (
  id           SERIAL       PRIMARY KEY,
  location     VARCHAR(100) NOT NULL,
  recorded_at  TIMESTAMPTZ  NOT NULL,
  temperature  DECIMAL(5,2),
  irradiance   DECIMAL(8,2),
  cloud_cover  DECIMAL(5,2),
  source       VARCHAR(50),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (location, recorded_at)
);
CREATE INDEX IF NOT EXISTS idx_weather_location_time ON weather_cache (location, recorded_at DESC);

CREATE TABLE IF NOT EXISTS revenue_daily (
  id                  SERIAL       PRIMARY KEY,
  asset_id            VARCHAR(50)  NOT NULL REFERENCES assets(asset_id),
  date                DATE         NOT NULL,
  pv_energy_kwh       DECIMAL(10,3),
  grid_export_kwh     DECIMAL(10,3),
  grid_import_kwh     DECIMAL(10,3),
  bat_discharged_kwh  DECIMAL(10,3),
  revenue_reais       DECIMAL(12,2),
  cost_reais          DECIMAL(12,2),
  profit_reais        DECIMAL(12,2),
  vpp_arbitrage_profit_reais NUMERIC(12,2),
  client_savings_reais       NUMERIC(12,2),
  actual_self_consumption_pct NUMERIC(5,2),
  tariff_schedule_id  INTEGER      REFERENCES tariff_schedules(id),
  calculated_at       TIMESTAMPTZ,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (asset_id, date)
);
CREATE INDEX IF NOT EXISTS idx_revenue_asset_date ON revenue_daily (asset_id, date DESC);

CREATE TABLE IF NOT EXISTS trades (
  id             SERIAL       PRIMARY KEY,
  asset_id       VARCHAR(50)  NOT NULL REFERENCES assets(asset_id),
  traded_at      TIMESTAMPTZ  NOT NULL,
  trade_type     VARCHAR(20)  NOT NULL,
  energy_kwh     DECIMAL(10,3) NOT NULL,
  price_per_kwh  DECIMAL(8,4) NOT NULL,
  total_reais    DECIMAL(12,2) NOT NULL,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_trades_asset_time ON trades (asset_id, traded_at DESC);

CREATE TABLE IF NOT EXISTS pld_horario (
    mes_referencia INT NOT NULL,
    dia            SMALLINT NOT NULL,
    hora           SMALLINT NOT NULL,
    submercado     VARCHAR(10) NOT NULL,
    pld_hora       NUMERIC(10,2) NOT NULL,
    PRIMARY KEY (mes_referencia, dia, hora, submercado)
);

-- ============================================================
-- v5.5: M2 Optimization
-- ============================================================

CREATE TABLE IF NOT EXISTS trade_schedules (
    id                  SERIAL PRIMARY KEY,
    asset_id            VARCHAR(50) NOT NULL REFERENCES assets(asset_id),
    org_id              VARCHAR(50) NOT NULL,
    planned_time        TIMESTAMPTZ NOT NULL,
    action              VARCHAR(10) NOT NULL CHECK (action IN ('charge','discharge','idle')),
    expected_volume_kwh NUMERIC(8,2) NOT NULL,
    target_pld_price    NUMERIC(10,2),
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS algorithm_metrics (
    id                   SERIAL PRIMARY KEY,
    org_id               VARCHAR(50) NOT NULL,
    date                 DATE NOT NULL,
    self_consumption_pct NUMERIC(5,2),
    UNIQUE (org_id, date)
);

-- ============================================================
-- M3 DR Dispatcher
-- ============================================================

CREATE TABLE IF NOT EXISTS dispatch_records (
  id                  SERIAL       PRIMARY KEY,
  asset_id            VARCHAR(50)  NOT NULL REFERENCES assets(asset_id),
  dispatched_at       TIMESTAMPTZ  NOT NULL,
  dispatch_type       VARCHAR(50),
  commanded_power_kw  DECIMAL(8,3),
  actual_power_kw     DECIMAL(8,3),
  success             BOOLEAN,
  response_latency_ms INTEGER,
  error_message       TEXT,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dispatch_asset_time ON dispatch_records (asset_id, dispatched_at DESC);

CREATE TABLE IF NOT EXISTS dispatch_commands (
  id              SERIAL       PRIMARY KEY,
  asset_id        VARCHAR(50)  NOT NULL REFERENCES assets(asset_id),
  org_id          VARCHAR(50)  NOT NULL REFERENCES organizations(org_id),
  action          VARCHAR(20)  NOT NULL,
  status          VARCHAR(20)  NOT NULL DEFAULT 'scheduled',
  dispatched_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,
  error_message   TEXT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dispatch_commands_status ON dispatch_commands (status, dispatched_at);
CREATE INDEX IF NOT EXISTS idx_dispatch_commands_org ON dispatch_commands (org_id);

-- ============================================================
-- M8 Admin Control Plane
-- ============================================================

CREATE TABLE IF NOT EXISTS vpp_strategies (
  id                   SERIAL       PRIMARY KEY,
  org_id               VARCHAR(50)  NOT NULL REFERENCES organizations(org_id),
  strategy_name        VARCHAR(100) NOT NULL,
  target_mode          VARCHAR(50)  NOT NULL,
  min_soc              DECIMAL(5,2) NOT NULL DEFAULT 20,
  max_soc              DECIMAL(5,2) NOT NULL DEFAULT 95,
  charge_window_start  TIME,
  charge_window_end    TIME,
  discharge_window_start TIME,
  max_charge_rate_kw   DECIMAL(6,2),
  target_self_consumption_pct NUMERIC(5,2) DEFAULT 80.0,
  is_default           BOOLEAN      NOT NULL DEFAULT false,
  is_active            BOOLEAN      NOT NULL DEFAULT true,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS parser_rules (
  id              SERIAL       PRIMARY KEY,
  org_id          VARCHAR(50)  NOT NULL REFERENCES organizations(org_id),
  manufacturer    VARCHAR(100),
  model_version   VARCHAR(100),
  mapping_rule    JSONB        NOT NULL,
  unit_conversions JSONB,
  is_active       BOOLEAN      NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS data_dictionary (
  field_id      VARCHAR(100) PRIMARY KEY,
  domain        VARCHAR(20)  NOT NULL,
  display_name  VARCHAR(200) NOT NULL,
  value_type    VARCHAR(20)  NOT NULL,
  unit          VARCHAR(20),
  is_protected  BOOLEAN      NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- v5.10 FIX: feature_flags with correct UNIQUE INDEX (not table-level constraint)
CREATE TABLE IF NOT EXISTS feature_flags (
  id           SERIAL       PRIMARY KEY,
  flag_name    VARCHAR(100) NOT NULL,
  org_id       VARCHAR(50)  REFERENCES organizations(org_id),
  is_enabled   BOOLEAN      NOT NULL DEFAULT false,
  description  TEXT,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_feature_flags_name_org
  ON feature_flags (flag_name, COALESCE(org_id, ''));

-- ============================================================
-- RLS — Pure Tenant Isolation (v5.10)
-- ============================================================

ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_assets_tenant ON assets
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE trades ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_trades_tenant ON trades
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE revenue_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_revenue_daily_tenant ON revenue_daily
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE dispatch_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_dispatch_records_tenant ON dispatch_records
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE dispatch_commands ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_dispatch_commands_tenant ON dispatch_commands
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE tariff_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_tariff_schedules_tenant ON tariff_schedules
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE vpp_strategies ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_vpp_strategies_tenant ON vpp_strategies
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE parser_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_parser_rules_tenant ON parser_rules
  USING (org_id IS NULL OR org_id = current_setting('app.current_org_id', true));

ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_feature_flags_tenant ON feature_flags
  USING (org_id IS NULL OR org_id = current_setting('app.current_org_id', true));

ALTER TABLE trade_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_trade_schedules_tenant ON trade_schedules
  USING (org_id::TEXT = current_setting('app.current_org_id', true));

ALTER TABLE algorithm_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_algorithm_metrics_tenant ON algorithm_metrics
  USING (org_id::TEXT = current_setting('app.current_org_id', true));

COMMIT;
