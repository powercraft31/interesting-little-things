-- migration_v7.0.sql
-- Solfacil Protocol V2.4 — DB Schema v7.0
-- Prerequisite: solfacil-m1 stopped, operational data already truncated
-- Idempotent where possible (IF NOT EXISTS / IF EXISTS)

BEGIN;

-- Step 1: gateways column comments
COMMENT ON COLUMN public.gateways.status IS
  'Gateway connectivity status. V2.4: heartbeat interval 300s (5 min). Values: online | offline | decommissioned';
COMMENT ON COLUMN public.gateways.last_seen_at IS
  'Last heartbeat timestamp from gateway. V2.4: parsed from UTC-3 string via parseProtocolTimestamp() → UTC timestamptz';
COMMENT ON COLUMN public.gateways.ems_health IS
  'Latest emsList.properties JSONB snapshot. V2.4: all keys lowercase (cpu_temp, cpu_usage, disk_usage, etc.)';
COMMENT ON COLUMN public.gateways.ems_health_at IS
  'Timestamp of latest ems_health update. V2.4: parsed from UTC-3 string → UTC';

-- Step 2: device_command_logs column comments
COMMENT ON COLUMN public.device_command_logs.device_timestamp IS
  'Device-reported timestamp from config reply. V2.4: originally UTC-3 string, parsed and stored as UTC timestamptz';
COMMENT ON COLUMN public.device_command_logs.message_id IS
  'MQTT messageId from the reply. V2.4: messageId is per-message unique, set_reply does NOT echo original set request messageId';

-- Step 3: telemetry_history column comment (REVIEW-10 [SQL-02] fix: no reference to created_at)
COMMENT ON COLUMN public.telemetry_history.recorded_at IS
  'Device-reported timestamp parsed from protocol timeStamp field. V2.4: UTC-3 string → UTC. This reflects device clock time, not server ingestion time.';

-- Step 4: backfill_requests table and column comments
COMMENT ON TABLE public.backfill_requests IS
  'Tracks telemetry gap backfill requests per gateway. V2.4: gap_start/gap_end stored as UTC timestamptz; get_missed request uses UTC-3 string format';
COMMENT ON COLUMN public.backfill_requests.gap_start IS
  'Start of detected telemetry gap (UTC). V2.4: converted from UTC-3 device time to UTC for storage';
COMMENT ON COLUMN public.backfill_requests.gap_end IS
  'End of detected telemetry gap (UTC). V2.4: converted from UTC-3 device time to UTC for storage';
COMMENT ON COLUMN public.backfill_requests.current_chunk_start IS
  'Start of the current 30-min chunk being requested (UTC). Updated after each chunk response';

-- Step 5: Rebuild assets.asset_type CHECK to include ESS
ALTER TABLE public.assets DROP CONSTRAINT IF EXISTS assets_asset_type_check;
ALTER TABLE public.assets ADD CONSTRAINT assets_asset_type_check
  CHECK (asset_type IN ('INVERTER_BATTERY', 'SMART_METER', 'HVAC', 'EV_CHARGER', 'SOLAR_PANEL', 'ESS'));

-- Step 6: Create gateway_alarm_events table
CREATE TABLE IF NOT EXISTS public.gateway_alarm_events (
    id                 BIGSERIAL    PRIMARY KEY,
    gateway_id         VARCHAR(100) NOT NULL REFERENCES public.gateways(gateway_id),
    org_id             VARCHAR(50)  NOT NULL REFERENCES public.organizations(org_id),
    device_sn          VARCHAR(200),
    sub_dev_id         VARCHAR(200),
    sub_dev_name       VARCHAR(200),
    product_type       VARCHAR(50),
    event_id           VARCHAR(200) NOT NULL,
    event_name         VARCHAR(500),
    event_type         VARCHAR(50),
    level              VARCHAR(10),
    status             VARCHAR(10)  NOT NULL,
    prop_id            VARCHAR(200),
    prop_name          VARCHAR(500),
    prop_value         VARCHAR(200),
    description        TEXT,
    event_create_time  TIMESTAMPTZ  NOT NULL,
    event_update_time  TIMESTAMPTZ,
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Step 7: Indexes for gateway_alarm_events
CREATE INDEX IF NOT EXISTS idx_gae_gateway_event
  ON public.gateway_alarm_events (gateway_id, event_id);

CREATE INDEX IF NOT EXISTS idx_gae_org
  ON public.gateway_alarm_events (org_id);

CREATE INDEX IF NOT EXISTS idx_gae_status_active
  ON public.gateway_alarm_events (gateway_id, status) WHERE status = '0';

CREATE INDEX IF NOT EXISTS idx_gae_event_create_time
  ON public.gateway_alarm_events (gateway_id, event_create_time DESC);

-- Step 8: Enable RLS
ALTER TABLE public.gateway_alarm_events ENABLE ROW LEVEL SECURITY;

-- Step 9: Create tenant isolation policy
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy WHERE polname = 'rls_gae_tenant'
      AND polrelid = 'public.gateway_alarm_events'::regclass
  ) THEN
    EXECUTE 'CREATE POLICY rls_gae_tenant ON public.gateway_alarm_events
      USING ((org_id)::text = current_setting(''app.current_org_id''::text, true))';
  END IF;
END $$;

-- Step 10: Grant permissions
GRANT SELECT, INSERT, UPDATE ON public.gateway_alarm_events TO solfacil_app;
GRANT SELECT, INSERT, UPDATE ON public.gateway_alarm_events TO solfacil_service;
GRANT USAGE, SELECT ON SEQUENCE public.gateway_alarm_events_id_seq TO solfacil_app;
GRANT USAGE, SELECT ON SEQUENCE public.gateway_alarm_events_id_seq TO solfacil_service;

COMMIT;
