/**
 * Tarifa Branca 3-tier rate structure (ANEEL).
 * Default values -- runtime should read from tariff_schedules table.
 * These constants serve as fallbacks and for unit testing.
 */
export const TARIFA_BRANCA_DEFAULTS = {
  /** Ponta (peak): 18:00-21:00 */
  peak: { startHour: 18, endHour: 21, rateReaisPerKwh: 0.82 },
  /** Intermediaria: 17:00-18:00 + 21:00-22:00 */
  intermediate: {
    ranges: [
      { startHour: 17, endHour: 18 },
      { startHour: 21, endHour: 22 },
    ],
    rateReaisPerKwh: 0.55,
  },
  /** Fora-ponta (off-peak): all other hours */
  offpeak: { rateReaisPerKwh: 0.25 },
} as const;

export type TarifaPeriod = "ponta" | "intermediaria" | "fora_ponta";

/**
 * Classify an hour (0-23) into its Tarifa Branca period.
 * Pure function -- no side effects.
 */
export function classifyHour(hour: number): TarifaPeriod {
  if (hour >= 18 && hour < 21) return "ponta";
  if ((hour >= 17 && hour < 18) || (hour >= 21 && hour < 22))
    return "intermediaria";
  return "fora_ponta";
}

export interface TariffSchedule {
  readonly peakRate: number;
  readonly offpeakRate: number;
  readonly intermediateRate: number | null;
}

/**
 * Get rate for a given hour from a tariff schedule row.
 * Falls back to TARIFA_BRANCA_DEFAULTS if schedule is null.
 */
export function getRateForHour(
  hour: number,
  schedule: TariffSchedule | null,
): number {
  const period = classifyHour(hour);
  if (!schedule) {
    const defaults = TARIFA_BRANCA_DEFAULTS;
    if (period === "ponta") return defaults.peak.rateReaisPerKwh;
    if (period === "intermediaria") return defaults.intermediate.rateReaisPerKwh;
    return defaults.offpeak.rateReaisPerKwh;
  }
  if (period === "ponta") return schedule.peakRate;
  if (period === "intermediaria")
    return schedule.intermediateRate ?? schedule.peakRate;
  return schedule.offpeakRate;
}

export interface HourlyEnergyRow {
  readonly hour: number;
  readonly chargeKwh: number;
  readonly dischargeKwh: number;
}

/**
 * Self-consumption ratio = (pv_generation - grid_export) / pv_generation * 100
 * Returns null if pv_generation <= 0 (no solar -> metric not applicable).
 */
export function calculateSelfConsumption(
  pvGenerationKwh: number,
  gridExportKwh: number,
): number | null {
  if (pvGenerationKwh <= 0) return null;
  const ratio = ((pvGenerationKwh - gridExportKwh) / pvGenerationKwh) * 100;
  return Math.round(ratio * 10) / 10;
}

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

export interface BestTouInput {
  readonly hourlyData: ReadonlyArray<{
    readonly hour: number;
    readonly loadKwh: number;
    readonly pvKwh: number;
  }>;
  readonly schedule: TariffSchedule;
  readonly capacity: number;
  readonly socInitial: number;
  readonly socMinPct: number;
  readonly maxChargeRateKw: number;
  readonly maxDischargeRateKw: number;
}

export interface BestTouResult {
  readonly bestCost: number;
  readonly endSoc: number;
}

/**
 * Post-hoc optimal TOU cost via Dynamic Programming.
 *
 * Given perfect knowledge of load and PV for each hour, finds the battery
 * charge/discharge schedule that minimizes total grid import cost.
 *
 * DP step size = capacity * 5% (HARDCODED), |S| <= 20.
 */
export function calculateBestTouCost(params: BestTouInput): BestTouResult {
  const {
    hourlyData, schedule, capacity,
    socInitial, socMinPct,
    maxChargeRateKw, maxDischargeRateKw,
  } = params;

  const socMin = capacity * (socMinPct / 100);
  const step = capacity * 0.05; // forced 5% step

  // Edge case: no battery
  if (capacity <= 0) {
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

/**
 * Self-sufficiency ratio: what fraction of load is met without grid import.
 *
 * Formula: (totalLoad - totalGridImport) / totalLoad * 100
 *
 * Returns null if totalLoad <= 0 (no load -> metric not applicable).
 */
export function calculateSelfSufficiency(
  totalLoadKwh: number,
  totalGridImportKwh: number,
): number | null {
  if (totalLoadKwh <= 0) return null;
  const ratio = ((totalLoadKwh - totalGridImportKwh) / totalLoadKwh) * 100;
  return Math.round(ratio * 10) / 10;
}
