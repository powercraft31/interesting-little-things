-- ==========================================================================
-- M8 Admin Control Plane Schema
-- Note: This schema is independent of M1-M7, does not modify any existing tables
-- ==========================================================================

-- ── 1. device_parser_rules ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS device_parser_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  manufacturer TEXT NOT NULL,
  model_version TEXT NOT NULL DEFAULT '*',
  mapping_rule JSONB NOT NULL DEFAULT '{}',
  unit_conversions JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT device_parser_rules_org_idx UNIQUE (org_id, manufacturer, model_version)
);

-- GIN index for JSONB queries
CREATE INDEX IF NOT EXISTS device_parser_rules_mapping_gin
  ON device_parser_rules USING GIN (mapping_rule);

CREATE INDEX IF NOT EXISTS device_parser_rules_org_id_idx
  ON device_parser_rules (org_id);

-- Row Level Security
ALTER TABLE device_parser_rules ENABLE ROW LEVEL SECURITY;

-- RLS Policy: ORG_MANAGER sees own org only, SOLFACIL_ADMIN sees all
CREATE POLICY device_parser_rules_org_isolation ON device_parser_rules
  USING (
    current_setting('app.current_org_id', TRUE) = 'SOLFACIL' OR
    org_id = current_setting('app.current_org_id', TRUE)
  );

-- ── 2. vpp_strategies ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vpp_strategies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  strategy_name TEXT NOT NULL,
  min_soc NUMERIC(5,2) NOT NULL,
  max_soc NUMERIC(5,2) NOT NULL,
  emergency_soc NUMERIC(5,2) NOT NULL,
  profit_margin NUMERIC(5,4) NOT NULL DEFAULT 0.15,
  active_hours JSONB NOT NULL DEFAULT '{"start": 0, "end": 23}',
  active_weekdays JSONB NOT NULL DEFAULT '[0,1,2,3,4,5,6]',
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- CHECK Constraints: core safety guards
  CONSTRAINT vpp_strategies_soc_order CHECK (min_soc < max_soc),
  CONSTRAINT vpp_strategies_emergency_below_min CHECK (emergency_soc < min_soc),
  CONSTRAINT vpp_strategies_min_soc_range CHECK (min_soc >= 10 AND min_soc <= 50),
  CONSTRAINT vpp_strategies_max_soc_range CHECK (max_soc >= 70 AND max_soc <= 100),
  CONSTRAINT vpp_strategies_emergency_range CHECK (emergency_soc >= 5 AND emergency_soc <= 20),
  CONSTRAINT vpp_strategies_profit_margin_range CHECK (profit_margin >= 0.01 AND profit_margin <= 0.5),
  CONSTRAINT vpp_strategies_org_default UNIQUE (org_id, is_default) DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX IF NOT EXISTS vpp_strategies_org_id_idx ON vpp_strategies (org_id);
CREATE INDEX IF NOT EXISTS vpp_strategies_active_hours_gin ON vpp_strategies USING GIN (active_hours);

ALTER TABLE vpp_strategies ENABLE ROW LEVEL SECURITY;

CREATE POLICY vpp_strategies_org_isolation ON vpp_strategies
  USING (
    current_setting('app.current_org_id', TRUE) = 'SOLFACIL' OR
    org_id = current_setting('app.current_org_id', TRUE)
  );
