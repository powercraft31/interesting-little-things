-- ============================================================
-- SOLFACIL VPP — Base DDL (v5.19)
-- Updated: 2026-03-10 — homes merged into gateways, gateway_id = SN
-- 18 tables total. Run as superuser (postgres).
-- ============================================================

-- BEGIN;

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

-- v5.19: Gateway registry (homes merged in, gateway_id = SN)
CREATE TABLE IF NOT EXISTS gateways (
  gateway_id        VARCHAR(50)  PRIMARY KEY,           -- = hardware SN (e.g. WKRD24070202100144F)
  org_id            VARCHAR(50)  NOT NULL REFERENCES organizations(org_id),
  name              VARCHAR(200),                       -- v5.19: from homes.name (e.g. Casa Silva · Home-1)
  address           TEXT,                               -- v5.19: from homes.address
  contracted_demand_kw REAL,                            -- v5.19: from homes.contracted_demand_kw
  mqtt_broker_host  VARCHAR(255) NOT NULL DEFAULT '18.141.63.142',
  mqtt_broker_port  INTEGER      NOT NULL DEFAULT 1883,
  mqtt_username     VARCHAR(100) NOT NULL DEFAULT 'xuheng',
  mqtt_password     VARCHAR(255) NOT NULL DEFAULT 'xuheng8888!',
  device_name       VARCHAR(100) DEFAULT 'EMS_N2',
  product_key       VARCHAR(50)  DEFAULT 'ems',
  status            VARCHAR(20)  NOT NULL DEFAULT 'online'
                      CHECK (status IN ('online', 'offline', 'decommissioned')),
  last_seen_at      TIMESTAMPTZ,
  ems_health        JSONB        DEFAULT '{}',          -- v5.18: EMS health data
  ems_health_at     TIMESTAMPTZ,                        -- v5.18: device-side timestamp of last emsList
  commissioned_at   TIMESTAMPTZ  DEFAULT NOW(),
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gateways_org ON gateways(org_id);
CREATE INDEX IF NOT EXISTS idx_gateways_status ON gateways(status);

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
  asset_type     VARCHAR(30)  NOT NULL DEFAULT 'INVERTER_BATTERY'
      CHECK (asset_type IN ('INVERTER_BATTERY','SMART_METER','HVAC','EV_CHARGER','SOLAR_PANEL')),
  brand          VARCHAR(100),
  model          VARCHAR(100),
  serial_number  VARCHAR(100),
  commissioned_at TIMESTAMPTZ,
  is_active      BOOLEAN      NOT NULL DEFAULT true,
  allow_export   BOOLEAN      NOT NULL DEFAULT false,  -- v5.15: grid export permission
  gateway_id     VARCHAR(50)  REFERENCES gateways(gateway_id),  -- v5.18→v5.19: FK to gateway (SN)
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_assets_org ON assets (org_id);
CREATE INDEX IF NOT EXISTS idx_assets_type ON assets (asset_type);
CREATE INDEX IF NOT EXISTS idx_assets_gateway ON assets (gateway_id);

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
  telemetry_json  JSONB        DEFAULT '{}',
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
  do0_active      BOOLEAN,           -- v5.16: DO0 relay state
  do1_active      BOOLEAN,           -- v5.16: DO1 relay state
  -- v5.18: full protocol columns
  battery_soh         DECIMAL(5,2),
  battery_voltage     DECIMAL(6,2),
  battery_current     DECIMAL(8,3),
  battery_temperature DECIMAL(5,2),
  flload_power        DECIMAL(8,3),
  inverter_temp       DECIMAL(5,2),
  pv_daily_energy_kwh DECIMAL(10,3),
  max_charge_current    DECIMAL(8,3),
  max_discharge_current DECIMAL(8,3),
  daily_charge_kwh    DECIMAL(10,3),
  daily_discharge_kwh DECIMAL(10,3),
  telemetry_extra     JSONB,
  PRIMARY KEY (id, recorded_at)
) PARTITION BY RANGE (recorded_at);

CREATE TABLE IF NOT EXISTS telemetry_history_2026_02
  PARTITION OF telemetry_history
  FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');

CREATE TABLE IF NOT EXISTS telemetry_history_2026_03
  PARTITION OF telemetry_history
  FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');

CREATE TABLE IF NOT EXISTS telemetry_history_2026_04
  PARTITION OF telemetry_history
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');

CREATE TABLE IF NOT EXISTS telemetry_history_default
  PARTITION OF telemetry_history DEFAULT;

CREATE INDEX IF NOT EXISTS idx_telemetry_asset_time
  ON telemetry_history (asset_id, recorded_at DESC);

-- v5.18→v5.19: device command logs (config get/set tracking)
CREATE TABLE IF NOT EXISTS device_command_logs (
  id                BIGSERIAL    PRIMARY KEY,
  gateway_id        VARCHAR(50)  NOT NULL REFERENCES gateways(gateway_id),
  command_type      VARCHAR(20)  NOT NULL
                      CHECK (command_type IN ('get', 'get_reply', 'set', 'set_reply')),
  config_name       VARCHAR(100) NOT NULL DEFAULT 'battery_schedule',
  message_id        VARCHAR(50),
  payload_json      JSONB,
  result            VARCHAR(20),
  error_message     TEXT,
  device_timestamp  TIMESTAMPTZ,
  resolved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cmd_logs_gateway ON device_command_logs(gateway_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cmd_logs_message ON device_command_logs(gateway_id, message_id);
CREATE INDEX IF NOT EXISTS idx_cmd_logs_pending ON device_command_logs(result) WHERE result = 'pending';

-- ============================================================
-- v5.12: Offline Events
-- ============================================================

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

-- ============================================================
-- v5.12: Daily Uptime Snapshots
-- ============================================================

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

-- ============================================================
-- Shared Contract Tables (v5.8)
-- ============================================================

CREATE TABLE IF NOT EXISTS asset_hourly_metrics (
  id              BIGSERIAL PRIMARY KEY,
  asset_id        VARCHAR(50) NOT NULL REFERENCES assets(asset_id),
  hour_timestamp  TIMESTAMPTZ NOT NULL,
  total_charge_kwh      NUMERIC(10,4) NOT NULL DEFAULT 0,
  total_discharge_kwh   NUMERIC(10,4) NOT NULL DEFAULT 0,
  pv_generation_kwh     NUMERIC(10,4) NOT NULL DEFAULT 0,
  grid_import_kwh       NUMERIC(10,4) NOT NULL DEFAULT 0,
  grid_export_kwh       NUMERIC(10,4) NOT NULL DEFAULT 0,
  load_consumption_kwh  NUMERIC(10,4) NOT NULL DEFAULT 0,
  avg_battery_soc       NUMERIC(5,2),
  peak_battery_power_kw NUMERIC(8,3),
  data_points_count     INT NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
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
  intermediate_rate  DECIMAL(8,4),
  intermediate_start TIME,
  intermediate_end   TIME,
  demand_charge_rate_per_kva NUMERIC(8,4),  -- v5.16: R$/kVA monthly demand charge
  billing_power_factor       NUMERIC(3,2) DEFAULT 0.92,  -- v5.16: per ANEEL
  disco          VARCHAR(50),
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
  baseline_cost_reais  NUMERIC(10,2),
  actual_cost_reais    NUMERIC(10,2),
  best_tou_cost_reais  NUMERIC(10,2),
  self_sufficiency_pct NUMERIC(5,2),
  sc_savings_reais     NUMERIC(10,2),   -- v5.15: SC attribution
  tou_savings_reais    NUMERIC(10,2),   -- v5.15: TOU attribution
  ps_savings_reais         NUMERIC(10,2),   -- v5.16: PS daily savings
  ps_avoided_peak_kva      NUMERIC(8,3),    -- v5.16: avoided peak kVA
  do_shed_confidence       VARCHAR(10),      -- v5.16: high|low
  true_up_adjustment_reais NUMERIC(10,2),   -- v5.16: monthly true-up
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
    status              VARCHAR(20) NOT NULL DEFAULT 'scheduled',
    created_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_trade_schedules_status
  ON trade_schedules (status, planned_time);

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
  target_mode         VARCHAR(50),  -- v5.15: self_consumption | peak_valley_arbitrage | peak_shaving
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dispatch_asset_time ON dispatch_records (asset_id, dispatched_at DESC);

CREATE TABLE IF NOT EXISTS dispatch_commands (
  id              SERIAL       PRIMARY KEY,
  trade_id        INTEGER      REFERENCES trade_schedules(id),
  asset_id        VARCHAR(50)  NOT NULL REFERENCES assets(asset_id),
  org_id          VARCHAR(50)  NOT NULL REFERENCES organizations(org_id),
  action          VARCHAR(20)  NOT NULL,
  volume_kwh      NUMERIC(8,2),
  status          VARCHAR(20)  NOT NULL DEFAULT 'dispatched',
  m1_boundary     BOOLEAN      NOT NULL DEFAULT true,
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
-- RLS — Pure Tenant Isolation (v5.19)
-- ============================================================

ALTER TABLE gateways ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_gateways_tenant ON gateways
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_assets_tenant ON assets
  USING (org_id = current_setting('app.current_org_id', true));

-- trades and revenue_daily do NOT have org_id column; scoped via asset_id JOIN
-- RLS not applied to these tables

-- dispatch_records has no org_id column; RLS not applied

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

ALTER TABLE offline_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_offline_events_tenant ON offline_events
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE daily_uptime_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_uptime_tenant ON daily_uptime_snapshots
  USING (org_id = current_setting('app.current_org_id', true));

-- COMMIT;
