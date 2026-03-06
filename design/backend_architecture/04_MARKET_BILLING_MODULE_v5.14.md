# M4: Market & Billing Module — DP Optimal TOU & Formula Overhaul

> **模組版本**: v5.14
> **上層文件**: [00_MASTER_ARCHITECTURE_v5.14.md](./00_MASTER_ARCHITECTURE_v5.14.md)
> **最後更新**: 2026-03-06
> **說明**: Block 2 — Replace flawed savings/alpha formulas with baseline/actual/bestTou (DP) billing
> **核心主題**: Post-hoc Dynamic Programming optimal TOU cost + deterministic savings metrics

---

## Changes from v5.13

| Aspect | v5.13 | v5.14 |
|--------|-------|-------|
| Savings formula | `calculateDailySavings` (charge cost assumes all off-peak) | `calculateBaselineCost` + `calculateActualCost` (deterministic, source-agnostic) |
| Optimization metric | `calculateOptimizationAlpha` (theoretical max = 1 cycle/day × spread) | `calculateBestTouCost` (DP post-hoc optimal) |
| Self-sufficiency | Not tracked | `calculateSelfSufficiency` = (load - gridImport) / load |
| revenue_daily output | client_savings_reais, actual_self_consumption_pct | +baseline_cost_reais, +actual_cost_reais, +best_tou_cost_reais, +self_sufficiency_pct |
| DP parameters | N/A | Read from `assets` table: soc_min_pct, max_charge_rate_kw, max_discharge_rate_kw |
| hourly data used | charge, discharge, pv, grid_import, grid_export | +load_consumption_kwh (needed for baseline + DP) |

---

## v5.14 升版說明

### 問題陳述

v5.13's billing formulas have two structural defects identified during formula audit:

1. **`calculateDailySavings`:** Assumes all charging costs off-peak rate regardless of actual charging source. If battery charges from PV (free) during midday, the formula still subtracts `chargeKwh * offpeakRate`, understating savings.

2. **`calculateOptimizationAlpha`:** The "theoretical max" = `capacity * (peakRate - offpeakRate) * days` assumes exactly one full cycle per day at max spread. This is arbitrary — a battery might do 1.5 cycles, or PV might cover part of peak. The resulting percentage is misleading.

### 解決方案

Replace with three physically correct, self-consistent metrics:

- **Baseline Cost** = what the customer would pay with no PV and no battery (full grid dependence)
- **Actual Cost** = what the customer actually paid for grid imports
- **Best TOU Cost** = what a theoretically perfect battery controller would achieve (DP optimization)

From these, two clean percentages:
- `Actual Savings %` = (baseline - actual) / baseline × 100
- `Optimization Efficiency %` = (baseline - actual) / (baseline - bestTou) × 100

Plus a new KPI:
- `Self-Sufficiency %` = (load - gridImport) / load × 100

---

## 1. Current vs. v5.14 Billing Logic

### Current (v5.13)

```
daily-billing-job.ts
  |
  +-- Read: asset_hourly_metrics (charge + discharge + pv + grid)
  +-- Read: tariff_schedules (peak, offpeak, intermediate rates)
  +-- Read: assets (capacity_kwh)
  |
  +-- Calculate: calculateDailySavings (flawed: charge cost assumes off-peak)
  +-- Calculate: calculateSelfConsumption (kept: pv - export / pv)
  |
  +-- Write: revenue_daily
        +-- client_savings_reais = calculateDailySavings result
        +-- actual_self_consumption_pct = self-consumption %
```

### v5.14 (DP + Deterministic)

```
daily-billing-job.ts
  |
  +-- Read: asset_hourly_metrics (charge + discharge + pv + grid + load)
  +-- Read: tariff_schedules (peak, offpeak, intermediate rates)
  +-- Read: assets (capacity_kwh, soc_min_pct, max_charge_rate_kw, max_discharge_rate_kw)
  |
  +-- Calculate: calculateBaselineCost(hourlyLoads, schedule)
  +-- Calculate: calculateActualCost(hourlyGridImports, schedule)
  +-- Calculate: calculateBestTouCost(hourlyData, schedule, dpParams)
  +-- Calculate: calculateSelfConsumption (KEPT unchanged)
  +-- Calculate: calculateSelfSufficiency (NEW)
  |
  +-- Write: revenue_daily
        +-- baseline_cost_reais = baseline cost
        +-- actual_cost_reais = actual grid import cost
        +-- best_tou_cost_reais = DP optimal cost
        +-- self_sufficiency_pct = self-sufficiency %
        +-- actual_self_consumption_pct = self-consumption % (KEPT)
        +-- client_savings_reais = baseline - actual (REPLACED formula)
        +-- vpp_arbitrage_profit_reais = 0 (KEPT placeholder)
```

---

## 2. DP Algorithm Specification

### §2.1 Problem Definition

```
minimize: Sigma(h=0..23) max(0, battery_delta[h] - net[h]) * rate[h]

where: net[h] = pv[h] - load[h]

subject to:
  soc[0] = soc_initial              (actual telemetry value, FIXED)
  soc[h+1] = soc[h] + battery_delta[h]
  soc_min <= soc[h] <= capacity      (SoC lower bound constraint, e.g. 10%)
  -max_discharge_rate <= battery_delta[h] <= max_charge_rate
```

**Objective interpretation:** For each hour, the grid import is `max(0, battery_delta[h] - net[h])`. If `net[h]` is negative (load > PV), the battery must discharge to avoid grid import. The DP finds the battery schedule that minimizes total grid import cost across all 24 hours.

### §2.2 State Space

> ⚠️ **硬性約束（Gemini R1 防禦）**：SoC 離散化步長 **強制為電池容量的 5%**。狀態節點數 |S| **必須限制在 20 個以內**。禁止使用 0.1 kWh 或更細的步長，以防大容量電池（如 50 kWh）導致狀態爆炸。

| Dimension | Range | Size |
|-----------|-------|------|
| Time (h) | 0..23 | T = 24 |
| SoC level (s) | soc_min..capacity, step = **capacity × 5%** | **S ≤ 20**（例：10 kWh 電池，5% 下限 → step=0.5 kWh → S=19） |
| Action (battery_delta) | -max_discharge..+max_charge, step = same as SoC step | A ≤ 40（例：±5 kW inverter → ±10 steps） |

### §2.3 Complexity Analysis

- **Time:** O(T * S * A) = 24 * 20 * 40 = **19,200 operations**（最壞情況）
- **Memory:** Two arrays of size S (current + next DP table) = 2 * 20 * 8 bytes = **320 bytes**
- **Per-asset execution:** 微秒級。47 台設備總計 < 1 秒。**零 OOM 風險。**
- **Dependencies:** Pure TypeScript. No external libraries.

### §2.4 Algorithm Pseudocode

```
function calculateBestTouCost(params):
  step = capacity * 0.05    // 強制 5% 步長
  S = discretize SoC range [soc_min .. capacity] with step
  dp_current = array of size |S|, initialized to Infinity
  dp_current[index_of(soc_initial)] = 0   // start state: known initial SoC, zero cost

  for h = 0 to 23:
    dp_next = array of size |S|, initialized to Infinity
    rate = getRateForHour(h, schedule)
    net = pv[h] - load[h]

    for each soc_level s in S:
      if dp_current[s] == Infinity: skip

      for each valid battery_delta a:
        new_soc = s + a
        if new_soc < soc_min or new_soc > capacity: skip

        grid_import = max(0, a - net)       // positive = buy from grid
        hour_cost = grid_import * rate
        total = dp_current[s] + hour_cost

        if total < dp_next[index_of(new_soc)]:
          dp_next[index_of(new_soc)] = total

    dp_current = dp_next

  return { bestCost: min(dp_current), endSoc: soc_at_min(dp_current) }
```

### §2.5 Input Parameters

| Parameter | Source | Fallback |
|-----------|--------|----------|
| `hourlyData[h].loadKwh` | `asset_hourly_metrics.load_consumption_kwh` | Required |
| `hourlyData[h].pvKwh` | `asset_hourly_metrics.pv_generation_kwh` | 0 |
| `schedule` | `tariff_schedules` per org | TARIFA_BRANCA_DEFAULTS |
| `capacity` | `assets.capacity_kwh` | Required |
| `socInitial` | `asset_hourly_metrics.avg_battery_soc` at hour 0 | 50% of capacity |
| `socMinPct` | `assets.soc_min_pct` | 10 |
| `maxChargeRateKw` | `assets.max_charge_rate_kw` | capacity_kwh (1C rate) |
| `maxDischargeRateKw` | `assets.max_discharge_rate_kw` | capacity_kwh (1C rate) |

### §2.6 Validation

DP results verified against two hand-calculated scenarios (see `v5.14_FORMULA_OVERHAUL_PLAN.md` §4.3):
- Scenario 2 (3 kWp PV, SoC=4, min=1): best R$0.76, savings 92.3%
- Scenario 3 (2 kWp PV, SoC=4, min=1): best R$3.00, savings 69.7%

---

## 3. Enhanced daily-billing-job.ts

### §3.1 Main Query — Hour-Level Aggregation (v5.14)

```typescript
// Step 1: Fetch hour-level metrics — v5.14: add load_consumption_kwh + avg_battery_soc
const hourlyResult = await pool.query<{
  asset_id: string;
  org_id: string;
  capacity_kwh: string;
  soc_min_pct: string | null;
  max_charge_rate_kw: string | null;
  max_discharge_rate_kw: string | null;
  hour: number;
  total_charge_kwh: string;
  total_discharge_kwh: string;
  pv_generation_kwh: string;
  grid_import_kwh: string;
  grid_export_kwh: string;
  load_consumption_kwh: string;
  avg_battery_soc: string | null;
}>(
  `SELECT
     ahm.asset_id,
     a.org_id,
     a.capacity_kwh,
     a.soc_min_pct,
     a.max_charge_rate_kw,
     a.max_discharge_rate_kw,
     EXTRACT(HOUR FROM ahm.hour_timestamp AT TIME ZONE 'America/Sao_Paulo')::INT AS hour,
     ahm.total_charge_kwh,
     ahm.total_discharge_kwh,
     ahm.pv_generation_kwh,
     ahm.grid_import_kwh,
     ahm.grid_export_kwh,
     ahm.load_consumption_kwh,
     ahm.avg_battery_soc
   FROM asset_hourly_metrics ahm
   JOIN assets a ON a.asset_id = ahm.asset_id
   WHERE DATE(ahm.hour_timestamp AT TIME ZONE 'America/Sao_Paulo') = $1::date
   ORDER BY ahm.asset_id, ahm.hour_timestamp`,
  [dateStr],
);
```

### §3.2 Calculation Flow (per asset)

```typescript
import {
  calculateBaselineCost,
  calculateActualCost,
  calculateBestTouCost,
  calculateSelfConsumption,
  calculateSelfSufficiency,
  type TariffSchedule,
} from "../../shared/tarifa";

// Build hourly arrays for this asset
const hourlyLoads = entry.hours.map(h => ({ hour: h.hour, loadKwh: h.loadKwh }));
const hourlyGridImports = entry.hours.map(h => ({ hour: h.hour, gridImportKwh: h.gridImportKwh }));
const hourlyData = entry.hours.map(h => ({ hour: h.hour, loadKwh: h.loadKwh, pvKwh: h.pvKwh }));

const baselineCost = calculateBaselineCost(hourlyLoads, schedule);
const actualCost = calculateActualCost(hourlyGridImports, schedule);

const dpResult = calculateBestTouCost({
  hourlyData,
  schedule,
  capacity: entry.capacityKwh,
  socInitial: entry.initialSoc,
  socMinPct: entry.socMinPct,
  maxChargeRateKw: entry.maxChargeRateKw,
  maxDischargeRateKw: entry.maxDischargeRateKw,
});

const selfConsumption = calculateSelfConsumption(
  entry.totalPvKwh,
  entry.totalGridExportKwh,
);

const selfSufficiency = calculateSelfSufficiency(
  entry.totalLoadKwh,
  entry.totalGridImportKwh,
);

// client_savings_reais = baseline - actual (simple, correct)
const clientSavings = Math.round((baselineCost - actualCost) * 100) / 100;
```

### §3.3 UPSERT — revenue_daily (v5.14)

```sql
INSERT INTO revenue_daily
  (asset_id, date,
   vpp_arbitrage_profit_reais, client_savings_reais,
   revenue_reais, cost_reais, profit_reais,
   actual_self_consumption_pct,
   pv_energy_kwh, grid_export_kwh, grid_import_kwh, bat_discharged_kwh,
   baseline_cost_reais, actual_cost_reais, best_tou_cost_reais,
   self_sufficiency_pct,
   calculated_at)
VALUES ($1, $2, $3, $4, $4, 0, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
ON CONFLICT (asset_id, date) DO UPDATE SET
  vpp_arbitrage_profit_reais  = EXCLUDED.vpp_arbitrage_profit_reais,
  client_savings_reais        = EXCLUDED.client_savings_reais,
  revenue_reais               = EXCLUDED.revenue_reais,
  profit_reais                = EXCLUDED.profit_reais,
  actual_self_consumption_pct = EXCLUDED.actual_self_consumption_pct,
  pv_energy_kwh               = EXCLUDED.pv_energy_kwh,
  grid_export_kwh             = EXCLUDED.grid_export_kwh,
  grid_import_kwh             = EXCLUDED.grid_import_kwh,
  bat_discharged_kwh          = EXCLUDED.bat_discharged_kwh,
  baseline_cost_reais         = EXCLUDED.baseline_cost_reais,
  actual_cost_reais           = EXCLUDED.actual_cost_reais,
  best_tou_cost_reais         = EXCLUDED.best_tou_cost_reais,
  self_sufficiency_pct        = EXCLUDED.self_sufficiency_pct,
  calculated_at               = EXCLUDED.calculated_at
```

---

## 4. revenue_daily Column Usage After v5.14

| Column | Source | v5.13 Status | v5.14 Status |
|--------|--------|-------------|-------------|
| `vpp_arbitrage_profit_reais` | PLD x discharge | Placeholder | **Kept** (future-proofing) |
| `client_savings_reais` | Tarifa Branca formula | calculateDailySavings | **CHANGED** -> baseline - actual |
| `revenue_reais` | = client_savings | = client_savings | **Unchanged** |
| `profit_reais` | = client_savings | = client_savings | **Unchanged** |
| `actual_self_consumption_pct` | PV - export / PV | calculated | **Kept** |
| `baseline_cost_reais` | N/A | N/A | **NEW** -> Sigma load[h] * rate(h) |
| `actual_cost_reais` | N/A | N/A | **NEW** -> Sigma gridImport[h] * rate(h) |
| `best_tou_cost_reais` | N/A | N/A | **NEW** -> DP optimal cost |
| `self_sufficiency_pct` | N/A | N/A | **NEW** -> (load - gridImport) / load * 100 |
| `pv_energy_kwh` | Sigma pv_generation | populated | **Kept** |
| `grid_export_kwh` | Sigma grid_export | populated | **Kept** |
| `grid_import_kwh` | Sigma grid_import | populated | **Kept** |
| `bat_discharged_kwh` | Sigma discharge | populated | **Kept** |

---

## 5. Pool & Boundary Rules

| Rule | Enforcement |
|------|-------------|
| M4 reads `asset_hourly_metrics` only (never `telemetry_history`) | Code review + test assertion |
| M4 uses Service Pool (cross-tenant batch job) | `getServicePool()` at job startup |
| M4 reads `tariff_schedules` via Service Pool (no RLS needed for batch) | BYPASSRLS role |
| M4 reads `assets` for DP parameters (capacity, soc_min_pct, charge/discharge rates) | Service Pool |
| Pure functions from `shared/tarifa.ts` have no DB access | Type system — no Pool parameter |
| DP function is pure (no side effects, no I/O) | Input/output interfaces only |

---

## 6. What Stays Out of Scope

| Metric | Why Out of Scope | When |
|--------|-----------------|------|
| CCEE PLD wholesale arbitrage | Not regulated for distributed storage | v6.0+ (2028) |
| Demand charge savings (Peak Shaving) | Needs demand meter data integration | v6.0 |
| DR subsidy revenue | ANEEL DR framework not finalized | v6.0+ (2028) |
| Forward-looking DP optimization | Same DP algorithm, needs forecast inputs | v6.0 (forecast-engine) |
| ROI calculation | Needs `installation_cost_reais` populated | v6.0 |

---

## 7. 代碼變更清單

| 檔案 | 動作 | 說明 |
|------|------|------|
| `market-billing/services/daily-billing-job.ts` | **MODIFY** | Delete calculateDailySavings/calculateOptimizationAlpha usage; add calculateBaselineCost/calculateActualCost/calculateBestTouCost/calculateSelfSufficiency; write 4 new revenue_daily columns; read DP params from assets |
| `shared/tarifa.ts` | **dependency** | Formula overhaul — see [09_SHARED_LAYER_v5.14.md](./09_SHARED_LAYER_v5.14.md) |
| `market-billing/handlers/get-tariff-schedule.ts` | **unchanged** | Read-only tariff API |
| `market-billing/handlers/calculate-profit.ts` | **unchanged** | On-demand profit calculation |

---

## 8. 測試策略

| Test | Input | Expected Output |
|------|-------|-----------------|
| Baseline cost — flat load | 24h * 1 kWh load, default rates | Sigma rate(h) for each hour |
| Actual cost — zero grid import | All hours gridImport=0 | R$0.00 |
| Actual cost — full grid import | Same as baseline | = baseline_cost |
| DP bestTouCost — scenario 2 | 3kWp PV, SoC=4, min=1, 10kWh cap | R$0.76 |
| DP bestTouCost — scenario 3 | 2kWp PV, SoC=4, min=1, 10kWh cap | R$3.00 |
| DP bestTouCost — no battery (cap=0) | No battery | = baseline_cost |
| Self-sufficiency — no grid import | load=10, gridImport=0 | 100.0% |
| Self-sufficiency — full grid import | load=10, gridImport=10 | 0.0% |
| Self-sufficiency — zero load | load=0, gridImport=0 | 0% (safe division) |
| revenue_daily UPSERT — idempotent | Run billing twice for same date | Same values, no duplicates |
| revenue_daily — all 4 new columns populated | Standard billing run | baseline_cost > 0, actual_cost >= 0, best_tou_cost >= 0, self_sufficiency >= 0 |

---

## Document History

| Version | Date | Summary |
|---------|------|---------|
| v5.2 | 2026-02-27 | 初始版本：Lambda + DynamoDB billing |
| v5.5 | 2026-02-28 | 雙層經濟模型 — VPP arbitrage + client savings |
| v5.6 | 2026-02-28 | PLD hourly data import pipeline |
| v5.8 | 2026-03-02 | Data Contract — reads asset_hourly_metrics only |
| v5.11 | 2026-03-05 | Service Pool for daily billing batch job |
| v5.13 | 2026-03-05 | Block 2: Tarifa Branca C-side savings + Optimization Alpha + self-consumption |
| **v5.14** | **2026-03-06** | **Formula Overhaul: delete calculateDailySavings/calculateOptimizationAlpha; add calculateBaselineCost + calculateActualCost + calculateBestTouCost(DP) + calculateSelfSufficiency; DP algorithm O(T*S*A)=480K ops, 1.6KB memory, millisecond execution; revenue_daily +4 columns (baseline_cost, actual_cost, best_tou_cost, self_sufficiency_pct); DP params from assets table (soc_min_pct, max_charge_rate_kw, max_discharge_rate_kw)** |
