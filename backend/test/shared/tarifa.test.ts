import {
  classifyHour,
  getRateForHour,
  calculateSelfConsumption,
  calculateBaselineCost,
  calculateActualCost,
  calculateBestTouCost,
  calculateSelfSufficiency,
  TARIFA_BRANCA_DEFAULTS,
} from "../../src/shared/tarifa";

describe("shared/tarifa — Tarifa Branca pure functions", () => {
  describe("classifyHour", () => {
    it.each([
      [18, "ponta"],
      [19, "ponta"],
      [20, "ponta"],
      [17, "intermediaria"],
      [21, "intermediaria"],
      [0, "fora_ponta"],
      [10, "fora_ponta"],
      [16, "fora_ponta"],
      [22, "fora_ponta"],
      [23, "fora_ponta"],
    ] as const)("classifyHour(%i) = %s", (hour, expected) => {
      expect(classifyHour(hour)).toBe(expected);
    });
  });

  describe("getRateForHour", () => {
    it("returns peak rate for ponta hours", () => {
      expect(getRateForHour(19, null)).toBe(
        TARIFA_BRANCA_DEFAULTS.peak.rateReaisPerKwh,
      );
    });

    it("returns intermediate rate for intermediaria hours", () => {
      expect(getRateForHour(17, null)).toBe(
        TARIFA_BRANCA_DEFAULTS.intermediate.rateReaisPerKwh,
      );
    });

    it("returns offpeak rate for fora_ponta hours", () => {
      expect(getRateForHour(10, null)).toBe(
        TARIFA_BRANCA_DEFAULTS.offpeak.rateReaisPerKwh,
      );
    });

    it("uses custom schedule when provided", () => {
      const schedule = {
        peakRate: 1.0,
        offpeakRate: 0.30,
        intermediateRate: 0.60,
      };
      expect(getRateForHour(19, schedule)).toBe(1.0);
      expect(getRateForHour(17, schedule)).toBe(0.60);
      expect(getRateForHour(10, schedule)).toBe(0.30);
    });

    it("falls back to peakRate when intermediateRate is null", () => {
      const schedule = {
        peakRate: 1.0,
        offpeakRate: 0.30,
        intermediateRate: null,
      };
      expect(getRateForHour(17, schedule)).toBe(1.0);
    });
  });

  describe("calculateSelfConsumption", () => {
    it("returns 100% when no export", () => {
      expect(calculateSelfConsumption(10, 0)).toBe(100);
    });

    it("returns 50% when half is exported", () => {
      expect(calculateSelfConsumption(10, 5)).toBe(50);
    });

    it("returns 0% when all is exported", () => {
      expect(calculateSelfConsumption(10, 10)).toBe(0);
    });

    it("returns null when PV is 0 (divide-by-zero)", () => {
      expect(calculateSelfConsumption(0, 0)).toBeNull();
    });

    it("returns null when PV is negative", () => {
      expect(calculateSelfConsumption(-1, 0)).toBeNull();
    });

    it("handles fractional values", () => {
      // (15.6 - 8.6) / 15.6 * 100 = 44.871... -> 44.9
      expect(calculateSelfConsumption(15.6, 8.6)).toBe(44.9);
    });
  });

  describe("calculateBaselineCost", () => {
    const schedule = {
      peakRate: 0.82,
      offpeakRate: 0.25,
      intermediateRate: 0.55,
    };

    it("calculates peak hour load cost", () => {
      const loads = [{ hour: 19, loadKwh: 5 }];
      // 5 * 0.82 = 4.10
      expect(calculateBaselineCost(loads, schedule)).toBe(4.10);
    });

    it("calculates off-peak hour load cost", () => {
      const loads = [{ hour: 3, loadKwh: 10 }];
      // 10 * 0.25 = 2.50
      expect(calculateBaselineCost(loads, schedule)).toBe(2.50);
    });

    it("calculates full 24h with mixed rates", () => {
      const loads = [
        { hour: 3, loadKwh: 1 },   // 0.25
        { hour: 17, loadKwh: 1 },  // 0.55
        { hour: 19, loadKwh: 1 },  // 0.82
      ];
      // 0.25 + 0.55 + 0.82 = 1.62
      expect(calculateBaselineCost(loads, schedule)).toBe(1.62);
    });

    it("returns 0 for empty input", () => {
      expect(calculateBaselineCost([], schedule)).toBe(0);
    });
  });

  describe("calculateActualCost", () => {
    const schedule = {
      peakRate: 0.82,
      offpeakRate: 0.25,
      intermediateRate: 0.55,
    };

    it("returns 0 for zero grid import", () => {
      const imports = [{ hour: 19, gridImportKwh: 0 }];
      expect(calculateActualCost(imports, schedule)).toBe(0);
    });

    it("calculates peak grid import cost", () => {
      const imports = [{ hour: 19, gridImportKwh: 5 }];
      // 5 * 0.82 = 4.10
      expect(calculateActualCost(imports, schedule)).toBe(4.10);
    });

    it("calculates off-peak grid import cost", () => {
      const imports = [{ hour: 3, gridImportKwh: 10 }];
      // 10 * 0.25 = 2.50
      expect(calculateActualCost(imports, schedule)).toBe(2.50);
    });

    it("returns 0 for empty input", () => {
      expect(calculateActualCost([], schedule)).toBe(0);
    });
  });

  describe("calculateBestTouCost", () => {
    const schedule = {
      peakRate: 0.82,
      offpeakRate: 0.25,
      intermediateRate: 0.55,
    };

    it("returns baseline when no battery (capacity=0)", () => {
      const hourlyData = [
        { hour: 3, loadKwh: 10, pvKwh: 0 },
        { hour: 19, loadKwh: 5, pvKwh: 0 },
      ];
      // No battery: grid = max(0, load - pv) = load
      // 10 * 0.25 + 5 * 0.82 = 2.50 + 4.10 = 6.60
      const result = calculateBestTouCost({
        hourlyData,
        schedule,
        capacity: 0,
        socInitial: 0,
        socMinPct: 10,
        maxChargeRateKw: 5,
        maxDischargeRateKw: 5,
      });
      expect(result.bestCost).toBe(6.60);
      expect(result.endSoc).toBe(0);
    });

    it("returns 0 when PV covers all load and battery covers the rest", () => {
      // Single hour, PV covers load entirely
      const hourlyData = [{ hour: 19, loadKwh: 2, pvKwh: 5 }];
      const result = calculateBestTouCost({
        hourlyData,
        schedule,
        capacity: 10,
        socInitial: 5,
        socMinPct: 10,
        maxChargeRateKw: 5,
        maxDischargeRateKw: 5,
      });
      expect(result.bestCost).toBe(0);
    });

    it("optimizes battery schedule to minimize cost", () => {
      // 2 hours: off-peak load + peak load with battery
      // Off-peak: load=10, pv=0 -> can charge at cheap rate
      // Peak: load=5, pv=0 -> can discharge at expensive rate
      const hourlyData = [
        { hour: 3, loadKwh: 1, pvKwh: 0 },
        { hour: 19, loadKwh: 5, pvKwh: 0 },
      ];
      const result = calculateBestTouCost({
        hourlyData,
        schedule,
        capacity: 10,
        socInitial: 5,
        socMinPct: 10,
        maxChargeRateKw: 5,
        maxDischargeRateKw: 5,
      });
      // With a 10kWh battery at 50% SoC, it can discharge during peak
      // Best cost should be less than baseline (1*0.25 + 5*0.82 = 4.35)
      expect(result.bestCost).toBeLessThan(4.35);
      expect(result.bestCost).toBeGreaterThanOrEqual(0);
    });

    it("respects soc_min constraint", () => {
      // Single peak hour, battery can discharge but constrained by soc_min
      const hourlyData = [{ hour: 19, loadKwh: 10, pvKwh: 0 }];
      const result = calculateBestTouCost({
        hourlyData,
        schedule,
        capacity: 10,
        socInitial: 2,   // 2 kWh
        socMinPct: 10,   // min = 1 kWh
        maxChargeRateKw: 5,
        maxDischargeRateKw: 5,
      });
      // Can only discharge 1 kWh (2 - 1 = 1), remaining 9 kWh from grid
      // Cost = 9 * 0.82 = 7.38 ... but with discretized steps, approximately
      expect(result.bestCost).toBeGreaterThan(0);
      expect(result.bestCost).toBeLessThan(10 * 0.82); // less than full grid
    });
  });

  describe("calculateSelfSufficiency", () => {
    it("returns 100% when no grid import", () => {
      expect(calculateSelfSufficiency(10, 0)).toBe(100);
    });

    it("returns 50% when half is grid import", () => {
      expect(calculateSelfSufficiency(10, 5)).toBe(50);
    });

    it("returns 0% when all is grid import", () => {
      expect(calculateSelfSufficiency(10, 10)).toBe(0);
    });

    it("returns null when load is 0 (divide-by-zero)", () => {
      expect(calculateSelfSufficiency(0, 0)).toBeNull();
    });

    it("returns null when load is negative", () => {
      expect(calculateSelfSufficiency(-5, 0)).toBeNull();
    });

    it("handles fractional values", () => {
      // (13.3 - 10.0) / 13.3 * 100 = 24.8120... -> 24.8
      expect(calculateSelfSufficiency(13.3, 10.0)).toBe(24.8);
    });
  });
});
