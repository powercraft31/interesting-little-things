# M4: Market & Billing Module -- SC/TOU Attribution from 5-min Data

> **Module Version**: v5.15
> **Parent**: [00_MASTER_ARCHITECTURE_v5.15.md](./00_MASTER_ARCHITECTURE_v5.15.md)
> **Last Updated**: 2026-03-07
> **Description**: Daily billing job gains SC/TOU attribution via 5-min metrics + dispatch_records JOIN
> **Core Theme**: Replace fake savings split with physically attributed SC and TOU savings

---

## Changes from v5.14

| Aspect | v5.14 | v5.15 |
|--------|-------|-------|
| Billing data source | `asset_hourly_metrics` only | **+`asset_5min_metrics`** (for SC/TOU attribution) |
| SC/TOU attribution | Not computed (fake in BFF) | **Real**: JOIN 5-min + dispatch_records by time window |
| dispatch_records usage | Not used by M4 | **Used**: JOIN for target_mode per 5-min slot |
| revenue_daily output | baseline/actual/bestTou/selfSufficiency | **+sc_savings_reais, +tou_savings_reais** |
| allow_export | Not read | **Boundary note**: M3 enforces, M4 reads for reporting |
| Hourly data accuracy | 3x inflated (upstream bug) | **Correct** (upstream factor fixed in M1) |

---

## 1. Updated Billing Logic

### Current (v5.14)

```
daily-billing-job.ts (runs at 02:00)
  |
  +-- Read: asset_hourly_metrics (24h, per asset)
  +-- Read: tariff_schedules (peak, offpeak, intermediate)
  +-- Read: assets (capacity, DP params)
  |
  +-- Calculate: calculateBaselineCost, calculateActualCost
  +-- Calculate: calculateBestTouCost (DP)
  +-- Calculate: calculateSelfConsumption, calculateSelfSufficiency
  |
  +-- Write: revenue_daily (baseline, actual, bestTou, selfSufficiency, savings)
```

### v5.15 (SC/TOU Attribution Added)

```
daily-billing-job.ts (runs at 02:00)
  |
  +-- Read: asset_hourly_metrics (24h, per asset)    -- baseline/actual/bestTou (unchanged)
  +-- Read: asset_5min_metrics (288 windows, per asset) -- SC/TOU attribution (NEW)
  +-- Read: dispatch_records (yesterday, per asset)     -- target_mode JOIN (NEW)
  +-- Read: tariff_schedules (peak, offpeak, intermediate)
  +-- Read: assets (capacity, DP params)
  |
  +-- Calculate: calculateBaselineCost, calculateActualCost       (unchanged)
  +-- Calculate: calculateBestTouCost (DP)                        (unchanged)
  +-- Calculate: calculateSelfConsumption, calculateSelfSufficiency (unchanged)
  +-- Calculate: SC savings per 5-min window (NEW)
  +-- Calculate: TOU savings per 5-min window (NEW)
  |
  +-- Write: revenue_daily
        +-- baseline_cost_reais, actual_cost_reais, best_tou_cost_reais (unchanged)
        +-- self_sufficiency_pct, actual_self_consumption_pct (unchanged)
        +-- client_savings_reais = baseline - actual (unchanged)
        +-- sc_savings_reais = SUM(sc contributions)     (NEW)
        +-- tou_savings_reais = SUM(tou contributions)   (NEW)
```

---

## 2. SC/TOU Attribution Algorithm

### S2.1 Step 1: Fetch 5-min Metrics

```typescript
// Fetch all 5-min windows for yesterday, per asset
const fiveMinResult = await pool.query<{
  asset_id: string;
  recorded_at: string;
  pv_energy_kwh: string;
  load_kwh: string;
  grid_import_kwh: string;
  grid_export_kwh: string;
  bat_charge_kwh: string;
  bat_discharge_kwh: string;
}>(
  `SELECT asset_id, recorded_at,
          pv_energy_kwh, load_kwh, grid_import_kwh, grid_export_kwh,
          bat_charge_kwh, bat_discharge_kwh
   FROM asset_5min_metrics
   WHERE recorded_at >= $1::timestamptz
     AND recorded_at < $2::timestamptz
   ORDER BY asset_id, recorded_at`,
  [dayStart, dayEnd],
);
```

### S2.2 Step 2: JOIN dispatch_records for target_mode

For each 5-min window, find the applicable dispatch mode:

```typescript
// Fetch dispatch records for yesterday, per asset
const dispatchResult = await pool.query<{
  asset_id: string;
  dispatched_at: string;
  completed_at: string | null;
  target_mode: string;
}>(
  `SELECT asset_id, dispatched_at, completed_at, target_mode
   FROM dispatch_records
   WHERE dispatched_at >= $1::timestamptz
     AND dispatched_at < $2::timestamptz
     AND target_mode IS NOT NULL
   ORDER BY asset_id, dispatched_at`,
  [dayStart, dayEnd],
);
```

**Mode resolution for a 5-min window:**
1. Find dispatch_records where `dispatched_at <= window_start AND (completed_at IS NULL OR completed_at >= window_end)`
2. If multiple records overlap, use the one with the most recent `dispatched_at`
3. If no dispatch_records found for this window, **default to 'self_consumption'** (battery idle or no active dispatch = SC mode by convention)

```typescript
function resolveMode(
  windowStart: Date,
  dispatches: DispatchRecord[],
): string {
  // Find the most recent dispatch that covers this window
  for (let i = dispatches.length - 1; i >= 0; i--) {
    const d = dispatches[i];
    if (d.dispatchedAt <= windowStart &&
        (d.completedAt === null || d.completedAt >= windowStart)) {
      return d.targetMode;
    }
  }
  return 'self_consumption'; // default: SC mode when no active dispatch
}
```

### S2.3 Step 3: Accumulate SC and TOU Savings

```typescript
import { getRateForHour, type TariffSchedule } from "../../shared/tarifa";

interface Attribution {
  scSavings: number;
  touSavings: number;
}

function attributeWindow(
  window: FiveMinWindow,
  mode: string,
  schedule: TariffSchedule,
): Attribution {
  const hour = new Date(window.recordedAt).getHours();
  const rate = getRateForHour(hour, schedule);

  if (mode === 'self_consumption') {
    // SC: value of PV energy consumed locally (not exported)
    const scContribution = (window.pvEnergyKwh - window.gridExportKwh) * rate;
    return { scSavings: Math.max(0, scContribution), touSavings: 0 };
  }

  if (mode === 'peak_valley_arbitrage') {
    // TOU: value of discharge minus cost of grid-charged portion
    const pvSurplus = Math.max(0, window.pvEnergyKwh - window.loadKwh);
    const batChargeFromGrid = Math.max(0, window.batChargeKwh - pvSurplus);
    const touContribution = window.batDischargeKwh * rate - batChargeFromGrid * rate;
    return { scSavings: 0, touSavings: touContribution };
  }

  // 'peak_shaving' or unknown: no attribution in v5.15
  return { scSavings: 0, touSavings: 0 };
}

// Accumulate across all 288 windows per asset
let totalSc = 0;
let totalTou = 0;
for (const window of assetWindows) {
  const mode = resolveMode(window.recordedAt, assetDispatches);
  const attr = attributeWindow(window, mode, schedule);
  totalSc += attr.scSavings;
  totalTou += attr.touSavings;
}

const scSavingsReais = Math.round(totalSc * 100) / 100;
const touSavingsReais = Math.round(totalTou * 100) / 100;
```

### S2.4 Step 4: Write to revenue_daily

```sql
-- v5.15: Enhanced UPSERT with SC/TOU attribution columns
INSERT INTO revenue_daily
  (asset_id, date,
   vpp_arbitrage_profit_reais, client_savings_reais,
   revenue_reais, cost_reais, profit_reais,
   actual_self_consumption_pct,
   pv_energy_kwh, grid_export_kwh, grid_import_kwh, bat_discharged_kwh,
   baseline_cost_reais, actual_cost_reais, best_tou_cost_reais,
   self_sufficiency_pct,
   sc_savings_reais, tou_savings_reais,
   calculated_at)
VALUES ($1, $2, $3, $4, $4, 0, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())
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
  sc_savings_reais            = EXCLUDED.sc_savings_reais,
  tou_savings_reais           = EXCLUDED.tou_savings_reais,
  calculated_at               = EXCLUDED.calculated_at
```

---

## 3. revenue_daily Column Usage After v5.15

| Column | Source | v5.14 Status | v5.15 Status |
|--------|--------|-------------|-------------|
| `vpp_arbitrage_profit_reais` | PLD x discharge | Placeholder | **Kept** |
| `client_savings_reais` | baseline - actual | v5.14 formula | **Kept** (unchanged) |
| `revenue_reais` | = client_savings | = client_savings | **Kept** |
| `profit_reais` | = client_savings | = client_savings | **Kept** |
| `actual_self_consumption_pct` | PV - export / PV | calculated | **Kept** |
| `baseline_cost_reais` | Sigma load * rate | v5.14 | **Kept** |
| `actual_cost_reais` | Sigma gridImport * rate | v5.14 | **Kept** |
| `best_tou_cost_reais` | DP optimal | v5.14 | **Kept** |
| `self_sufficiency_pct` | (load - gridImport) / load | v5.14 | **Kept** |
| `pv_energy_kwh` | Sum pv | populated | **Kept** |
| `grid_export_kwh` | Sum export | populated | **Kept** |
| `grid_import_kwh` | Sum import | populated | **Kept** |
| `bat_discharged_kwh` | Sum discharge | populated | **Kept** |
| **`sc_savings_reais`** | **SUM(sc_contribution) by mode** | **N/A** | **NEW** |
| **`tou_savings_reais`** | **SUM(tou_contribution) by mode** | **N/A** | **NEW** |

---

## 4. allow_export Constraint (Boundary Note)

M4 does NOT enforce `allow_export` -- that is M3's responsibility at dispatch time. However, M4 **reads** `allow_export` for reporting purposes:

- If `allow_export = false` and grid_export > 0 in telemetry, this indicates a dispatch constraint violation (M3 bug or EMS firmware issue)
- M4 logs a warning but does not alter billing calculations
- Future: alert generation for export violations

---

## 5. Pool & Boundary Rules

| Rule | Enforcement |
|------|-------------|
| M4 reads `asset_hourly_metrics` for baseline/actual/bestTou (unchanged) | Code review + test |
| M4 reads `asset_5min_metrics` for SC/TOU attribution (NEW) | Code review + test |
| M4 reads `dispatch_records` for target_mode (NEW) | Code review + test |
| M4 uses Service Pool (cross-tenant batch job) | `getServicePool()` at job startup |
| Pure functions from `shared/tarifa.ts` have no DB access | Type system |
| **M4 NEVER writes to dispatch_records** | Code review |
| **M4 NEVER reads telemetry_history** | Red line from v5.8 |

---

## 6. What Stays Out of Scope

| Metric | Why Out of Scope | When |
|--------|-----------------|------|
| PS savings calculation | Needs contracted_demand_kw + demand charge rate | v5.16 |
| CCEE PLD wholesale arbitrage | Not regulated for distributed storage | v6.0+ |
| DR subsidy revenue | ANEEL DR framework not finalized | v6.0+ |
| Forward-looking DP optimization | Needs forecast inputs | v6.0 |
| TOU charge cost attribution | TOU contribution uses same-hour rate for both charge/discharge; cross-hour cost tracking deferred | v5.16 |

---

## 7. Code Change List

| File | Action | Description |
|------|--------|-------------|
| `market-billing/services/daily-billing-job.ts` | **MODIFY** | Add: fetch asset_5min_metrics for yesterday; fetch dispatch_records; resolve mode per window; accumulate SC/TOU; write 2 new revenue_daily columns |
| `shared/tarifa.ts` | **unchanged** | `getRateForHour` reused; no new pure functions |
| `market-billing/handlers/get-tariff-schedule.ts` | **unchanged** | Read-only tariff API |
| `market-billing/handlers/calculate-profit.ts` | **unchanged** | On-demand profit calculation |

---

## 8. Test Strategy

| Test | Input | Expected Output |
|------|-------|-----------------|
| SC attribution -- PV self-use | 5-min: pv=0.5, export=0.1, mode=SC | sc = (0.5-0.1) * rate = 0.4 * rate |
| SC attribution -- no PV | 5-min: pv=0, export=0, mode=SC | sc = 0 |
| TOU attribution -- discharge only | 5-min: discharge=0.5, charge=0, pv=0, load=0.3, mode=TOU | tou = 0.5 * rate - 0 |
| TOU attribution -- grid charged | 5-min: charge=0.5, pv=0.1, load=0.3, discharge=0, mode=TOU | bat_charge_from_grid = max(0, 0.5 - max(0, 0.1-0.3)) = 0.5; tou = -0.5 * rate |
| No dispatch for window | No dispatch_records | Defaults to SC mode |
| Multiple overlapping dispatches | 2 dispatches covering same window | Most recent wins |
| revenue_daily UPSERT | Run billing twice | Same values, idempotent |
| SC + TOU daily total | 288 mixed windows | sc + tou <= client_savings (approximate) |
| allow_export=false with export | grid_export > 0 when !allow_export | Warning logged, billing unaffected |

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
| **v5.15** | **2026-03-07** | **SC/TOU Attribution: JOIN asset_5min_metrics + dispatch_records by time window; accumulate sc_savings_reais and tou_savings_reais by dispatch mode; write 2 new revenue_daily columns; allow_export boundary note; upstream energy values corrected (3x deflation from factor fix)** |
