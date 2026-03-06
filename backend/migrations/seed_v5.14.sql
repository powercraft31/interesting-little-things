-- ============================================================
-- seed_v5.14.sql — DP parameters + battery state + billing output
-- Date: 2026-03-06
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. assets — DP Parameters
-- ────────────────────────────────────────────────────────────

UPDATE assets SET
  soc_min_pct = 10,
  max_charge_rate_kw = 5.0,
  max_discharge_rate_kw = 5.0,
  installation_cost_reais = 45000.00
WHERE asset_id = 'AST-001';

UPDATE assets SET
  soc_min_pct = 10,
  max_charge_rate_kw = 5.0,
  max_discharge_rate_kw = 5.0,
  installation_cost_reais = 45000.00
WHERE asset_id = 'AST-002';

UPDATE assets SET
  soc_min_pct = 5,
  max_charge_rate_kw = 3.0,
  max_discharge_rate_kw = 3.0,
  installation_cost_reais = 32000.00
WHERE asset_id = 'AST-003';

-- ────────────────────────────────────────────────────────────
-- 2. telemetry_history — Deep Battery Data
-- ────────────────────────────────────────────────────────────

UPDATE telemetry_history SET
  battery_soh = 98.5,
  battery_voltage = 51.2,
  battery_current = CASE
    WHEN battery_power > 0 THEN battery_power / 0.0512
    WHEN battery_power < 0 THEN battery_power / 0.0512
    ELSE 0
  END,
  battery_temperature = 25.0 + (RANDOM() * 8)
WHERE asset_id = 'AST-001'
  AND battery_soh IS NULL;

UPDATE telemetry_history SET
  battery_soh = 97.8,
  battery_voltage = 51.0,
  battery_current = CASE
    WHEN battery_power > 0 THEN battery_power / 0.0510
    WHEN battery_power < 0 THEN battery_power / 0.0510
    ELSE 0
  END,
  battery_temperature = 24.0 + (RANDOM() * 8)
WHERE asset_id = 'AST-002'
  AND battery_soh IS NULL;

UPDATE telemetry_history SET
  battery_soh = 95.2,
  battery_voltage = 50.8,
  battery_current = CASE
    WHEN battery_power > 0 THEN battery_power / 0.0508
    WHEN battery_power < 0 THEN battery_power / 0.0508
    ELSE 0
  END,
  battery_temperature = 26.0 + (RANDOM() * 10)
WHERE asset_id = 'AST-003'
  AND battery_soh IS NULL;

-- ────────────────────────────────────────────────────────────
-- 3. asset_hourly_metrics — Battery State Rollup
-- ────────────────────────────────────────────────────────────

UPDATE asset_hourly_metrics SET
  avg_battery_soh = 98.5,
  avg_battery_voltage = 51.2,
  avg_battery_temperature = 28.0
WHERE asset_id = 'AST-001'
  AND avg_battery_soh IS NULL;

UPDATE asset_hourly_metrics SET
  avg_battery_soh = 97.8,
  avg_battery_voltage = 51.0,
  avg_battery_temperature = 27.5
WHERE asset_id = 'AST-002'
  AND avg_battery_soh IS NULL;

UPDATE asset_hourly_metrics SET
  avg_battery_soh = 95.2,
  avg_battery_voltage = 50.8,
  avg_battery_temperature = 29.0
WHERE asset_id = 'AST-003'
  AND avg_battery_soh IS NULL;

-- ────────────────────────────────────────────────────────────
-- 4. revenue_daily — DP Billing Output
-- ────────────────────────────────────────────────────────────

UPDATE revenue_daily SET
  baseline_cost_reais = 5.89,
  actual_cost_reais = 2.50,
  best_tou_cost_reais = 1.15,
  self_sufficiency_pct = 24.8
WHERE asset_id = 'AST-001' AND date = '2026-03-04';

UPDATE revenue_daily SET
  baseline_cost_reais = 4.72,
  actual_cost_reais = 1.80,
  best_tou_cost_reais = 0.95,
  self_sufficiency_pct = 61.9
WHERE asset_id = 'AST-002' AND date = '2026-03-04';

UPDATE revenue_daily SET
  baseline_cost_reais = 3.45,
  actual_cost_reais = 2.10,
  best_tou_cost_reais = 1.50,
  self_sufficiency_pct = 39.1
WHERE asset_id = 'AST-003' AND date = '2026-03-04';
