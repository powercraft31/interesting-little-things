-- ==========================================================================
-- Module 4: Market & Billing — Multi-Tenant PostgreSQL Schema
--
-- Row-Level Security (RLS) enforces tenant isolation at the DB layer.
-- Every query MUST first:  SET LOCAL app.current_org_id = '<uuid>';
-- ==========================================================================

-- ── Extensions ──────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── 1. organizations ────────────────────────────────────────────────────────
CREATE TABLE organizations (
    org_id     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name       TEXT    NOT NULL,
    plan_tier  TEXT    NOT NULL DEFAULT 'standard',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;

-- SOLFACIL_ADMIN can see all orgs; regular users see only their own
CREATE POLICY admin_full_access ON organizations
    USING (current_setting('app.current_role', true) = 'SOLFACIL_ADMIN');

CREATE POLICY tenant_isolation ON organizations
    USING (org_id = current_setting('app.current_org_id', true)::uuid);

CREATE INDEX idx_organizations_name ON organizations (name);

-- ── 2. assets ───────────────────────────────────────────────────────────────
CREATE TABLE assets (
    asset_id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id        UUID NOT NULL REFERENCES organizations(org_id),
    device_type   TEXT NOT NULL,
    rated_power_kw NUMERIC(10,2) NOT NULL,
    location      TEXT,
    status        TEXT NOT NULL DEFAULT 'active',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON assets
    USING (org_id = current_setting('app.current_org_id', true)::uuid);

CREATE INDEX idx_assets_org_id ON assets (org_id);
CREATE INDEX idx_assets_status ON assets (status);

-- ── 3. tariff_schedules ─────────────────────────────────────────────────────
CREATE TABLE tariff_schedules (
    schedule_id    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id         UUID NOT NULL REFERENCES organizations(org_id),
    tariff_type    TEXT NOT NULL,  -- e.g. 'branca', 'convencional'
    peak_rate      NUMERIC(10,4) NOT NULL,
    off_peak_rate  NUMERIC(10,4) NOT NULL,
    mid_peak_rate  NUMERIC(10,4),
    currency       TEXT NOT NULL DEFAULT 'BRL',
    effective_from DATE NOT NULL,
    effective_to   DATE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE tariff_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE tariff_schedules FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON tariff_schedules
    USING (org_id = current_setting('app.current_org_id', true)::uuid);

CREATE INDEX idx_tariff_schedules_org_id ON tariff_schedules (org_id);
CREATE INDEX idx_tariff_schedules_effective_from ON tariff_schedules (effective_from DESC);
CREATE INDEX idx_tariff_schedules_org_effective ON tariff_schedules (org_id, effective_from DESC);

-- ── 4. JSONB metadata extension slots ─────────────────────────────────────
ALTER TABLE assets         ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE organizations  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

-- GIN indexes for JSONB queries
CREATE INDEX IF NOT EXISTS idx_assets_metadata        ON assets        USING GIN(metadata);
CREATE INDEX IF NOT EXISTS idx_organizations_metadata  ON organizations USING GIN(metadata);

-- ==========================================================================
-- v5.5 Additions: Two-Tier Economic Model
-- Applied via migration_v5.5.sql (2026-02-28)
-- ==========================================================================

-- ALTER revenue_daily: add dual-revenue columns
-- ALTER TABLE revenue_daily
--     ADD COLUMN IF NOT EXISTS arbitrage_profit_reais NUMERIC(14,2) DEFAULT 0,
--     ADD COLUMN IF NOT EXISTS savings_reais           NUMERIC(14,2) DEFAULT 0;

-- New table: pld_horario (CCEE hourly wholesale spot price)
-- CREATE TABLE IF NOT EXISTS pld_horario (
--     id              BIGSERIAL PRIMARY KEY,
--     reference_month INT         NOT NULL,  -- AAAAMM
--     dia             INT         NOT NULL,  -- 1-31
--     hora            INT         NOT NULL,  -- 0-23
--     submercado      TEXT        NOT NULL,  -- SUDESTE/SUL/NORDESTE/NORTE
--     pld_hora        NUMERIC(10, 2) NOT NULL,
--     created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
-- );

-- New table: trade_schedules (M2 optimization output for future dispatch)
-- CREATE TABLE IF NOT EXISTS trade_schedules (
--     id              BIGSERIAL PRIMARY KEY,
--     asset_id        VARCHAR(50)  NOT NULL,
--     org_id          VARCHAR(50)  NOT NULL,
--     scheduled_at    TIMESTAMPTZ  NOT NULL,
--     action          TEXT         NOT NULL,  -- charge/discharge/hold
--     power_kw        NUMERIC(10,2) NOT NULL,
--     expected_pld    NUMERIC(10,2),
--     status          TEXT         NOT NULL DEFAULT 'scheduled',
--     created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
-- );

-- New table: algorithm_metrics (M2 KPI output)
-- CREATE TABLE IF NOT EXISTS algorithm_metrics (
--     id                      BIGSERIAL PRIMARY KEY,
--     asset_id                VARCHAR(50) NOT NULL,
--     org_id                  VARCHAR(50) NOT NULL,
--     recorded_date           DATE        NOT NULL,
--     self_consumption_pct    NUMERIC(5,2),
--     target_self_consumption_pct NUMERIC(5,2),
--     created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
-- );
-- NOTE: These DDLs are commented out as reference only.
-- The actual migration was applied via backend/scripts/migration_v5.5.sql
-- DO NOT re-run these statements against the database.
