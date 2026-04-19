-- ============================================================
-- Storage Retention Hardening (v6.10.1) — Migration 003
-- Scope: additive archive-table foundation + helper retention indexes
-- Tables: device_command_logs_archive, gateway_alarm_events_archive
-- Indexes: archive readback + hot-table retention eligibility helpers
-- Idempotent: safe to re-run (CREATE TABLE/INDEX IF NOT EXISTS)
-- Additive: no destructive mutation of existing hot/business tables
-- Executor-safe: apply before enabling any archive/delete retention phases
-- ============================================================

-- ── 1. device_command_logs_archive ────────────────────────────
-- Preserve the hot-table source id as the archive primary key so the
-- executor can safely use: INSERT ... ON CONFLICT (id) DO NOTHING.

CREATE TABLE IF NOT EXISTS public.device_command_logs_archive (
  id                BIGINT       PRIMARY KEY,
  gateway_id        VARCHAR(50)  NOT NULL REFERENCES public.gateways(gateway_id),
  command_type      VARCHAR(20)  NOT NULL
                    CHECK (command_type IN ('get', 'get_reply', 'set', 'set_reply')),
  config_name       VARCHAR(100) NOT NULL,
  message_id        VARCHAR(50),
  payload_json      JSONB,
  result            VARCHAR(20),
  error_message     TEXT,
  device_timestamp  TIMESTAMPTZ,
  resolved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ  NOT NULL,
  dispatched_at     TIMESTAMPTZ,
  acked_at          TIMESTAMPTZ,
  archived_at       TIMESTAMPTZ  NOT NULL,
  archive_reason    TEXT         NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_device_command_logs_archive_archived_at
  ON public.device_command_logs_archive (archived_at DESC);

-- ── 2. gateway_alarm_events_archive ───────────────────────────
-- Preserve the hot-table source id as the archive primary key so the
-- executor can safely use: INSERT ... ON CONFLICT (id) DO NOTHING.

CREATE TABLE IF NOT EXISTS public.gateway_alarm_events_archive (
  id                 BIGINT       PRIMARY KEY,
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
  created_at         TIMESTAMPTZ  NOT NULL,
  archived_at        TIMESTAMPTZ  NOT NULL,
  archive_reason     TEXT         NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gateway_alarm_events_archive_archived_at
  ON public.gateway_alarm_events_archive (archived_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.device_command_logs_archive
  TO solfacil_app, solfacil_service;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gateway_alarm_events_archive
  TO solfacil_app, solfacil_service;

-- ── 3. helper hot-table indexes for retention executor scans ──

CREATE INDEX IF NOT EXISTS idx_runtime_issues_closed_at
  ON public.runtime_issues (closed_at ASC)
  WHERE state = 'closed' AND closed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_device_command_logs_retention_eligibility
  ON public.device_command_logs (created_at ASC, id ASC)
  WHERE result IN ('success', 'fail', 'timeout') OR resolved_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_gateway_alarm_events_retention_cutoff
  ON public.gateway_alarm_events (event_create_time ASC, id ASC);

CREATE INDEX IF NOT EXISTS idx_backfill_requests_terminal_cutoff
  ON public.backfill_requests ((COALESCE(completed_at, created_at)) ASC, id ASC)
  WHERE status IN ('completed', 'failed');
