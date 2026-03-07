-- ============================================================
-- migration_v5.16.sql — Peak Shaving Attribution
-- Date: 2026-03-07
-- ============================================================

-- 1. telemetry_history: DO state columns
ALTER TABLE telemetry_history
  ADD COLUMN IF NOT EXISTS do0_active BOOLEAN,
  ADD COLUMN IF NOT EXISTS do1_active BOOLEAN;

COMMENT ON COLUMN telemetry_history.do0_active IS
  'DO0 relay state: true = closed (load shed active). NULL when dido message not received.';
COMMENT ON COLUMN telemetry_history.do1_active IS
  'DO1 relay state: true = closed (load shed active). NULL when dido message not received.';

-- 2. tariff_schedules: demand charge config
ALTER TABLE tariff_schedules
  ADD COLUMN IF NOT EXISTS demand_charge_rate_per_kva NUMERIC(8,4),
  ADD COLUMN IF NOT EXISTS billing_power_factor        NUMERIC(3,2) DEFAULT 0.92;

COMMENT ON COLUMN tariff_schedules.demand_charge_rate_per_kva IS
  'Monthly demand charge rate in R$/kVA. Null = no demand charge billing.';
COMMENT ON COLUMN tariff_schedules.billing_power_factor IS
  'Commercial billing power factor per utility contract (default 0.92 per ANEEL).';

-- 3. revenue_daily: PS attribution columns
ALTER TABLE revenue_daily
  ADD COLUMN IF NOT EXISTS ps_savings_reais         NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS ps_avoided_peak_kva      NUMERIC(8,3),
  ADD COLUMN IF NOT EXISTS do_shed_confidence       VARCHAR(10),
  ADD COLUMN IF NOT EXISTS true_up_adjustment_reais NUMERIC(10,2);

COMMENT ON COLUMN revenue_daily.ps_savings_reais IS
  'Daily provisional PS savings (demand charge avoidance) in BRL.';
COMMENT ON COLUMN revenue_daily.ps_avoided_peak_kva IS
  'Daily avoided peak demand in kVA (counterfactual - contracted).';
COMMENT ON COLUMN revenue_daily.do_shed_confidence IS
  'high = full telemetry available; low = DO trigger detected but post-shed telemetry missing (backfill pending).';
COMMENT ON COLUMN revenue_daily.true_up_adjustment_reais IS
  'Monthly true-up adjustment. Written by MonthlyTrueUpJob on 1st of month. Never modifies past daily rows.';

-- 4. trade_schedules: add target_mode for PS dispatch chain
ALTER TABLE trade_schedules
  ADD COLUMN IF NOT EXISTS target_mode VARCHAR(50);
