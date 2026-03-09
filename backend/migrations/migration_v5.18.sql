-- ============================================================
-- migration_v5.18.sql — M1 IoT Hub: gateways, device_command_logs,
--                        assets.gateway_id, telemetry_history extensions
-- Date: 2026-03-09
-- Depends on: ddl_base.sql (v5.10), migration_v5.16.sql
-- ============================================================

-- ============================================================
-- 1. NEW TABLE: gateways (gateway registry for MQTT connections)
-- ============================================================

CREATE TABLE IF NOT EXISTS gateways (
  gateway_id        VARCHAR(50)  PRIMARY KEY,
  client_id         VARCHAR(100) NOT NULL UNIQUE,  -- MQTT clientId = device serial
  org_id            VARCHAR(50)  NOT NULL REFERENCES organizations(org_id),
  home_id           VARCHAR(50)  REFERENCES homes(home_id),
  mqtt_broker_host  VARCHAR(255) NOT NULL DEFAULT '18.141.63.142',
  mqtt_broker_port  INTEGER      NOT NULL DEFAULT 1883,
  mqtt_username     VARCHAR(100) NOT NULL DEFAULT 'xuheng',
  mqtt_password     VARCHAR(255) NOT NULL DEFAULT 'xuheng8888!',
  device_name       VARCHAR(100) DEFAULT 'EMS_N2',
  product_key       VARCHAR(50)  DEFAULT 'ems',
  status            VARCHAR(20)  NOT NULL DEFAULT 'online'
                      CHECK (status IN ('online', 'offline', 'decommissioned')),
  last_seen_at      TIMESTAMPTZ,
  commissioned_at   TIMESTAMPTZ  DEFAULT NOW(),
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gateways_org ON gateways(org_id);
CREATE INDEX IF NOT EXISTS idx_gateways_home ON gateways(home_id);
CREATE INDEX IF NOT EXISTS idx_gateways_status ON gateways(status);

-- RLS: tenant isolation (idempotent — guarded against re-run)
ALTER TABLE gateways ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY rls_gateways_tenant ON gateways
    USING (org_id = current_setting('app.current_org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- 2. NEW TABLE: device_command_logs (config get/set tracking)
-- ============================================================

CREATE TABLE IF NOT EXISTS device_command_logs (
  id                BIGSERIAL    PRIMARY KEY,
  gateway_id        VARCHAR(50)  NOT NULL REFERENCES gateways(gateway_id),
  client_id         VARCHAR(100) NOT NULL,
  command_type      VARCHAR(20)  NOT NULL
                      CHECK (command_type IN ('get', 'get_reply', 'set', 'set_reply')),
  config_name       VARCHAR(100) NOT NULL DEFAULT 'battery_schedule',
  message_id        VARCHAR(50),
  payload_json      JSONB,
  result            VARCHAR(20),       -- 'success' | 'fail' | 'pending' | 'timeout'
  error_message     TEXT,
  device_timestamp  TIMESTAMPTZ,       -- parsed from payload.timeStamp
  resolved_at       TIMESTAMPTZ,       -- when reply received
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cmd_logs_gateway ON device_command_logs(gateway_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cmd_logs_message ON device_command_logs(gateway_id, message_id);
CREATE INDEX IF NOT EXISTS idx_cmd_logs_pending ON device_command_logs(result) WHERE result = 'pending';

-- Note: device_command_logs has no direct org_id column. Tenant isolation is
-- enforced at the application layer via gateway_id lookup (same pattern as
-- trades and dispatch_records). No RLS policy applied.

-- ============================================================
-- 3. assets: add gateway_id FK
-- ============================================================

ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS gateway_id VARCHAR(50) REFERENCES gateways(gateway_id);

CREATE INDEX IF NOT EXISTS idx_assets_gateway ON assets(gateway_id);

-- ============================================================
-- 4. telemetry_history: add columns for full protocol support
-- ============================================================

-- JSONB column for full protocol data (meter/grid/pv/load/flload per-phase detail)
ALTER TABLE telemetry_history
  ADD COLUMN IF NOT EXISTS telemetry_extra JSONB;

-- Dedicated columns for hot-path queries (used by dashboard / M2 / M3 / M4)
ALTER TABLE telemetry_history
  ADD COLUMN IF NOT EXISTS battery_soh DECIMAL(5,2);

ALTER TABLE telemetry_history
  ADD COLUMN IF NOT EXISTS battery_voltage DECIMAL(6,2);

ALTER TABLE telemetry_history
  ADD COLUMN IF NOT EXISTS battery_current DECIMAL(8,3);

ALTER TABLE telemetry_history
  ADD COLUMN IF NOT EXISTS battery_temperature DECIMAL(5,2);

ALTER TABLE telemetry_history
  ADD COLUMN IF NOT EXISTS flload_power DECIMAL(8,3);

ALTER TABLE telemetry_history
  ADD COLUMN IF NOT EXISTS inverter_temp DECIMAL(5,2);

ALTER TABLE telemetry_history
  ADD COLUMN IF NOT EXISTS pv_daily_energy_kwh DECIMAL(10,3);

-- BMS limits (used by ScheduleTranslator validation)
ALTER TABLE telemetry_history
  ADD COLUMN IF NOT EXISTS max_charge_current DECIMAL(8,3);

ALTER TABLE telemetry_history
  ADD COLUMN IF NOT EXISTS max_discharge_current DECIMAL(8,3);

-- Daily energy accumulators
ALTER TABLE telemetry_history
  ADD COLUMN IF NOT EXISTS daily_charge_kwh DECIMAL(10,3);

ALTER TABLE telemetry_history
  ADD COLUMN IF NOT EXISTS daily_discharge_kwh DECIMAL(10,3);

-- ============================================================
-- 5. telemetry_history: partition for 2026-04
-- ============================================================

CREATE TABLE IF NOT EXISTS telemetry_history_2026_04
  PARTITION OF telemetry_history
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');

-- ============================================================
-- 6. COMMENTs for documentation
-- ============================================================

COMMENT ON TABLE gateways IS
  'M1 IoT Hub: EMS gateway registry. Each row = one MQTT connection to broker.';
COMMENT ON COLUMN gateways.client_id IS
  'MQTT clientId = device serial number (e.g. WKRD24070202100144F).';
COMMENT ON COLUMN gateways.status IS
  'online = heartbeat within 90s, offline = missed 3 heartbeats, decommissioned = removed.';

COMMENT ON TABLE device_command_logs IS
  'M1 IoT Hub: tracks config get/set commands and their async replies.';
COMMENT ON COLUMN device_command_logs.command_type IS
  'get = request sent, get_reply = response received, set = config pushed, set_reply = ack received.';
COMMENT ON COLUMN device_command_logs.device_timestamp IS
  'Parsed from payload.timeStamp (epoch ms). Device clock, not server clock.';

COMMENT ON COLUMN telemetry_history.telemetry_extra IS
  'JSONB: per-phase detail from meter/grid/pv/load/flload Lists. Queried for diagnostics only.';
COMMENT ON COLUMN telemetry_history.flload_power IS
  'Home total load power (W). From flloadList.flload_totalPower.';
COMMENT ON COLUMN telemetry_history.max_charge_current IS
  'BMS max charge current (A). Used by ScheduleTranslator validation.';
COMMENT ON COLUMN telemetry_history.max_discharge_current IS
  'BMS max discharge current (A). Used by ScheduleTranslator validation.';
