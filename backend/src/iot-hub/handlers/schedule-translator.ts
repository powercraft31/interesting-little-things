/**
 * PR6: ScheduleTranslator — Bidirectional translation + strong validation
 *
 * Domain Model ↔ Protocol Format for battery_schedule configuration.
 *
 * IRON RULE: Validation failure = throw Error + refuse MQTT publish.
 * ABSOLUTELY NO silent degradation. Dirty data MUST NOT reach hardware.
 */

import { formatProtocolTimestamp } from "../../shared/protocol-time";

// ─── Domain Model Types ─────────────────────────────────────────────────────

export interface DomainSchedule {
  readonly socMinLimit: number;
  readonly socMaxLimit: number;
  readonly maxChargeCurrent: number;
  readonly maxDischargeCurrent: number;
  /** V2.4-preferred field name. Value is actually watts, not kW. */
  readonly gridImportLimitW?: number;
  /** @deprecated Backward-compatible alias retained for BFF/tests. */
  readonly gridImportLimitKw?: number;
  readonly slots: ReadonlyArray<DomainSlot>;
}

export interface DomainSlot {
  readonly mode: "self_consumption" | "peak_valley_arbitrage" | "peak_shaving";
  readonly action?: "charge" | "discharge" | "neutral";
  readonly allowExport?: boolean;
  readonly startMinute: number;
  readonly endMinute: number;
}

// ─── Protocol Types ─────────────────────────────────────────────────────────

export interface ProtocolSchedule {
  readonly soc_min_limit: string;
  readonly soc_max_limit: string;
  readonly max_charge_current: string;
  readonly max_discharge_current: string;
  readonly grid_import_limit: string;
  readonly slots: ReadonlyArray<ProtocolSlot>;
}

export interface ProtocolSlot {
  readonly purpose: string;
  readonly direction?: string;
  readonly export_policy?: string;
  readonly start: string;
  readonly end: string;
}

// ─── Custom Error ───────────────────────────────────────────────────────────

export class ScheduleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScheduleValidationError";
  }
}

// ─── Read Direction: Protocol → Domain ──────────────────────────────────────

/**
 * Parse a battery_schedule from config/get_reply protocol format → domain model.
 * Returns null if the input is missing or structurally invalid.
 */
export function parseGetReply(
  batterySchedule: ProtocolSchedule | null | undefined,
): DomainSchedule | null {
  if (!batterySchedule) return null;

  const socMinLimit = parseInt(batterySchedule.soc_min_limit, 10);
  const socMaxLimit = parseInt(batterySchedule.soc_max_limit, 10);
  const maxChargeCurrent = parseInt(batterySchedule.max_charge_current, 10);
  const maxDischargeCurrent = parseInt(batterySchedule.max_discharge_current, 10);
  const gridImportLimitW = parseInt(batterySchedule.grid_import_limit, 10);

  if (
    [socMinLimit, socMaxLimit, maxChargeCurrent, maxDischargeCurrent, gridImportLimitW]
      .some((v) => !Number.isFinite(v))
  ) {
    return null;
  }

  const slots: DomainSlot[] = (batterySchedule.slots ?? []).map(
    (s) => translateSlotToDomain(s),
  );

  return {
    socMinLimit,
    socMaxLimit,
    maxChargeCurrent,
    maxDischargeCurrent,
    gridImportLimitW,
    gridImportLimitKw: gridImportLimitW,
    slots,
  };
}

/** Translate a single protocol slot → domain slot. */
function translateSlotToDomain(slot: ProtocolSlot): DomainSlot {
  const startMinute = parseInt(slot.start, 10);
  const endMinute = parseInt(slot.end, 10);

  if (slot.purpose === "self_consumption") {
    return { mode: "self_consumption", startMinute, endMinute };
  }

  if (slot.purpose === "peak_shaving") {
    return { mode: "peak_shaving", startMinute, endMinute };
  }

  // purpose === "tariff"
  if (slot.direction === "charge") {
    return {
      mode: "peak_valley_arbitrage",
      action: "charge",
      startMinute,
      endMinute,
    };
  }

  // tariff + discharge
  return {
    mode: "peak_valley_arbitrage",
    action: "discharge",
    allowExport: slot.export_policy === "allow",
    startMinute,
    endMinute,
  };
}

// ─── Write Direction: Domain → Protocol ─────────────────────────────────────

/**
 * Build the full config/set MQTT message payload from a domain schedule.
 */
export function buildConfigSetPayload(
  clientId: string,
  schedule: DomainSchedule,
  messageId?: string,
): Record<string, unknown> {
  const protocolSchedule = domainToProtocol(schedule);
  const mid = messageId ?? String(Date.now());
  const now = formatProtocolTimestamp();

  return {
    DS: 0,
    ackFlag: 0,
    data: {
      configname: "battery_schedule",
      battery_schedule: protocolSchedule,
    },
    clientId,
    deviceName: "EMS_N2",
    productKey: "ems",
    messageId: mid,
    timeStamp: now,
  };
}

/**
 * Convert domain schedule to protocol format.
 * All numeric values are converted to strings per protocol requirement.
 */
export function domainToProtocol(schedule: DomainSchedule): ProtocolSchedule {
  return {
    soc_min_limit: String(schedule.socMinLimit),
    soc_max_limit: String(schedule.socMaxLimit),
    max_charge_current: String(schedule.maxChargeCurrent),
    max_discharge_current: String(schedule.maxDischargeCurrent),
    grid_import_limit: String(schedule.gridImportLimitW ?? schedule.gridImportLimitKw ?? 0),
    slots: schedule.slots.map((s) => translateSlotToProtocol(s)),
  };
}

/** Translate a single domain slot → protocol slot. */
function translateSlotToProtocol(slot: DomainSlot): ProtocolSlot {
  const base = {
    start: String(slot.startMinute),
    end: String(slot.endMinute),
  };

  if (slot.mode === "self_consumption") {
    return { ...base, purpose: "self_consumption" };
  }

  if (slot.mode === "peak_shaving") {
    return { ...base, purpose: "peak_shaving" };
  }

  // peak_valley_arbitrage
  if (slot.action === "charge") {
    return { ...base, purpose: "tariff", direction: "charge" };
  }

  // discharge
  return {
    ...base,
    purpose: "tariff",
    direction: "discharge",
    export_policy: slot.allowExport ? "allow" : "forbid",
  };
}

// ─── Validation (Hard Crash) ────────────────────────────────────────────────

/**
 * Validate a domain schedule. Throws ScheduleValidationError on ANY failure.
 * ABSOLUTELY NO silent degradation. If this throws, DO NOT publish.
 */
export function validateSchedule(schedule: DomainSchedule): void {
  // ── Top-level field validation ──

  assertInt("socMinLimit", schedule.socMinLimit, 0, 100);
  assertInt("socMaxLimit", schedule.socMaxLimit, 0, 100);

  if (schedule.socMinLimit >= schedule.socMaxLimit) {
    throw new ScheduleValidationError(
      `socMinLimit (${schedule.socMinLimit}) must be < socMaxLimit (${schedule.socMaxLimit})`,
    );
  }

  assertNonNegativeInt("maxChargeCurrent", schedule.maxChargeCurrent);
  assertNonNegativeInt("maxDischargeCurrent", schedule.maxDischargeCurrent);
  assertNonNegativeInt(
    "gridImportLimitW",
    schedule.gridImportLimitW ?? schedule.gridImportLimitKw ?? 0,
  );

  // ── Slot validation ──

  if (!schedule.slots || schedule.slots.length === 0) {
    throw new ScheduleValidationError("slots array must not be empty");
  }

  for (let i = 0; i < schedule.slots.length; i++) {
    const slot = schedule.slots[i];
    const prefix = `slots[${i}]`;

    // start: 0-1380, multiple of 60
    if (!Number.isInteger(slot.startMinute) || slot.startMinute < 0 || slot.startMinute > 1380) {
      throw new ScheduleValidationError(
        `${prefix}.startMinute (${slot.startMinute}) must be integer 0-1380`,
      );
    }
    if (slot.startMinute % 60 !== 0) {
      throw new ScheduleValidationError(
        `${prefix}.startMinute (${slot.startMinute}) must be a multiple of 60`,
      );
    }

    // end: 60-1440, multiple of 60, > start
    if (!Number.isInteger(slot.endMinute) || slot.endMinute < 60 || slot.endMinute > 1440) {
      throw new ScheduleValidationError(
        `${prefix}.endMinute (${slot.endMinute}) must be integer 60-1440`,
      );
    }
    if (slot.endMinute % 60 !== 0) {
      throw new ScheduleValidationError(
        `${prefix}.endMinute (${slot.endMinute}) must be a multiple of 60`,
      );
    }
    if (slot.endMinute <= slot.startMinute) {
      throw new ScheduleValidationError(
        `${prefix}.endMinute (${slot.endMinute}) must be > startMinute (${slot.startMinute})`,
      );
    }
  }

  // ── Slot coverage validation: must cover [0, 1440) exactly ──

  const sorted = [...schedule.slots].sort((a, b) => a.startMinute - b.startMinute);

  // First slot must start at 0
  if (sorted[0].startMinute !== 0) {
    throw new ScheduleValidationError(
      `Slots must start at minute 0, but first slot starts at ${sorted[0].startMinute}`,
    );
  }

  // Last slot must end at 1440
  if (sorted[sorted.length - 1].endMinute !== 1440) {
    throw new ScheduleValidationError(
      `Slots must end at minute 1440, but last slot ends at ${sorted[sorted.length - 1].endMinute}`,
    );
  }

  // Check adjacency: no gaps, no overlaps
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];

    if (curr.startMinute < prev.endMinute) {
      throw new ScheduleValidationError(
        `Slot overlap detected: slots[${i - 1}] ends at ${prev.endMinute} but slots[${i}] starts at ${curr.startMinute}`,
      );
    }
    if (curr.startMinute > prev.endMinute) {
      throw new ScheduleValidationError(
        `Gap detected between slots: ${prev.endMinute} to ${curr.startMinute}`,
      );
    }
  }
}

// ─── Assertion Helpers ──────────────────────────────────────────────────────

function assertInt(name: string, value: number, min: number, max: number): void {
  if (!Number.isInteger(value)) {
    throw new ScheduleValidationError(`${name} (${value}) must be an integer`);
  }
  if (value < min || value > max) {
    throw new ScheduleValidationError(
      `${name} (${value}) must be between ${min} and ${max}`,
    );
  }
}

function assertNonNegativeInt(name: string, value: number): void {
  if (!Number.isInteger(value)) {
    throw new ScheduleValidationError(`${name} (${value}) must be an integer`);
  }
  if (value < 0) {
    throw new ScheduleValidationError(`${name} (${value}) must be >= 0`);
  }
}
