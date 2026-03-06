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
 * Calculate Tarifa Branca C-side savings for a set of hourly records.
 *
 * Formula per hour:
 *   savings_h = discharge_kwh * rate(h) - charge_kwh * offpeak_rate
 *
 * Rationale: Charging at off-peak is a cost; discharging at peak/intermediate
 * displaces grid import at that hour's rate -> net savings.
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
  return Math.round(total * 100) / 100;
}

/**
 * Optimization Alpha = actual_savings / theoretical_max * 100
 *
 * theoretical_max = battery_capacity_kwh * (peak_rate - offpeak_rate) * days
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
  return Math.round((actualSavingsReais / theoreticalMax) * 10000) / 100;
}

/**
 * Self-consumption ratio = (pv_generation - grid_export) / pv_generation * 100
 * Returns 0 if pv_generation is 0 (no solar -> no self-consumption metric).
 */
export function calculateSelfConsumption(
  pvGenerationKwh: number,
  gridExportKwh: number,
): number {
  if (pvGenerationKwh <= 0) return 0;
  const ratio = ((pvGenerationKwh - gridExportKwh) / pvGenerationKwh) * 100;
  return Math.round(ratio * 10) / 10;
}
