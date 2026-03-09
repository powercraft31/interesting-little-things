import {
  parseGetReply,
  domainToProtocol,
  validateSchedule,
  ScheduleValidationError,
} from "../../src/iot-hub/handlers/schedule-translator";
import type {
  DomainSchedule,
  DomainSlot,
  ProtocolSchedule,
} from "../../src/iot-hub/handlers/schedule-translator";

// ─── Fixtures ───────────────────────────────────────────────────────────────

/** Valid 4-slot schedule covering [0, 1440) with all modes. */
const VALID_SCHEDULE: DomainSchedule = {
  socMinLimit: 10,
  socMaxLimit: 95,
  maxChargeCurrent: 100,
  maxDischargeCurrent: 100,
  gridImportLimitKw: 3000,
  slots: [
    { mode: "peak_valley_arbitrage", action: "charge", startMinute: 0, endMinute: 300 },
    { mode: "self_consumption", startMinute: 300, endMinute: 1020 },
    { mode: "peak_shaving", startMinute: 1020, endMinute: 1200 },
    { mode: "peak_valley_arbitrage", action: "discharge", allowExport: false, startMinute: 1200, endMinute: 1440 },
  ],
};

const VALID_PROTOCOL: ProtocolSchedule = {
  soc_min_limit: "10",
  soc_max_limit: "95",
  max_charge_current: "100",
  max_discharge_current: "100",
  grid_import_limit: "3000",
  slots: [
    { purpose: "tariff", direction: "charge", start: "0", end: "300" },
    { purpose: "self_consumption", start: "300", end: "1020" },
    { purpose: "peak_shaving", start: "1020", end: "1200" },
    { purpose: "tariff", direction: "discharge", export_policy: "forbid", start: "1200", end: "1440" },
  ],
};

// ─── Helper ─────────────────────────────────────────────────────────────────
function withSlots(slots: DomainSlot[]): DomainSchedule {
  return { ...VALID_SCHEDULE, slots };
}

function withField(overrides: Partial<DomainSchedule>): DomainSchedule {
  return { ...VALID_SCHEDULE, ...overrides };
}

// ─── Read Direction Tests ───────────────────────────────────────────────────
describe("ScheduleTranslator — parseGetReply (protocol → domain)", () => {
  it("translates a valid protocol schedule to domain model", () => {
    const domain = parseGetReply(VALID_PROTOCOL);
    expect(domain).not.toBeNull();
    expect(domain!.socMinLimit).toBe(10);
    expect(domain!.socMaxLimit).toBe(95);
    expect(domain!.maxChargeCurrent).toBe(100);
    expect(domain!.maxDischargeCurrent).toBe(100);
    expect(domain!.gridImportLimitKw).toBe(3000);
    expect(domain!.slots).toHaveLength(4);
  });

  it("translates self_consumption slot correctly", () => {
    const domain = parseGetReply(VALID_PROTOCOL);
    const slot = domain!.slots[1];
    expect(slot.mode).toBe("self_consumption");
    expect(slot.startMinute).toBe(300);
    expect(slot.endMinute).toBe(1020);
  });

  it("translates peak_shaving slot correctly", () => {
    const domain = parseGetReply(VALID_PROTOCOL);
    const slot = domain!.slots[2];
    expect(slot.mode).toBe("peak_shaving");
    expect(slot.startMinute).toBe(1020);
    expect(slot.endMinute).toBe(1200);
  });

  it("translates tariff+charge slot to peak_valley_arbitrage+charge", () => {
    const domain = parseGetReply(VALID_PROTOCOL);
    const slot = domain!.slots[0];
    expect(slot.mode).toBe("peak_valley_arbitrage");
    expect(slot.action).toBe("charge");
  });

  it("translates tariff+discharge+forbid correctly", () => {
    const domain = parseGetReply(VALID_PROTOCOL);
    const slot = domain!.slots[3];
    expect(slot.mode).toBe("peak_valley_arbitrage");
    expect(slot.action).toBe("discharge");
    expect(slot.allowExport).toBe(false);
  });

  it("translates tariff+discharge+allow correctly", () => {
    const proto: ProtocolSchedule = {
      ...VALID_PROTOCOL,
      slots: [
        { purpose: "tariff", direction: "discharge", export_policy: "allow", start: "0", end: "1440" },
      ],
    };
    const domain = parseGetReply(proto);
    const slot = domain!.slots[0];
    expect(slot.mode).toBe("peak_valley_arbitrage");
    expect(slot.action).toBe("discharge");
    expect(slot.allowExport).toBe(true);
  });

  it("returns null for null input", () => {
    expect(parseGetReply(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(parseGetReply(undefined)).toBeNull();
  });

  it("returns null if top-level fields are non-numeric", () => {
    const bad: ProtocolSchedule = {
      ...VALID_PROTOCOL,
      soc_min_limit: "abc",
    };
    expect(parseGetReply(bad)).toBeNull();
  });
});

// ─── Write Direction Tests ──────────────────────────────────────────────────
describe("ScheduleTranslator — domainToProtocol (domain → protocol)", () => {
  it("converts all numeric values to strings", () => {
    const proto = domainToProtocol(VALID_SCHEDULE);
    expect(proto.soc_min_limit).toBe("10");
    expect(proto.soc_max_limit).toBe("95");
    expect(proto.max_charge_current).toBe("100");
    expect(proto.max_discharge_current).toBe("100");
    expect(proto.grid_import_limit).toBe("3000");
  });

  it("converts slot start/end to strings", () => {
    const proto = domainToProtocol(VALID_SCHEDULE);
    expect(proto.slots[0].start).toBe("0");
    expect(proto.slots[0].end).toBe("300");
  });

  it("sets purpose=self_consumption for self_consumption mode", () => {
    const proto = domainToProtocol(VALID_SCHEDULE);
    expect(proto.slots[1].purpose).toBe("self_consumption");
    expect(proto.slots[1].direction).toBeUndefined();
  });

  it("sets purpose=peak_shaving for peak_shaving mode", () => {
    const proto = domainToProtocol(VALID_SCHEDULE);
    expect(proto.slots[2].purpose).toBe("peak_shaving");
  });

  it("sets purpose=tariff + direction=charge for valley charge", () => {
    const proto = domainToProtocol(VALID_SCHEDULE);
    expect(proto.slots[0].purpose).toBe("tariff");
    expect(proto.slots[0].direction).toBe("charge");
  });

  it("sets purpose=tariff + direction=discharge + export_policy for peak discharge", () => {
    const proto = domainToProtocol(VALID_SCHEDULE);
    expect(proto.slots[3].purpose).toBe("tariff");
    expect(proto.slots[3].direction).toBe("discharge");
    expect(proto.slots[3].export_policy).toBe("forbid");
  });

  it("sets export_policy=allow when allowExport=true", () => {
    const schedule = withSlots([
      { mode: "peak_valley_arbitrage", action: "discharge", allowExport: true, startMinute: 0, endMinute: 1440 },
    ]);
    const proto = domainToProtocol(schedule);
    expect(proto.slots[0].export_policy).toBe("allow");
  });
});

// ─── Bidirectional Round-Trip ───────────────────────────────────────────────
describe("ScheduleTranslator — round-trip", () => {
  it("domain → protocol → domain preserves all fields", () => {
    const proto = domainToProtocol(VALID_SCHEDULE);
    const roundTripped = parseGetReply(proto);

    expect(roundTripped).not.toBeNull();
    expect(roundTripped!.socMinLimit).toBe(VALID_SCHEDULE.socMinLimit);
    expect(roundTripped!.socMaxLimit).toBe(VALID_SCHEDULE.socMaxLimit);
    expect(roundTripped!.maxChargeCurrent).toBe(VALID_SCHEDULE.maxChargeCurrent);
    expect(roundTripped!.maxDischargeCurrent).toBe(VALID_SCHEDULE.maxDischargeCurrent);
    expect(roundTripped!.gridImportLimitKw).toBe(VALID_SCHEDULE.gridImportLimitKw);
    expect(roundTripped!.slots).toHaveLength(VALID_SCHEDULE.slots.length);

    for (let i = 0; i < VALID_SCHEDULE.slots.length; i++) {
      expect(roundTripped!.slots[i].mode).toBe(VALID_SCHEDULE.slots[i].mode);
      expect(roundTripped!.slots[i].startMinute).toBe(VALID_SCHEDULE.slots[i].startMinute);
      expect(roundTripped!.slots[i].endMinute).toBe(VALID_SCHEDULE.slots[i].endMinute);
    }
  });
});

// ─── Validation Tests ───────────────────────────────────────────────────────
describe("ScheduleTranslator — validateSchedule", () => {
  it("passes for a valid schedule", () => {
    expect(() => validateSchedule(VALID_SCHEDULE)).not.toThrow();
  });

  // ── socMinLimit ──
  it("throws when socMinLimit < 0", () => {
    expect(() => validateSchedule(withField({ socMinLimit: -1 }))).toThrow(
      ScheduleValidationError,
    );
  });

  it("throws when socMinLimit > 100", () => {
    expect(() => validateSchedule(withField({ socMinLimit: 101 }))).toThrow(
      ScheduleValidationError,
    );
  });

  it("throws when socMinLimit is not integer", () => {
    expect(() => validateSchedule(withField({ socMinLimit: 10.5 }))).toThrow(
      ScheduleValidationError,
    );
  });

  it("passes when socMinLimit = 0 (boundary)", () => {
    expect(() => validateSchedule(withField({ socMinLimit: 0 }))).not.toThrow();
  });

  // ── socMaxLimit ──
  it("throws when socMaxLimit < 0", () => {
    expect(() => validateSchedule(withField({ socMaxLimit: -1 }))).toThrow(
      ScheduleValidationError,
    );
  });

  it("throws when socMaxLimit > 100", () => {
    expect(() => validateSchedule(withField({ socMaxLimit: 101 }))).toThrow(
      ScheduleValidationError,
    );
  });

  it("passes when socMaxLimit = 100 (boundary)", () => {
    expect(() => validateSchedule(withField({ socMaxLimit: 100 }))).not.toThrow();
  });

  // ── socMin < socMax ──
  it("throws when socMinLimit >= socMaxLimit", () => {
    expect(() => validateSchedule(withField({ socMinLimit: 50, socMaxLimit: 50 }))).toThrow(
      ScheduleValidationError,
    );
  });

  it("throws when socMinLimit > socMaxLimit", () => {
    expect(() => validateSchedule(withField({ socMinLimit: 60, socMaxLimit: 50 }))).toThrow(
      ScheduleValidationError,
    );
  });

  it("passes when socMinLimit = 0, socMaxLimit = 1 (minimum valid gap)", () => {
    expect(() => validateSchedule(withField({ socMinLimit: 0, socMaxLimit: 1 }))).not.toThrow();
  });

  // ── maxChargeCurrent ──
  it("throws when maxChargeCurrent < 0", () => {
    expect(() => validateSchedule(withField({ maxChargeCurrent: -1 }))).toThrow(
      ScheduleValidationError,
    );
  });

  it("passes when maxChargeCurrent = 0 (boundary)", () => {
    expect(() => validateSchedule(withField({ maxChargeCurrent: 0 }))).not.toThrow();
  });

  it("throws when maxChargeCurrent is not integer", () => {
    expect(() => validateSchedule(withField({ maxChargeCurrent: 10.5 }))).toThrow(
      ScheduleValidationError,
    );
  });

  // ── maxDischargeCurrent ──
  it("throws when maxDischargeCurrent < 0", () => {
    expect(() => validateSchedule(withField({ maxDischargeCurrent: -1 }))).toThrow(
      ScheduleValidationError,
    );
  });

  it("passes when maxDischargeCurrent = 0 (boundary)", () => {
    expect(() => validateSchedule(withField({ maxDischargeCurrent: 0 }))).not.toThrow();
  });

  // ── gridImportLimitKw ──
  it("throws when gridImportLimitKw < 0", () => {
    expect(() => validateSchedule(withField({ gridImportLimitKw: -1 }))).toThrow(
      ScheduleValidationError,
    );
  });

  it("passes when gridImportLimitKw = 0 (boundary)", () => {
    expect(() => validateSchedule(withField({ gridImportLimitKw: 0 }))).not.toThrow();
  });

  // ── Empty slots ──
  it("throws when slots array is empty", () => {
    expect(() => validateSchedule(withSlots([]))).toThrow(ScheduleValidationError);
  });

  // ── slot.startMinute ──
  it("throws when slot.startMinute < 0", () => {
    expect(() =>
      validateSchedule(withSlots([
        { mode: "self_consumption", startMinute: -60, endMinute: 1440 },
      ])),
    ).toThrow(ScheduleValidationError);
  });

  it("throws when slot.startMinute > 1380", () => {
    expect(() =>
      validateSchedule(withSlots([
        { mode: "self_consumption", startMinute: 0, endMinute: 1380 },
        { mode: "self_consumption", startMinute: 1440, endMinute: 1440 },
      ])),
    ).toThrow(ScheduleValidationError);
  });

  it("throws when slot.startMinute is not multiple of 60", () => {
    expect(() =>
      validateSchedule(withSlots([
        { mode: "self_consumption", startMinute: 30, endMinute: 1440 },
      ])),
    ).toThrow(ScheduleValidationError);
  });

  it("passes when slot.startMinute = 0 (boundary)", () => {
    expect(() =>
      validateSchedule(withSlots([
        { mode: "self_consumption", startMinute: 0, endMinute: 1440 },
      ])),
    ).not.toThrow();
  });

  it("passes when slot.startMinute = 1380 (boundary)", () => {
    expect(() =>
      validateSchedule(withSlots([
        { mode: "self_consumption", startMinute: 0, endMinute: 1380 },
        { mode: "self_consumption", startMinute: 1380, endMinute: 1440 },
      ])),
    ).not.toThrow();
  });

  // ── slot.endMinute ──
  it("throws when slot.endMinute < 60", () => {
    expect(() =>
      validateSchedule(withSlots([
        { mode: "self_consumption", startMinute: 0, endMinute: 30 },
      ])),
    ).toThrow(ScheduleValidationError);
  });

  it("throws when slot.endMinute > 1440", () => {
    expect(() =>
      validateSchedule(withSlots([
        { mode: "self_consumption", startMinute: 0, endMinute: 1500 },
      ])),
    ).toThrow(ScheduleValidationError);
  });

  it("throws when slot.endMinute is not multiple of 60", () => {
    expect(() =>
      validateSchedule(withSlots([
        { mode: "self_consumption", startMinute: 0, endMinute: 90 },
      ])),
    ).toThrow(ScheduleValidationError);
  });

  it("throws when slot.endMinute <= slot.startMinute", () => {
    expect(() =>
      validateSchedule(withSlots([
        { mode: "self_consumption", startMinute: 300, endMinute: 300 },
      ])),
    ).toThrow(ScheduleValidationError);
  });

  it("passes when slot.endMinute = 60 (minimum valid)", () => {
    expect(() =>
      validateSchedule(withSlots([
        { mode: "self_consumption", startMinute: 0, endMinute: 60 },
        { mode: "self_consumption", startMinute: 60, endMinute: 1440 },
      ])),
    ).not.toThrow();
  });

  // ── Slot coverage ──
  it("throws when slots don't start at 0", () => {
    expect(() =>
      validateSchedule(withSlots([
        { mode: "self_consumption", startMinute: 60, endMinute: 1440 },
      ])),
    ).toThrow(ScheduleValidationError);
  });

  it("throws when slots don't end at 1440", () => {
    expect(() =>
      validateSchedule(withSlots([
        { mode: "self_consumption", startMinute: 0, endMinute: 1380 },
      ])),
    ).toThrow(ScheduleValidationError);
  });

  it("throws when there is a gap between slots", () => {
    expect(() =>
      validateSchedule(withSlots([
        { mode: "self_consumption", startMinute: 0, endMinute: 300 },
        { mode: "self_consumption", startMinute: 360, endMinute: 1440 },
      ])),
    ).toThrow(ScheduleValidationError);
  });

  it("throws when slots overlap", () => {
    expect(() =>
      validateSchedule(withSlots([
        { mode: "self_consumption", startMinute: 0, endMinute: 360 },
        { mode: "self_consumption", startMinute: 300, endMinute: 1440 },
      ])),
    ).toThrow(ScheduleValidationError);
  });

  // ── Single slot covering full day ──
  it("passes with single slot [0, 1440)", () => {
    expect(() =>
      validateSchedule(withSlots([
        { mode: "self_consumption", startMinute: 0, endMinute: 1440 },
      ])),
    ).not.toThrow();
  });

  // ── 24 hourly slots ──
  it("passes with 24 hourly slots covering full day", () => {
    const hourlySlots: DomainSlot[] = Array.from({ length: 24 }, (_, i) => ({
      mode: "self_consumption" as const,
      startMinute: i * 60,
      endMinute: (i + 1) * 60,
    }));
    expect(() => validateSchedule(withSlots(hourlySlots))).not.toThrow();
  });

  // ── Unordered slots should still validate correctly ──
  it("handles out-of-order slots (sorts internally)", () => {
    expect(() =>
      validateSchedule(withSlots([
        { mode: "self_consumption", startMinute: 300, endMinute: 1440 },
        { mode: "peak_valley_arbitrage", action: "charge", startMinute: 0, endMinute: 300 },
      ])),
    ).not.toThrow();
  });

  // ── All values must be strings in protocol ──
  it("domainToProtocol converts every value to string", () => {
    const proto = domainToProtocol(VALID_SCHEDULE);

    // Top-level fields
    expect(typeof proto.soc_min_limit).toBe("string");
    expect(typeof proto.soc_max_limit).toBe("string");
    expect(typeof proto.max_charge_current).toBe("string");
    expect(typeof proto.max_discharge_current).toBe("string");
    expect(typeof proto.grid_import_limit).toBe("string");

    // Slot fields
    for (const slot of proto.slots) {
      expect(typeof slot.start).toBe("string");
      expect(typeof slot.end).toBe("string");
      expect(typeof slot.purpose).toBe("string");
    }
  });

  // ── Error type ──
  it("throws ScheduleValidationError (not generic Error)", () => {
    try {
      validateSchedule(withField({ socMinLimit: -1 }));
      fail("Expected ScheduleValidationError");
    } catch (err) {
      expect(err).toBeInstanceOf(ScheduleValidationError);
      expect((err as ScheduleValidationError).name).toBe("ScheduleValidationError");
    }
  });
});
