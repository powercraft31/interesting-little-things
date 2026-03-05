# Shared Layer — Telemetry Types & Deterministic Math

> **模組版本**: v5.13
> **上層文件**: [00_MASTER_ARCHITECTURE_v5.13.md](./00_MASTER_ARCHITECTURE_v5.13.md)
> **最後更新**: 2026-03-05
> **說明**: 標準遙測 payload 型別、Tarifa Branca 費率常數、純函數公式庫
> **核心主題**: Block 1 XuhengTelemetry 型別 + Block 2 deterministic savings math

---

## v5.13 升版說明

### 問題陳述

1. **Block 1:** Xuheng EMS MSG#4 telemetry arrives as JSON with string-typed values. No shared TypeScript interface exists for the parsed output — the Phase 1 Bridge (`mqtt-bridge/src/parser/xuheng-adapter.ts`, commit `00a6133`) defined its own local types. The main backend (`backend/src/iot-hub/`) has `TelemetryPayload` in `telemetry-webhook.ts` but it lacks PV/grid/load detail fields needed for full energy math.
2. **Block 2:** Tarifa Branca C-side savings formulas (peak/intermediate/off-peak rate lookup, Optimization Alpha, self-consumption ratio) are needed by both M4 billing and M5 BFF. These must be pure functions with zero side effects, living in `shared/` to avoid duplication.

### 解決方案

- Add `shared/types/telemetry.ts` — canonical telemetry interfaces for all adapters
- Add `shared/tarifa.ts` — Tarifa Branca rate constants + pure formula functions
- Existing `shared/db.ts` (Dual Pool Factory) unchanged

---

## 1. 新增型別：`shared/types/telemetry.ts`

### 1.1 XuhengRawMessage (MSG#4 wire format)

```typescript
/** Raw Xuheng EMS MSG#4 as received from MQTT topic xuheng/+/+/data */
export interface XuhengRawMessage {
  readonly clientId: string;       // e.g. "WKRD24070202100141I"
  readonly productKey: string;     // "ems"
  readonly timeStamp: string;      // Unix ms as string, e.g. "1772620029130"
  readonly data: {
    readonly batList: ReadonlyArray<{
      readonly deviceSn: string;
      readonly properties: {
        readonly total_bat_soc: string;
        readonly total_bat_power: string;
        readonly total_bat_dailyChargedEnergy: string;
        readonly total_bat_dailyDischargedEnergy: string;
      };
    }>;
    readonly pvList: ReadonlyArray<{
      readonly deviceSn: string;
      readonly properties: {
        readonly pv_totalPower: string;
        readonly pv_dailyEnergy: string;
      };
    }>;
    readonly gridList: ReadonlyArray<{
      readonly deviceSn: string;
      readonly properties: {
        readonly grid_totalActivePower: string;
        readonly grid_dailyBuyEnergy: string;
        readonly grid_dailySellEnergy: string;
      };
    }>;
    readonly loadList: ReadonlyArray<{
      readonly deviceSn: string;
      readonly properties: {
        readonly load1_totalPower: string;
      };
    }>;
    readonly flloadList: ReadonlyArray<{
      readonly deviceSn: string;
      readonly properties: {
        readonly flload_totalPower: string;
      };
    }>;
  };
}
```

### 1.2 ParsedTelemetry (canonical internal format)

```typescript
/** Canonical telemetry record after parsing — all values numeric, SI units */
export interface ParsedTelemetry {
  readonly clientId: string;
  readonly deviceSn: string;       // primary battery deviceSn
  readonly recordedAt: Date;       // parsed from timeStamp
  readonly batterySoc: number;     // 0-100 (%)
  readonly batteryPowerKw: number; // kW, positive=charging, negative=discharging
  readonly dailyChargeKwh: number;
  readonly dailyDischargeKwh: number;
  readonly pvPowerKw: number;      // kW, always >= 0
  readonly pvDailyEnergyKwh: number;
  readonly gridPowerKw: number;    // kW, positive=import, negative=export
  readonly gridDailyBuyKwh: number;
  readonly gridDailySellKwh: number;
  readonly loadPowerKw: number;    // kW, always >= 0
  readonly flloadPowerKw: number;  // kW, flexible load
}
```

### 1.3 Mapping to DB columns

| ParsedTelemetry field | telemetry_history column | device_state column |
|----------------------|-------------------------|-------------------|
| batterySoc | battery_soc | battery_soc |
| batteryPowerKw | battery_power | battery_power |
| pvPowerKw | pv_power | pv_power |
| gridPowerKw | grid_power_kw | grid_power_kw |
| loadPowerKw | load_power | load_power |
| gridDailyBuyKwh | grid_import_kwh | — |
| gridDailySellKwh | grid_export_kwh | — |

### 1.4 MessageType enum

```typescript
/** Xuheng message type discriminator (from topic structure) */
export const enum XuhengMessageType {
  EMS_LIST = 0,     // MSG#0: emsList — device registry
  DIDO = 1,         // MSG#1: dido — digital I/O
  METER_LIST = 2,   // MSG#2: meterList — smart meter
  METER_DATA = 3,   // MSG#3: meterList — meter readings
  ENERGY_DATA = 4,  // MSG#4: batList+pvList+gridList+loadList — PRIMARY
}
```

---

## 2. 新增模組：`shared/tarifa.ts` — Tarifa Branca Constants & Pure Functions

### 2.1 Rate Constants

```typescript
/**
 * Tarifa Branca 3-tier rate structure (ANEEL).
 * Default values — runtime should read from tariff_schedules table.
 * These constants serve as fallbacks and for unit testing.
 */
export const TARIFA_BRANCA_DEFAULTS = {
  /** Ponta (peak): 18:00–21:00 */
  peak: { startHour: 18, endHour: 21, rateReaisPerKwh: 0.82 },
  /** Intermediaria: 17:00–18:00 + 21:00–22:00 */
  intermediate: { ranges: [{ startHour: 17, endHour: 18 }, { startHour: 21, endHour: 22 }], rateReaisPerKwh: 0.55 },
  /** Fora-ponta (off-peak): all other hours */
  offpeak: { rateReaisPerKwh: 0.25 },
} as const;
```

### 2.2 Period Classifier

```typescript
export type TarifaPeriod = 'ponta' | 'intermediaria' | 'fora_ponta';

/**
 * Classify an hour (0-23) into its Tarifa Branca period.
 * Pure function — no side effects.
 */
export function classifyHour(hour: number): TarifaPeriod {
  if (hour >= 18 && hour < 21) return 'ponta';
  if ((hour >= 17 && hour < 18) || (hour >= 21 && hour < 22)) return 'intermediaria';
  return 'fora_ponta';
}

/**
 * Get rate for a given hour from a tariff schedule row.
 * Falls back to TARIFA_BRANCA_DEFAULTS if schedule is null.
 */
export function getRateForHour(
  hour: number,
  schedule: { peakRate: number; offpeakRate: number; intermediateRate: number | null } | null,
): number {
  const period = classifyHour(hour);
  if (!schedule) {
    const defaults = TARIFA_BRANCA_DEFAULTS;
    if (period === 'ponta') return defaults.peak.rateReaisPerKwh;
    if (period === 'intermediaria') return defaults.intermediate.rateReaisPerKwh;
    return defaults.offpeak.rateReaisPerKwh;
  }
  if (period === 'ponta') return schedule.peakRate;
  if (period === 'intermediaria') return schedule.intermediateRate ?? schedule.peakRate;
  return schedule.offpeakRate;
}
```

### 2.3 Savings Formulas (Pure Functions)

```typescript
export interface HourlyEnergyRow {
  readonly hour: number;            // 0-23
  readonly chargeKwh: number;       // energy charged this hour
  readonly dischargeKwh: number;    // energy discharged this hour
}

export interface TariffSchedule {
  readonly peakRate: number;
  readonly offpeakRate: number;
  readonly intermediateRate: number | null;
}

/**
 * Calculate Tarifa Branca C-side savings for a set of hourly records.
 *
 * Formula per hour:
 *   savings_h = discharge_kwh × rate(h) - charge_kwh × offpeak_rate
 *
 * Rationale: Charging at off-peak is a cost; discharging at peak/intermediate
 * displaces grid import at that hour's rate → net savings.
 */
export function calculateDailySavings(
  hours: ReadonlyArray<HourlyEnergyRow>,
  schedule: TariffSchedule,
): number {
  let total = 0;
  for (const h of hours) {
    const rate = getRateForHour(h.hour, schedule);
    total += h.dischargeKwh * rate - h.chargeKwh * schedule.offpeakRate;
  }
  return Math.round(total * 100) / 100; // round to centavos
}

/**
 * Optimization Alpha = actual_savings / theoretical_max × 100
 *
 * theoretical_max = battery_capacity_kwh × (peak_rate - offpeak_rate) × days
 *   (one full cycle per day at maximum spread)
 */
export function calculateOptimizationAlpha(
  actualSavingsReais: number,
  batteryCapacityKwh: number,
  schedule: TariffSchedule,
  days: number,
): number {
  const spread = schedule.peakRate - schedule.offpeakRate;
  const theoreticalMax = batteryCapacityKwh * spread * days;
  if (theoreticalMax <= 0) return 0;
  return Math.round((actualSavingsReais / theoreticalMax) * 10000) / 100; // 2 decimal %
}

/**
 * Self-consumption ratio = (pv_generation - grid_export) / pv_generation × 100
 * Returns 0 if pv_generation is 0 (no solar → no self-consumption metric).
 */
export function calculateSelfConsumption(
  pvGenerationKwh: number,
  gridExportKwh: number,
): number {
  if (pvGenerationKwh <= 0) return 0;
  const ratio = ((pvGenerationKwh - gridExportKwh) / pvGenerationKwh) * 100;
  return Math.round(ratio * 10) / 10; // 1 decimal %
}
```

---

## 3. 代碼變更清單

| 檔案 | 動作 | 說明 |
|------|------|------|
| `backend/src/shared/types/telemetry.ts` | **NEW** | XuhengRawMessage, ParsedTelemetry, XuhengMessageType |
| `backend/src/shared/tarifa.ts` | **NEW** | TARIFA_BRANCA_DEFAULTS, classifyHour, getRateForHour, calculateDailySavings, calculateOptimizationAlpha, calculateSelfConsumption |
| `backend/src/shared/db.ts` | **unchanged** | Dual Pool Factory stays as-is |
| `backend/src/shared/types/api.ts` | **unchanged** | ok/error envelope stays as-is |
| `backend/src/shared/types/auth.ts` | **unchanged** | Role enum stays as-is |

---

## 4. 測試策略

All functions in `shared/tarifa.ts` are pure — test with table-driven unit tests:

| Test Case | Input | Expected |
|-----------|-------|----------|
| classifyHour(19) | 19 | `'ponta'` |
| classifyHour(17) | 17 | `'intermediaria'` |
| classifyHour(21) | 21 | `'intermediaria'` |
| classifyHour(10) | 10 | `'fora_ponta'` |
| classifyHour(0) | 0 | `'fora_ponta'` |
| calculateDailySavings — full peak discharge | [{hour:19, charge:0, discharge:5}] | 5 × 0.82 = 4.10 |
| calculateDailySavings — off-peak charge only | [{hour:3, charge:5, discharge:0}] | -5 × 0.25 = -1.25 |
| calculateOptimizationAlpha — perfect | savings=5.70, cap=10, spread=0.57, days=1 | 100.00% |
| calculateSelfConsumption — no export | pv=10, export=0 | 100.0% |
| calculateSelfConsumption — half export | pv=10, export=5 | 50.0% |
| calculateSelfConsumption — zero PV | pv=0, export=0 | 0% |

---

## 5. 依賴關係

```
shared/types/telemetry.ts  ←── M1 mqtt-subscriber.ts (Block 1)
                           ←── M1 telemetry-webhook.ts (existing, can adopt)

shared/tarifa.ts           ←── M4 daily-billing-job.ts (Block 2)
                           ←── M5 get-performance-scorecard.ts (Block 2)
                           ←── M5 get-dashboard.ts (Block 2, revenue calculation)
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
| v5.11 | 2026-03-05 | Dual Pool Factory — getAppPool() + getServicePool() |
| **v5.13** | **2026-03-05** | **Block 1: XuhengRawMessage + ParsedTelemetry 型別; Block 2: Tarifa Branca 常數 + 純函數公式庫 (classifyHour, calculateDailySavings, calculateOptimizationAlpha, calculateSelfConsumption)** |
