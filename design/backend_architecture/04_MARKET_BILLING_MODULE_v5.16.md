# M4: Market & Billing Module -- Peak Shaving Savings Attribution

> **Module Version**: v5.16
> **Parent**: [00_MASTER_ARCHITECTURE_v5.15.md](./00_MASTER_ARCHITECTURE_v5.15.md)
> **Last Updated**: 2026-03-07
> **Description**: Two new functions: runDailyPsSavings (counterfactual kW reconstruction) + runMonthlyTrueUp (month-end rescan)
> **Core Theme**: Counterfactual demand reconstruction for PS savings attribution

---

## Changes from v5.15

| Aspect | v5.15 | v5.16 |
|--------|-------|-------|
| PS savings | Not computed | **NEW**: `runDailyPsSavings` counterfactual reconstruction |
| Monthly true-up | Not applicable | **NEW**: `runMonthlyTrueUp` month-end rescan |
| Data reads | asset_5min_metrics, dispatch_records, tariff_schedules | **+telemetry_history** (DO transition detection only) |
| revenue_daily output | sc_savings_reais, tou_savings_reais | **+ps_savings_reais, +ps_avoided_peak_kva, +do_shed_confidence, +true_up_adjustment_reais** |
| Cron schedule | Daily at 02:00 UTC | **+Monthly** 1st at 04:00 UTC |

---

## 1. Updated Billing Logic

### v5.16 Pipeline

```
daily-billing-job.ts (runs at 02:00 UTC)
  |
  +-- [EXISTING - unchanged] Baseline/Actual/BestTou calculations
  +-- [EXISTING - unchanged] SC/TOU attribution (v5.15)
  |
  +-- [NEW] runDailyPsSavings(pool, brtWindowStart, brtWindowEnd)
  |     +-- Read: asset_5min_metrics (PS-active windows)
  |     +-- Read: dispatch_records (target_mode = 'peak_shaving')
  |     +-- Read: telemetry_history (DO state transitions)
  |     +-- Read: tariff_schedules (demand_charge_rate, billing_power_factor)
  |     +-- Read: homes (contracted_demand_kw)
  |     +-- Calculate: counterfactual kW per 5-min window
  |     +-- Bin: date_bin into 15-min demand windows
  |     +-- Write: revenue_daily (ps_savings_reais, ps_avoided_peak_kva, do_shed_confidence)
  |
  +-- [NEW] runMonthlyTrueUp(pool, billingMonth)  -- 1st of month only
        +-- Rescan full month
        +-- INSERT true_up_adjustment_reais (NEW row, NEVER UPDATE)
```

---

## 2. `runDailyPsSavings` -- Full SQL Design

### File: `market-billing/services/daily-billing-job.ts`

```sql
-- Step 1: Rebuild 5-min counterfactual kW for PS-active windows
WITH ps_active_windows AS (
  SELECT
    m.asset_id,
    m.window_start,
    -- Counterfactual grid demand (kW, instantaneous equivalent)
    -- grid_import_kwh * 12 converts 5-min kWh back to avg kW
    (m.grid_import_kwh * 12) + (m.bat_discharge_kwh * 12) AS cf_grid_kw,
    -- DO0 load shed: difference in load before vs after DO0 trigger
    COALESCE(
      (SELECT th_before.load_power_kw - th_after.load_power_kw
       FROM telemetry_history th_before, telemetry_history th_after
       WHERE th_before.asset_id = m.asset_id
         AND th_before.recorded_at BETWEEN m.window_start - INTERVAL '2 min' AND m.window_start
         AND th_after.asset_id = m.asset_id
         AND th_after.recorded_at BETWEEN m.window_start AND m.window_start + INTERVAL '3 min'
         AND COALESCE(th_before.do0_active, false) = false
         AND COALESCE(th_after.do0_active, false) = true
       ORDER BY th_before.recorded_at DESC, th_after.recorded_at ASC
       LIMIT 1),
      0  -- fallback: 0 if no DO transition detected or telemetry missing
    ) AS do0_shed_kw,
    -- DO1 load shed: same logic for second relay
    COALESCE(
      (SELECT th_before.load_power_kw - th_after.load_power_kw
       FROM telemetry_history th_before, telemetry_history th_after
       WHERE th_before.asset_id = m.asset_id
         AND th_before.recorded_at BETWEEN m.window_start - INTERVAL '2 min' AND m.window_start
         AND th_after.asset_id = m.asset_id
         AND th_after.recorded_at BETWEEN m.window_start AND m.window_start + INTERVAL '3 min'
         AND COALESCE(th_before.do1_active, false) = false
         AND COALESCE(th_after.do1_active, false) = true
       ORDER BY th_before.recorded_at DESC, th_after.recorded_at ASC
       LIMIT 1),
      0
    ) AS do1_shed_kw
  FROM asset_5min_metrics m
  -- Only PS-active windows: most recent dispatch before this window is peak_shaving
  WHERE m.window_start >= $1 AND m.window_start < $2
    AND (
      SELECT COALESCE(dr.target_mode, 'UNASSIGNED')
      FROM dispatch_records dr
      WHERE dr.asset_id = m.asset_id
        AND dr.dispatched_at <= m.window_start
      ORDER BY dr.dispatched_at DESC LIMIT 1
    ) = 'peak_shaving'
),

-- Step 2: Bin into 15-min windows (BRT-aligned at 03:00 UTC)
demand_15min AS (
  SELECT
    asset_id,
    date_bin('15 minutes', window_start, TIMESTAMP '2026-01-01 03:00:00Z') AS window_15,
    AVG(cf_grid_kw + do0_shed_kw + do1_shed_kw) AS cf_kw_avg
  FROM ps_active_windows
  GROUP BY asset_id, window_15
),

-- Step 3: kW -> kVA, find daily max
peak_per_asset AS (
  SELECT
    d.asset_id,
    MAX(d.cf_kw_avg / COALESCE(ts.billing_power_factor, 0.92)) AS daily_peak_kva,
    CASE WHEN MAX(d.cf_kw_avg) > 0 THEN 'high' ELSE 'low' END AS confidence
  FROM demand_15min d
  JOIN assets a ON a.asset_id = d.asset_id
  JOIN homes h ON h.home_id = a.home_id
  JOIN tariff_schedules ts ON ts.org_id = a.org_id
    AND ts.is_active = true
  GROUP BY d.asset_id
),

-- Step 4: avoided_kva x rate = daily PS savings
daily_savings AS (
  SELECT
    p.asset_id,
    GREATEST(0, p.daily_peak_kva - h.contracted_demand_kw) AS avoided_kva,
    GREATEST(0, p.daily_peak_kva - h.contracted_demand_kw)
      * COALESCE(ts.demand_charge_rate_per_kva, 0)
      / DATE_PART('days',
          DATE_TRUNC('month', $1::timestamptz) + INTERVAL '1 month'
          - DATE_TRUNC('month', $1::timestamptz)
        ) AS daily_ps_savings,
    p.confidence
  FROM peak_per_asset p
  JOIN assets a ON a.asset_id = p.asset_id
  JOIN homes h ON h.home_id = a.home_id
  JOIN tariff_schedules ts ON ts.org_id = a.org_id AND ts.is_active = true
)
SELECT * FROM daily_savings
```

### UPSERT into revenue_daily

```sql
INSERT INTO revenue_daily
  (asset_id, date, ps_savings_reais, ps_avoided_peak_kva, do_shed_confidence, calculated_at)
VALUES ($1, $2, $3, $4, $5, NOW())
ON CONFLICT (asset_id, date) DO UPDATE SET
  ps_savings_reais    = EXCLUDED.ps_savings_reais,
  ps_avoided_peak_kva = EXCLUDED.ps_avoided_peak_kva,
  do_shed_confidence  = EXCLUDED.do_shed_confidence,
  calculated_at       = EXCLUDED.calculated_at
```

### Counterfactual kW Reconstruction Formula

```
counterfactual_kW =
    actual_grid_import_kW           -- what grid actually delivered
  + bat_discharge_kW                -- what battery covered (would've been grid without PS)
  + DO0_load_shed_kW                -- what DO0 cut (would've been demand without relay)
  + DO1_load_shed_kW                -- what DO1 cut (would've been demand without relay)
```

This reconstructs "what the site's grid demand would have been if PS mode and DO relays were not active."

### DO Load Shed Calculation

For each 5-min window where DO transitioned from 0->1:
1. Find the last `telemetry_history` record **before** the transition (up to 2 min before window start)
2. Find the first `telemetry_history` record **after** the transition (up to 3 min after window start)
3. `load_shed_kW = load_power_before - load_power_after`
4. If either record is missing: `load_shed_kW = 0` (conservative fallback)

### Daily Savings Formula

```
daily_peak_kva = MAX(counterfactual_kVA) across all 15-min windows today
avoided_kva = MAX(0, daily_peak_kva - contracted_demand_kw)
daily_ps_savings = avoided_kva * demand_charge_rate_per_kva / days_in_month
```

The division by `days_in_month` distributes the monthly demand charge proportionally. This is a **provisional** estimate -- the monthly true-up corrects for the fact that only the single highest 15-min window in the entire month determines the actual demand charge.

---

## 3. `runMonthlyTrueUp` -- Logic

### File: `market-billing/services/daily-billing-job.ts`

Runs on the 1st of each month (or manually triggered).

```
1. Determine billing_month = last complete month
2. Query full month's asset_5min_metrics for all PS-active windows
3. Reconstruct complete 15-min demand series (same CTE as daily, but full month range)
4. Find true monthly_peak_kva (highest 15-min window in the entire month)
5. Compute: avoided_kva = MAX(0, monthly_peak_kva - contracted_demand_kw)
6. Compute: true_ps_savings = avoided_kva * demand_charge_rate_per_kva
7. Compute: sum_of_daily_provisionals = SUM(ps_savings_reais) for last month
8. true_up = true_ps_savings - sum_of_daily_provisionals
9. INSERT INTO revenue_daily
     (asset_id, date = first_of_month, true_up_adjustment_reais = true_up)
   -- DO NOT UPDATE existing rows
```

### SQL for Monthly Rescan

```sql
-- Same ps_active_windows and demand_15min CTEs as daily,
-- but with full month range: $1 = month_start, $2 = month_end

-- Monthly peak per asset
SELECT
  d.asset_id,
  MAX(d.cf_kw_avg / COALESCE(ts.billing_power_factor, 0.92)) AS monthly_peak_kva
FROM demand_15min d
JOIN assets a ON a.asset_id = d.asset_id
JOIN tariff_schedules ts ON ts.org_id = a.org_id AND ts.is_active = true
GROUP BY d.asset_id
```

### True-up INSERT

```sql
-- HARD CONSTRAINT: INSERT new row, NEVER UPDATE historical daily rows
INSERT INTO revenue_daily
  (asset_id, date, true_up_adjustment_reais, calculated_at)
VALUES ($1, $first_of_month, $true_up_amount, NOW())
ON CONFLICT (asset_id, date) DO UPDATE SET
  true_up_adjustment_reais = EXCLUDED.true_up_adjustment_reais,
  calculated_at            = EXCLUDED.calculated_at
```

The true-up row uses `date = first_of_month` as its key. This is a separate row from the daily provisionals (which use `date = each_day`). If the true-up job runs multiple times, it overwrites its own row (idempotent) but never touches the 28-31 daily rows.

---

## 4. Cron Schedule

| Job | Schedule | Description |
|-----|----------|-------------|
| `runDailyPsSavings` | **Daily at 02:00 UTC** | Runs after SC/TOU attribution in existing daily billing cron |
| `runMonthlyTrueUp` | **1st of month at 04:00 UTC** | New cron entry, runs 2 hours after daily billing |

### Monthly True-up Cron

```typescript
// New cron entry in daily-billing-job.ts
cron.schedule("0 4 1 * *", () => runMonthlyTrueUp(pool));
```

### Execution Order (Daily)

```
02:00 UTC  daily-billing-job starts
  |-- 1. calculateBaselineCost / calculateActualCost / calculateBestTouCost (unchanged)
  |-- 2. SC/TOU attribution (v5.15, unchanged)
  |-- 3. runDailyPsSavings (v5.16 NEW)
  |-- 4. Write revenue_daily UPSERT
02:xx UTC  daily-billing-job completes
```

---

## 5. Pool & Boundary Rules

| Rule | Enforcement |
|------|-------------|
| M4 reads `asset_5min_metrics` for PS counterfactual | Code review + test |
| M4 reads `telemetry_history` for DO transitions **only** | Exception to v5.8 red line (scoped: DO state only, not energy data) |
| M4 reads `dispatch_records` for target_mode | Same as v5.15 |
| M4 reads `tariff_schedules` for demand_charge_rate, billing_power_factor | Code review + test |
| M4 reads `homes` for contracted_demand_kw | Code review + test |
| M4 uses Service Pool (cross-tenant batch job) | `getServicePool()` at job startup |
| **M4 NEVER writes to dispatch_records** | Code review |

### telemetry_history Access Exception

v5.8 established that M4 never reads `telemetry_history`. v5.16 adds a **scoped exception**: M4 reads `telemetry_history` only for DO state transitions (`do0_active`, `do1_active`) during PS savings calculation. This is necessary because DO state is not aggregated into `asset_5min_metrics` (it's a point-in-time relay state, not an energy flow).

The access is limited to:
- Columns read: `recorded_at`, `load_power_kw`, `do0_active`, `do1_active`
- Time range: same BRT day as the billing window
- Purpose: detect 0->1 transitions and compute load_shed_kW

---

## 6. What Stays Out of Scope

| Metric | Why Out of Scope | When |
|--------|-----------------|------|
| CCEE PLD wholesale arbitrage | Not regulated for distributed storage | v6.0+ |
| DR subsidy revenue | ANEEL DR framework not finalized | v6.0+ |
| Offline backfill rescan | Gateway backfill not implemented | v6.0 |
| Cross-hour TOU charge cost | TOU uses same-hour rate | v5.17+ |

---

## 7. Code Change List

| File | Action | Description |
|------|--------|-------------|
| `market-billing/services/daily-billing-job.ts` | **MODIFY** | Add: `runDailyPsSavings` function (counterfactual kW, date_bin 15-min, kVA conversion, daily savings); Add: `runMonthlyTrueUp` function (month rescan, true-up INSERT); Add: monthly cron `0 4 1 * *` |

---

## 8. Test Strategy

| Test | Input | Expected |
|------|-------|----------|
| PS savings basic | grid_import=5kWh, bat_discharge=3kWh, no DO, contracted=100kW, rate=10 R$/kVA | counterfactual_kW = (5+3)*12 = 96kW; kVA = 96/0.92 = 104.3; avoided = 4.3; savings = 4.3*10/30 |
| DO0 load shed | DO0 transitions 0->1, load_before=50kW, load_after=30kW | do0_shed_kw = 20 |
| Missing DO telemetry | DO0 transition but no after-record | do0_shed_kw = 0, confidence = 'low' |
| No PS dispatch | No peak_shaving dispatch_records for day | ps_savings = 0 |
| Monthly true-up | daily provisionals sum to 100, true monthly = 120 | true_up = 20 |
| True-up negative | daily provisionals sum to 150, true monthly = 120 | true_up = -30 |
| True-up idempotent | Run twice for same month | Same result, single true-up row |
| NULL demand_charge_rate | demand_charge_rate IS NULL | ps_savings = 0 (COALESCE to 0) |
| date_bin alignment | window_start at 03:00 UTC | Bins to BRT midnight 15-min boundary |
| NEVER UPDATE daily rows | True-up runs | No UPDATE on daily ps_savings rows; only INSERT/UPSERT on 1st-of-month row |

---

## Document History

| Version | Date | Summary |
|---------|------|---------|
| v5.2 | 2026-02-27 | Initial: Lambda + DynamoDB billing |
| v5.5 | 2026-02-28 | Dual-layer economic model |
| v5.6 | 2026-02-28 | PLD hourly data import pipeline |
| v5.8 | 2026-03-02 | Data Contract -- reads asset_hourly_metrics only |
| v5.11 | 2026-03-05 | Service Pool for daily billing batch job |
| v5.13 | 2026-03-05 | Tarifa Branca C-side savings + Optimization Alpha |
| v5.14 | 2026-03-06 | Formula Overhaul: DP optimal TOU + baseline/actual/bestTou |
| v5.15 | 2026-03-07 | SC/TOU Attribution from 5-min data + dispatch mode JOIN |
| **v5.16** | **2026-03-07** | **PS savings attribution: runDailyPsSavings (counterfactual kW = grid_import + bat_discharge + DO_shed; date_bin 15-min demand; kW->kVA; avoided_kva * rate / days_in_month); runMonthlyTrueUp (month rescan, INSERT true_up_adjustment_reais, NEVER UPDATE historical); telemetry_history scoped exception for DO transitions; monthly cron 0 4 1 * *; do_shed_confidence high/low** |
