-- ============================================================
-- P5 Strategy Triggers — Migration 001
-- Tables: strategy_intents, posture_overrides
-- Idempotent: safe to re-run (CREATE TABLE IF NOT EXISTS)
-- ============================================================

-- ── 1. strategy_intents ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS strategy_intents (
  id                 BIGSERIAL    PRIMARY KEY,
  org_id             VARCHAR(50)  NOT NULL REFERENCES organizations(org_id),
  family             VARCHAR(50)  NOT NULL
                       CHECK (family IN (
                         'peak_shaving','tariff_arbitrage','reserve_protection',
                         'curtailment_mitigation','resilience_preparation','external_dr'
                       )),
  status             VARCHAR(30)  NOT NULL
                       CHECK (status IN (
                         'active','approved','deferred','suppressed',
                         'escalated','expired','executed'
                       )),
  governance_mode    VARCHAR(30)  NOT NULL
                       CHECK (governance_mode IN (
                         'observe','approval_required','auto_governed','escalate'
                       )),
  urgency            VARCHAR(20)  NOT NULL
                       CHECK (urgency IN ('immediate','soon','watch')),
  title              TEXT         NOT NULL,
  reason_summary     TEXT         NOT NULL,
  evidence_snapshot  JSONB        NOT NULL,
  scope_gateway_ids  JSONB        DEFAULT '[]',
  scope_summary      TEXT,
  constraints        JSONB,
  suggested_playbook TEXT,
  handoff_snapshot   JSONB,
  arbitration_note   TEXT,
  actor              VARCHAR(100),
  decided_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  expires_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_strategy_intents_org
  ON strategy_intents(org_id);

CREATE INDEX IF NOT EXISTS idx_strategy_intents_status
  ON strategy_intents(status);

-- ── 2. posture_overrides ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS posture_overrides (
  id                 BIGSERIAL    PRIMARY KEY,
  org_id             VARCHAR(50)  NOT NULL REFERENCES organizations(org_id),
  override_type      VARCHAR(50)  NOT NULL
                       CHECK (override_type IN (
                         'force_protective','suppress_economic',
                         'force_approval_gate','manual_escalation_note'
                       )),
  reason             TEXT         NOT NULL,
  scope_gateway_ids  JSONB        DEFAULT '[]',
  actor              VARCHAR(100) NOT NULL,
  active             BOOLEAN      NOT NULL DEFAULT true,
  starts_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  expires_at         TIMESTAMPTZ  NOT NULL,
  cancelled_at       TIMESTAMPTZ,
  cancelled_by       VARCHAR(100),
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_posture_overrides_org_active
  ON posture_overrides(org_id, active);

-- ── 3. Row Level Security ───────────────────────────────────────────────

ALTER TABLE strategy_intents ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'strategy_intents' AND policyname = 'strategy_intents_org_isolation'
  ) THEN
    CREATE POLICY strategy_intents_org_isolation ON strategy_intents
      USING (
        current_setting('app.current_org_id', TRUE) = 'SOLFACIL' OR
        org_id = current_setting('app.current_org_id', TRUE)
      );
  END IF;
END
$$;

ALTER TABLE posture_overrides ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'posture_overrides' AND policyname = 'posture_overrides_org_isolation'
  ) THEN
    CREATE POLICY posture_overrides_org_isolation ON posture_overrides
      USING (
        current_setting('app.current_org_id', TRUE) = 'SOLFACIL' OR
        org_id = current_setting('app.current_org_id', TRUE)
      );
  END IF;
END
$$;
