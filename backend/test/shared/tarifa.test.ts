import {
  classifyHour,
  getRateForHour,
  calculateDailySavings,
  calculateOptimizationAlpha,
  calculateSelfConsumption,
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

  describe("calculateDailySavings", () => {
    const defaultSchedule = {
      peakRate: 0.82,
      offpeakRate: 0.25,
      intermediateRate: 0.55,
    };

    it("calculates peak discharge savings", () => {
      const hours = [{ hour: 19, chargeKwh: 0, dischargeKwh: 5 }];
      // 5 * 0.82 - 0 * 0.25 = 4.10
      expect(calculateDailySavings(hours, defaultSchedule)).toBe(4.10);
    });

    it("calculates off-peak charge cost", () => {
      const hours = [{ hour: 3, chargeKwh: 5, dischargeKwh: 0 }];
      // 0 - 5 * 0.25 = -1.25
      expect(calculateDailySavings(hours, defaultSchedule)).toBe(-1.25);
    });

    it("calculates net savings from charge + discharge cycle", () => {
      const hours = [
        { hour: 3, chargeKwh: 10, dischargeKwh: 0 },
        { hour: 19, chargeKwh: 0, dischargeKwh: 9 },
      ];
      // discharge: 9 * 0.82 = 7.38, charge: 10 * 0.25 = 2.50
      // net: 7.38 - 2.50 = 4.88
      expect(calculateDailySavings(hours, defaultSchedule)).toBe(4.88);
    });

    it("handles empty hours array", () => {
      expect(calculateDailySavings([], defaultSchedule)).toBe(0);
    });

    it("handles intermediate hour discharge", () => {
      const hours = [{ hour: 17, chargeKwh: 0, dischargeKwh: 5 }];
      // 5 * 0.55 = 2.75
      expect(calculateDailySavings(hours, defaultSchedule)).toBe(2.75);
    });
  });

  describe("calculateOptimizationAlpha", () => {
    const schedule = {
      peakRate: 0.82,
      offpeakRate: 0.25,
      intermediateRate: null,
    };

    it("returns 100% for perfect single cycle", () => {
      // theoretical_max = 10 * (0.82 - 0.25) * 1 = 5.70
      // actual = 5.70 -> alpha = 100%
      expect(calculateOptimizationAlpha(5.70, 10, schedule, 1)).toBe(100);
    });

    it("returns 50% for half capacity", () => {
      expect(calculateOptimizationAlpha(2.85, 10, schedule, 1)).toBe(50);
    });

    it("returns 0 when capacity is 0", () => {
      expect(calculateOptimizationAlpha(5, 0, schedule, 1)).toBe(0);
    });

    it("returns 0 when spread is 0", () => {
      const flatSchedule = {
        peakRate: 0.50,
        offpeakRate: 0.50,
        intermediateRate: null,
      };
      expect(calculateOptimizationAlpha(5, 10, flatSchedule, 1)).toBe(0);
    });

    it("scales with days", () => {
      // theoretical_max for 30 days = 10 * 0.57 * 30 = 171
      // alpha = 85.5 / 171 * 100 = 50%
      expect(calculateOptimizationAlpha(85.5, 10, schedule, 30)).toBe(50);
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

    it("returns 0 when PV is 0", () => {
      expect(calculateSelfConsumption(0, 0)).toBe(0);
    });

    it("handles fractional values", () => {
      // (15.6 - 8.6) / 15.6 * 100 = 44.871... -> 44.9
      expect(calculateSelfConsumption(15.6, 8.6)).toBe(44.9);
    });
  });
});
