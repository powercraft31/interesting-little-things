# Shared Layer — Formula Overhaul & DP Best TOU Cost

> **模組版本**: v5.14
> **上層文件**: [00_MASTER_ARCHITECTURE_v5.14.md](./00_MASTER_ARCHITECTURE_v5.14.md)
> **最後更新**: 2026-03-06
> **說明**: 刪除 2 個有缺陷的公式函數、新增 4 個正確函數（含 DP 最佳 TOU）、擴充遙測型別
> **核心主題**: calculateBaselineCost + calculateActualCost + calculateBestTouCost(DP) + calculateSelfSufficiency

---

## Changes from v5.13

| Aspect | v5.13 | v5.14 |
|--------|-------|-------|
| `calculateDailySavings` | Present (charge cost assumes off-peak) | **DELETED** |
| `calculateOptimizationAlpha` | Present (theoretical max = 1 cycle/day) | **DELETED** |
| `calculateBaselineCost` | N/A | **NEW** — Sigma load[h] * rate(h) |
| `calculateActualCost` | N/A | **NEW** — Sigma gridImport[h] * rate(h) |
| `calculateBestTouCost` | N/A | **NEW** — DP post-hoc optimal |
| `calculateSelfSufficiency` | N/A | **NEW** — (load - gridImport) / load |
| `classifyHour` | Present | **KEPT** (unchanged) |
| `getRateForHour` | Present | **KEPT** (unchanged) |
| `calculateSelfConsumption` | Present | **KEPT** (unchanged) |
| `HourlyEnergyRow` interface | Present | **KEPT** (unused by new functions but kept for backward compat if needed) |
| `BestTouInput` interface | N/A | **NEW** |
| `BestTouResult` interface | N/A | **NEW** |
| `ParsedTelemetry` | 14 fields | 23 fields (+9 battery fields) |
| `XuhengRawMessage.batList.properties` | 4 fields | 13 fields (+9) |

---

## 1. Functions to DELETE from `shared/tarifa.ts`

### §1.1 `calculateDailySavings` — DELETE

**Reason:** Assumes all charging costs off-peak rate, regardless of actual charging source. If battery charges from PV (free), the formula still subtracts `chargeKwh * offpeakRate`, understating savings.

```typescript
// DELETE THIS FUNCTION
export function calculateDailySavings(
  hours: ReadonlyArray<HourlyEnergyRow>,
  schedule: TariffSchedule,
): number { ... }
```

**Replacement:** `calculateBaselineCost` + `calculateActualCost` (see §2). The actual savings is simply `baselineCost - actualCost`.

### §1.2 `calculateOptimizationAlpha` — DELETE

**Reason:** The theoretical maximum `capacity * (peakRate - offpeakRate) * days` assumes exactly one full cycle per day at maximum spread. This is physically arbitrary — a battery might do 1.5 cycles, PV might cover part of peak, intermediate rate hours exist. The resulting percentage is misleading.

```typescript
// DELETE THIS FUNCTION
export function calculateOptimizationAlpha(
  actualSavingsReais: number,
  batteryCapacityKwh: number,
  schedule: TariffSchedule,
  days: number,
): number { ... }
```

**Replacement:** `calculateBestTouCost` (see §2.3) computes the provably optimal schedule via DP. Optimization Efficiency = `(baseline - actual) / (baseline - bestTou) * 100`.

---

## 2. Functions to ADD to `shared/tarifa.ts`

### §2.1 `calculateBaselineCost`

```typescript
/**
 * Baseline cost: what the customer would pay with NO PV and NO battery.
 * All load is met by grid import at the applicable hourly rate.
 *
 * Formula: Sigma load[h] * rate(h) for h = 0..23
 */
export function calculateBaselineCost(
  hourlyLoads: ReadonlyArray<{ readonly hour: number; readonly loadKwh: number }>,
  schedule: TariffSchedule,
): number {
  let total = 0;
  for (const h of hourlyLoads) {
    total += h.loadKwh * getRateForHour(h.hour, schedule);
  }
  return Math.round(total * 100) / 100;
}
```

**Properties:**
- Pure function, no side effects
- Returns R$ (reais), rounded to centavos
- If load is 0 for all hours, returns 0
- Always >= 0 (load is non-negative)

### §2.2 `calculateActualCost`

```typescript
/**
 * Actual cost: what the customer actually paid for grid imports.
 * Only grid import energy incurs cost (PV + battery discharge are free).
 *
 * Formula: Sigma gridImport[h] * rate(h) for h = 0..23
 */
export function calculateActualCost(
  hourlyGridImports: ReadonlyArray<{ readonly hour: number; readonly gridImportKwh: number }>,
  schedule: TariffSchedule,
): number {
  let total = 0;
  for (const h of hourlyGridImports) {
    total += h.gridImportKwh * getRateForHour(h.hour, schedule);
  }
  return Math.round(total * 100) / 100;
}
```

**Properties:**
- Pure function, no side effects
- Returns R$ (reais), rounded to centavos
- Always <= baselineCost (grid import <= load for any configuration with PV/battery)
- If no grid import (fully self-sufficient), returns 0

### §2.3 `calculateBestTouCost`

```typescript
/**
 * Input parameters for the DP best TOU cost algorithm.
 */
export interface BestTouInput {
  readonly hourlyData: ReadonlyArray<{
    readonly hour: number;
    readonly loadKwh: number;
    readonly pvKwh: number;
  }>;
  readonly schedule: TariffSchedule;
  readonly capacity: number;         // battery capacity in kWh
  readonly socInitial: number;       // initial SoC in kWh (from telemetry)
  readonly socMinPct: number;        // minimum SoC as percentage (e.g. 10)
  readonly maxChargeRateKw: number;  // max charge rate in kW
  readonly maxDischargeRateKw: number; // max discharge rate in kW
}

/**
 * Output of the DP best TOU cost algorithm.
 */
export interface BestTouResult {
  readonly bestCost: number;         // R$ optimal grid import cost
  readonly endSoc: number;           // kWh final SoC at end of day
}

/**
 * Post-hoc optimal TOU cost via Dynamic Programming.
 *
 * Given perfect knowledge of load and PV for each hour, finds the battery
 * charge/discharge schedule that minimizes total grid import cost.
 *
 * Objective: minimize Sigma(h=0..23) max(0, battery_delta[h] - net[h]) * rate[h]
 *   where net[h] = pv[h] - load[h]
 *
 * State: (hour h, discretized SoC level s)
 * Transition: soc[h+1] = soc[h] + battery_delta[h]
 * Constraints:
 *   soc[0] = socInitial (FIXED from telemetry)
 *   soc_min <= soc[h] <= capacity
 *   -maxDischargeRateKw <= battery_delta[h] <= maxChargeRateKw
 *
 * Complexity: O(T * S * A) where T=24, S~100, A~200 = ~480,000 operations
 * Memory: 2 * S * 8 bytes ~ 1.6 KB. Millisecond execution. No OOM risk.
 */
export function calculateBestTouCost(params: BestTouInput): BestTouResult {
  const {
    hourlyData, schedule, capacity,
    socInitial, socMinPct,
    maxChargeRateKw, maxDischargeRateKw,
  } = params;

  const socMin = capacity * (socMinPct / 100);
  const step = capacity * 0.05; // 強制 5% 步長，|S| ≤ 20

  // Edge case: no battery
  if (capacity <= 0) {
    // Without battery, best cost = baseline cost (all load from grid minus PV)
    let cost = 0;
    for (const h of hourlyData) {
      const gridNeeded = Math.max(0, h.loadKwh - h.pvKwh);
      cost += gridNeeded * getRateForHour(h.hour, schedule);
    }
    return { bestCost: Math.round(cost * 100) / 100, endSoc: 0 };
  }

  // Discretize SoC levels
  const levels: number[] = [];
  for (let s = socMin; s <= capacity + step / 2; s += step) {
    levels.push(Math.round(s * 10) / 10);
  }
  const S = levels.length;

  const indexOf = (soc: number): number =>
    Math.round((soc - socMin) / step);

  // DP tables: current and next
  let dpCurrent = new Float64Array(S).fill(Infinity);
  const initIdx = indexOf(Math.min(Math.max(socInitial, socMin), capacity));
  dpCurrent[initIdx] = 0;

  for (const hData of hourlyData) {
    const dpNext = new Float64Array(S).fill(Infinity);
    const rate = getRateForHour(hData.hour, schedule);
    const net = hData.pvKwh - hData.loadKwh;

    for (let si = 0; si < S; si++) {
      if (dpCurrent[si] === Infinity) continue;
      const soc = levels[si];

      // Enumerate valid battery actions
      const minDelta = -Math.min(maxDischargeRateKw, soc - socMin);
      const maxDelta = Math.min(maxChargeRateKw, capacity - soc);

      for (let delta = minDelta; delta <= maxDelta + step / 2; delta += step) {
        const roundedDelta = Math.round(delta * 10) / 10;
        const newSoc = Math.round((soc + roundedDelta) * 10) / 10;
        if (newSoc < socMin - 0.001 || newSoc > capacity + 0.001) continue;

        const newIdx = indexOf(newSoc);
        if (newIdx < 0 || newIdx >= S) continue;

        const gridImport = Math.max(0, roundedDelta - net);
        const hourCost = gridImport * rate;
        const totalCost = dpCurrent[si] + hourCost;

        if (totalCost < dpNext[newIdx]) {
          dpNext[newIdx] = totalCost;
        }
      }
    }

    dpCurrent = dpNext;
  }

  // Find minimum cost across all final SoC states
  let bestCost = Infinity;
  let bestIdx = 0;
  for (let i = 0; i < S; i++) {
    if (dpCurrent[i] < bestCost) {
      bestCost = dpCurrent[i];
      bestIdx = i;
    }
  }

  return {
    bestCost: bestCost === Infinity ? 0 : Math.round(bestCost * 100) / 100,
    endSoc: levels[bestIdx] ?? 0,
  };
}
```

### §2.4 `calculateSelfSufficiency`

```typescript
/**
 * Self-sufficiency ratio: what fraction of load is met without grid import.
 *
 * Formula: (totalLoad - totalGridImport) / totalLoad * 100
 *
 * Returns 0 if totalLoad is 0 (no load -> metric not applicable).
 */
export function calculateSelfSufficiency(
  totalLoadKwh: number,
  totalGridImportKwh: number,
): number {
  if (totalLoadKwh <= 0) return 0;
  const ratio = ((totalLoadKwh - totalGridImportKwh) / totalLoadKwh) * 100;
  return Math.round(ratio * 10) / 10;
}
```

**Properties:**
- Pure function, no side effects
- Returns percentage (0-100), 1 decimal place
- Handles load=0 safely (returns 0)
- Always between 0-100 when gridImport <= load

---

### §2.5 除零防禦原則（Gemini R1 防禦）

> ⚠️ **所有百分比計算函數必須遵守以下規則：**
>
> 1. 分母為零時回傳 `null`（不是 0，不是 NaN，不是 Infinity）
> 2. TypeScript 回傳型別標記為 `number | null`
> 3. 適用場景：
>    - `calculateSelfConsumption`：pvGen = 0 → `null`
>    - `calculateSelfSufficiency`：load = 0 → `null`（目前回傳 0，需改為 null）
>    - BFF 計算 Optimization Efficiency：baseline - bestTou = 0 → `null`
> 4. BFF 將 `null` 直接序列化進 JSON，前端收到 `null` 時顯示 `"—"` 或 `"N/A"`

---

## 3. Functions to KEEP Unchanged

| Function | Signature | Status |
|----------|-----------|--------|
| `classifyHour` | `(hour: number): TarifaPeriod` | **KEEP** — correct, used by new functions |
| `getRateForHour` | `(hour: number, schedule: TariffSchedule \| null): number` | **KEEP** — correct, used by new functions |
| `calculateSelfConsumption` | `(pvGenerationKwh: number, gridExportKwh: number): number` | **KEEP** — correct, different metric from self-sufficiency |

### Self-Consumption vs Self-Sufficiency

| Metric | Formula | Question Answered |
|--------|---------|-------------------|
| Self-Consumption | (pvGen - gridExport) / pvGen | "What % of my PV production do I use on-site?" |
| Self-Sufficiency | (load - gridImport) / load | "What % of my load is met without grid?" |

Both are valid, independent metrics. Self-consumption focuses on PV utilization. Self-sufficiency focuses on grid independence.

---

## 4. Type Definitions to ADD

### §4.1 `BestTouInput` and `BestTouResult`

(Defined inline in §2.3 above — exported from `shared/tarifa.ts`)

### §4.2 `shared/types/telemetry.ts` Expansion

#### XuhengRawMessage — bat.properties expansion

```typescript
export interface XuhengRawMessage {
  readonly clientId: string;
  readonly productKey: string;
  readonly timeStamp: string;
  readonly data: {
    readonly batList?: ReadonlyArray<{
      readonly deviceSn: string;
      readonly properties: {
        // v5.13 existing
        readonly total_bat_soc: string;
        readonly total_bat_power: string;
        readonly total_bat_dailyChargedEnergy: string;
        readonly total_bat_dailyDischargedEnergy: string;
        // v5.14 NEW — 9 additional fields
        readonly total_bat_soh?: string;
        readonly total_bat_vlotage?: string;          // note: source typo "vlotage"
        readonly total_bat_current?: string;
        readonly total_bat_temperature?: string;
        readonly total_bat_maxChargeVoltage?: string;
        readonly total_bat_maxChargeCurrent?: string;
        readonly total_bat_maxDischargeCurrent?: string;
        readonly total_bat_totalChargedEnergy?: string;
        readonly total_bat_totalDischargedEnergy?: string;
      };
    }>;
    // pvList, gridList, loadList, flloadList, emsList — unchanged
    readonly pvList?: ReadonlyArray<{ /* unchanged */ }>;
    readonly gridList?: ReadonlyArray<{ /* unchanged */ }>;
    readonly loadList?: ReadonlyArray<{ /* unchanged */ }>;
    readonly flloadList?: ReadonlyArray<{ /* unchanged */ }>;
    readonly emsList?: ReadonlyArray<{ /* unchanged */ }>;
    readonly [key: string]: unknown;
  };
}
```

**Note:** The 9 new bat.properties are **optional** (`?`) because older firmware versions may not include them. The `safeFloat()` function in XuhengAdapter handles `undefined` gracefully.

#### ParsedTelemetry — 9 new fields

```typescript
export interface ParsedTelemetry {
  // v5.13 existing (14 fields — unchanged)
  readonly clientId: string;
  readonly deviceSn: string;
  readonly recordedAt: Date;
  readonly batterySoc: number;
  readonly batteryPowerKw: number;
  readonly dailyChargeKwh: number;
  readonly dailyDischargeKwh: number;
  readonly pvPowerKw: number;
  readonly pvDailyEnergyKwh: number;
  readonly gridPowerKw: number;
  readonly gridDailyBuyKwh: number;
  readonly gridDailySellKwh: number;
  readonly loadPowerKw: number;
  readonly flloadPowerKw: number;

  // v5.14 NEW — 9 battery deep telemetry fields
  readonly batterySoh: number;            // BMS-reported SoH %
  readonly batteryVoltage: number;        // total pack voltage (V)
  readonly batteryCurrent: number;        // pack current (A), negative=discharge
  readonly batteryTemperature: number;    // pack temperature (C)
  readonly maxChargeVoltage: number;      // max allowed charge voltage (V)
  readonly maxChargeCurrent: number;      // max allowed charge current (A)
  readonly maxDischargeCurrent: number;   // max allowed discharge current (A)
  readonly totalChargeKwh: number;        // cumulative lifetime charge (kWh)
  readonly totalDischargeKwh: number;     // cumulative lifetime discharge (kWh)
}
```

---

## 5. Complete Exports — `shared/tarifa.ts` After v5.14

```typescript
// Constants
export const TARIFA_BRANCA_DEFAULTS = { ... };  // unchanged

// Types
export type TarifaPeriod = "ponta" | "intermediaria" | "fora_ponta";
export interface TariffSchedule { ... };         // unchanged
export interface HourlyEnergyRow { ... };         // kept (may be used externally)
export interface BestTouInput { ... };            // NEW
export interface BestTouResult { ... };           // NEW

// Functions — KEPT (3)
export function classifyHour(hour: number): TarifaPeriod;
export function getRateForHour(hour: number, schedule: TariffSchedule | null): number;
export function calculateSelfConsumption(pvGenerationKwh: number, gridExportKwh: number): number;

// Functions — NEW (4)
export function calculateBaselineCost(hourlyLoads: ..., schedule: TariffSchedule): number;
export function calculateActualCost(hourlyGridImports: ..., schedule: TariffSchedule): number;
export function calculateBestTouCost(params: BestTouInput): BestTouResult;
export function calculateSelfSufficiency(totalLoadKwh: number, totalGridImportKwh: number): number;

// Functions — DELETED (2)
// calculateDailySavings — REMOVED
// calculateOptimizationAlpha — REMOVED
```

---

## 6. 代碼變更清單

| 檔案 | 動作 | 說明 |
|------|------|------|
| `shared/tarifa.ts` | **MODIFY** | Delete calculateDailySavings + calculateOptimizationAlpha; add calculateBaselineCost + calculateActualCost + calculateBestTouCost + calculateSelfSufficiency; add BestTouInput + BestTouResult interfaces |
| `shared/types/telemetry.ts` | **MODIFY** | Expand XuhengRawMessage.batList.properties (+9 optional fields); expand ParsedTelemetry (+9 numeric fields) |
| `shared/db.ts` | **unchanged** | Dual Pool Factory stays as-is |
| `shared/types/api.ts` | **unchanged** | ok/error envelope stays as-is |
| `shared/types/auth.ts` | **unchanged** | Role enum stays as-is |

---

## 7. 測試策略

All functions in `shared/tarifa.ts` are pure — test with table-driven unit tests:

### §7.1 calculateBaselineCost Tests

| Test Case | Input | Expected |
|-----------|-------|----------|
| Single peak hour | [{hour:19, loadKwh:5}] | 5 * 0.82 = R$4.10 |
| Single off-peak hour | [{hour:3, loadKwh:10}] | 10 * 0.25 = R$2.50 |
| Full 24h flat load | 24 * [{hour:h, loadKwh:1}] | Sigma rate(h) for all hours |
| Empty input | [] | R$0.00 |

### §7.2 calculateActualCost Tests

| Test Case | Input | Expected |
|-----------|-------|----------|
| Zero grid import | [{hour:19, gridImportKwh:0}] | R$0.00 |
| Peak grid import | [{hour:19, gridImportKwh:5}] | 5 * 0.82 = R$4.10 |
| Off-peak grid import | [{hour:3, gridImportKwh:10}] | 10 * 0.25 = R$2.50 |

### §7.3 calculateBestTouCost Tests

| Test Case | Input | Expected |
|-----------|-------|----------|
| No battery (cap=0) | Any hourly data | = Sigma max(0, load-pv) * rate |
| Scenario 2 (validated) | 3kWp PV, SoC=4, min=1, 10kWh | bestCost=R$0.76 |
| Scenario 3 (validated) | 2kWp PV, SoC=4, min=1, 10kWh | bestCost=R$3.00 |
| Fully sufficient | PV covers all load + battery covers rest | bestCost=R$0.00 |
| No PV, no battery | All load from grid | bestCost = baselineCost |

### §7.4 calculateSelfSufficiency Tests

| Test Case | Input | Expected |
|-----------|-------|----------|
| No grid import | load=10, gridImport=0 | 100.0% |
| Half grid import | load=10, gridImport=5 | 50.0% |
| Full grid import | load=10, gridImport=10 | 0.0% |
| Zero load | load=0, gridImport=0 | 0% (safe) |

### §7.5 Deleted Function Tests

- **Delete** all test cases for `calculateDailySavings`
- **Delete** all test cases for `calculateOptimizationAlpha`

---

## 8. 依賴關係

```
shared/tarifa.ts               <-- M4 daily-billing-job.ts (Block 2)
  calculateBaselineCost         <-- M4
  calculateActualCost           <-- M4
  calculateBestTouCost          <-- M4
  calculateSelfSufficiency      <-- M4
  calculateSelfConsumption      <-- M4 (unchanged)
  classifyHour                  <-- internal (used by getRateForHour)
  getRateForHour                <-- M5 scorecard (if needed), internal

shared/types/telemetry.ts      <-- M1 XuhengAdapter.ts (Block 1)
  ParsedTelemetry               <-- M1 mqtt-subscriber, message-buffer
  XuhengRawMessage              <-- M1 mqtt-subscriber

Note: M5 BFF does NOT import tarifa.ts in v5.14.
      All BFF KPIs are computed from pre-computed revenue_daily columns.
      The calculateOptimizationAlpha import is DELETED from scorecard handler.
```

---

## Document History

| Version | Date | Summary |
|---------|------|---------|
| v5.2 | 2026-02-27 | 初始版本：公共型別、EventBus、Cognito JWT middleware |
| v5.3 | 2026-02-27 | HEMS 單戶控制型別 |
| v5.4 | 2026-02-27 | PostgreSQL 全面取代 DynamoDB 型別 |
| v5.5 | 2026-02-28 | 雙層 KPI 型別 |
| v5.10 | 2026-03-05 | RLS Scope Formalization |
| v5.11 | 2026-03-05 | Dual Pool Factory |
| v5.13 | 2026-03-05 | XuhengRawMessage + ParsedTelemetry types; Tarifa Branca pure functions (classifyHour, calculateDailySavings, calculateOptimizationAlpha, calculateSelfConsumption) |
| **v5.14** | **2026-03-06** | **Formula Overhaul: delete calculateDailySavings + calculateOptimizationAlpha; add calculateBaselineCost + calculateActualCost + calculateBestTouCost(DP) + calculateSelfSufficiency; add BestTouInput/BestTouResult interfaces; expand ParsedTelemetry +9 fields; expand XuhengRawMessage.batList.properties +9 fields; DP O(480K ops), 1.6KB memory, millisecond execution** |
