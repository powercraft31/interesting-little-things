import { Pool } from "pg";
import type {
  SolfacilMessage,
  SolfacilListItem,
} from "../../shared/types/solfacil-protocol";
import type { ParsedTelemetry } from "../../shared/types/telemetry";
import { DeviceAssetCache } from "./device-asset-cache";
import { MessageBuffer } from "./message-buffer";

/**
 * FragmentAssembler — Per-gateway fragment accumulator for Solfacil Protocol v1.2.
 *
 * Each gateway sends 5 MQTT messages per telemetry cycle (~800ms window):
 *   MSG#1: emsList  (EMS health)
 *   MSG#2: dido     (digital IO)
 *   MSG#3: meterList (single-phase meter)
 *   MSG#4: meterList (three-phase meter)
 *   MSG#5: batList+gridList+loadList+flloadList+pvList (core telemetry)
 *
 * This class accumulates fragments by clientId and flushes after:
 *   - Receiving MSG#5 (core) → immediate flush
 *   - 3s debounce timeout → flush without core (only writes ems_health)
 */

interface Accumulator {
  readonly clientId: string;
  readonly recordedAt: Date;
  ems?: SolfacilListItem;
  dido?: {
    readonly do: ReadonlyArray<{
      id: string;
      type: string;
      value: string;
      gpionum?: string;
    }>;
    readonly di?: ReadonlyArray<{
      id: string;
      type: string;
      value: string;
      gpionum?: string;
    }>;
  };
  meters: SolfacilListItem[];
  core?: Record<string, unknown>;
  timer: NodeJS.Timeout | null;
}

/** Shared cache + buffer instances, lazily initialized per pool. */
const instanceMap = new WeakMap<
  Pool,
  { cache: DeviceAssetCache; buffer: MessageBuffer }
>();

function getInstances(pool: Pool): {
  cache: DeviceAssetCache;
  buffer: MessageBuffer;
} {
  let instances = instanceMap.get(pool);
  if (!instances) {
    instances = {
      cache: new DeviceAssetCache(pool),
      buffer: new MessageBuffer(pool, 2000),
    };
    instanceMap.set(pool, instances);
  }
  return instances;
}

export class FragmentAssembler {
  private readonly accumulators = new Map<string, Accumulator>();

  constructor(
    private readonly pool: Pool,
    private readonly debounceMs: number = 3000,
  ) {}

  /**
   * Receive a raw MQTT message, classify by content, and accumulate.
   * If the message contains batList (core/MSG#5), triggers immediate flush.
   */
  receive(clientId: string, payload: SolfacilMessage): void {
    const data = payload.data;
    const recordedAt = new Date(parseInt(payload.timeStamp, 10));
    const acc = this.getOrCreateAccumulator(clientId, recordedAt);

    const isCoreMessage = this.classifyAndAccumulate(acc, data);

    if (isCoreMessage) {
      // MSG#5 (core) arrived → immediate flush
      this.clearTimer(acc);
      this.flushAsync(clientId);
    } else {
      // Reset debounce timer
      this.resetTimer(clientId, acc);
    }
  }

  /** Clean up all timers (for graceful shutdown / test teardown). */
  destroy(): void {
    for (const [, acc] of this.accumulators) {
      this.clearTimer(acc);
    }
    this.accumulators.clear();
  }

  private classifyAndAccumulate(
    acc: Accumulator,
    data: Record<string, unknown>,
  ): boolean {
    // Process ALL fields in a single message (not early-return).
    // This handles both fragmented (v1.2) and combined (v1.1) payloads.
    let isCoreMessage = false;

    if (data.emsList) {
      const emsList = data.emsList as SolfacilListItem[];
      if (emsList.length > 0) {
        acc.ems = emsList[0];
      }
    }

    if (data.dido) {
      acc.dido = data.dido as Accumulator["dido"];
    }

    if (data.meterList) {
      const meters = data.meterList as SolfacilListItem[];
      // Append — may receive multiple meterList messages (single + three phase)
      acc.meters = [...acc.meters, ...meters];
    }

    if (data.batList) {
      // Core message (MSG#5) — contains batList + gridList + loadList + flloadList + pvList
      acc.core = data;
      isCoreMessage = true;
    }

    return isCoreMessage;
  }

  private getOrCreateAccumulator(
    clientId: string,
    recordedAt: Date,
  ): Accumulator {
    const existing = this.accumulators.get(clientId);
    if (existing) return existing;

    const acc: Accumulator = {
      clientId,
      recordedAt,
      meters: [],
      timer: null,
    };
    this.accumulators.set(clientId, acc);
    return acc;
  }

  private resetTimer(clientId: string, acc: Accumulator): void {
    this.clearTimer(acc);
    acc.timer = setTimeout(() => this.flushAsync(clientId), this.debounceMs);
  }

  private clearTimer(acc: Accumulator): void {
    if (acc.timer) {
      clearTimeout(acc.timer);
      acc.timer = null;
    }
  }

  private flushAsync(clientId: string): void {
    // Fire-and-forget async flush with error logging
    this.mergeAndPersist(clientId).catch((err) => {
      console.error(`[FragmentAssembler] Flush error for ${clientId}:`, err);
    });
  }

  private async mergeAndPersist(clientId: string): Promise<void> {
    const acc = this.accumulators.get(clientId);
    if (!acc) return;

    // Remove accumulator immediately to prevent double-flush
    this.accumulators.delete(clientId);

    // Step 1: Write ems_health to gateways (always, even without core)
    if (acc.ems) {
      await this.writeEmsHealth(clientId, acc.ems, acc.recordedAt);
      await this.pool.query("SELECT pg_notify('gateway_health', $1)", [
        clientId,
      ]);
    }

    // Step 2: If core is present, build full telemetry and write
    if (acc.core) {
      await this.writeTelemetry(clientId, acc);
    } else if (acc.ems || acc.meters.length > 0) {
      console.warn(
        `[FragmentAssembler] ${clientId}: No core (MSG#5) in cycle. ` +
          `Wrote ems_health only. fragments: ems=${!!acc.ems}, dido=${!!acc.dido}, meters=${acc.meters.length}`,
      );
    }
  }

  private async writeEmsHealth(
    clientId: string,
    ems: SolfacilListItem,
    recordedAt: Date,
  ): Promise<void> {
    const healthJson = JSON.stringify(ems.properties);
    await this.pool.query(
      `UPDATE gateways
       SET ems_health = $1::jsonb,
           ems_health_at = $2,
           updated_at = NOW()
       WHERE gateway_id = $3`,
      [healthJson, recordedAt, clientId],
    );
  }

  private async writeTelemetry(
    clientId: string,
    acc: Accumulator,
  ): Promise<void> {
    const parsed = parseTelemetryPayload(
      clientId,
      acc.recordedAt,
      acc.core!,
      acc.dido,
      acc.meters,
      acc.ems,
    );
    if (!parsed) return;

    const { cache, buffer } = getInstances(this.pool);
    const assetId = await cache.resolve(parsed.deviceSn);
    if (!assetId) {
      console.warn(`[FragmentAssembler] Unknown device: ${parsed.deviceSn}`);
      return;
    }

    buffer.enqueue(assetId, parsed);
    await this.updateDeviceState(assetId, parsed);
    await this.pool.query("SELECT pg_notify('telemetry_update', $1)", [
      clientId,
    ]);
  }

  private async updateDeviceState(
    assetId: string,
    t: ParsedTelemetry,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO device_state
         (asset_id, battery_soc, battery_power, pv_power, grid_power_kw, load_power, is_online, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, true, NOW())
       ON CONFLICT (asset_id) DO UPDATE SET
         battery_soc    = EXCLUDED.battery_soc,
         battery_power  = EXCLUDED.battery_power,
         pv_power       = EXCLUDED.pv_power,
         grid_power_kw  = EXCLUDED.grid_power_kw,
         load_power     = EXCLUDED.load_power,
         is_online      = true,
         updated_at     = NOW()`,
      [
        assetId,
        t.batterySoc,
        t.batteryPowerKw,
        t.pvPowerKw,
        t.gridPowerKw,
        t.loadPowerKw,
      ],
    );
  }
}

/**
 * Pure function: parse a complete telemetry data object into ParsedTelemetry.
 * Shared by live FragmentAssembler (writeTelemetry) and backfill MissedDataHandler.
 * Returns null if no batList found (safety).
 */
export function parseTelemetryPayload(
  clientId: string,
  recordedAt: Date,
  data: Record<string, unknown>,
  dido?: {
    readonly do: ReadonlyArray<{
      id: string;
      type: string;
      value: string;
      gpionum?: string;
    }>;
    readonly di?: ReadonlyArray<{
      id: string;
      type: string;
      value: string;
      gpionum?: string;
    }>;
  },
  meters?: SolfacilListItem[],
  ems?: SolfacilListItem,
): ParsedTelemetry | null {
  const typed = data as {
    batList?: SolfacilListItem[];
    pvList?: SolfacilListItem[];
    gridList?: SolfacilListItem[];
    loadList?: SolfacilListItem[];
    flloadList?: SolfacilListItem[];
  };

  const bat = typed.batList?.[0];
  if (!bat) return null;

  const pv = findPvSummary(typed.pvList);
  const pv1 = findPvMppt(typed.pvList, "pv1");
  const pv2 = findPvMppt(typed.pvList, "pv2");
  const grid = typed.gridList?.[0];
  const load = typed.loadList?.[0];
  const flload = typed.flloadList?.[0];

  const bp = bat.properties;
  const gp = grid?.properties;
  const lp = load?.properties;
  const flp = flload?.properties;
  const pvp = pv?.properties;

  const do0 = dido?.do.find((d) => d.id === "DO0");
  const do1 = dido?.do.find((d) => d.id === "DO1");

  const telemetryExtra = buildTelemetryExtra(
    grid,
    load,
    flload,
    pv1,
    pv2,
    meters,
    dido,
    ems,
  );

  return {
    clientId,
    deviceSn: bat.deviceSn,
    recordedAt,

    batterySoc: safeFloat(bp.total_bat_soc),                               // ×1
    batteryPowerKw: scalePowerKw(bp.total_bat_power),                      // W → kW
    dailyChargeKwh: scaleEnergyKwh(bp.total_bat_dailyChargedEnergy),       // ×0.1 → kWh
    dailyDischargeKwh: scaleEnergyKwh(bp.total_bat_dailyDischargedEnergy), // ×0.1 → kWh

    batterySoh: safeFloat(bp.total_bat_soh),                               // ×1
    batteryVoltage: scaleVoltage(bp.total_bat_vlotage),                    // ×0.1 → V
    batteryCurrent: scaleCurrent(bp.total_bat_current),                    // ×0.1 → A
    batteryTemperature: scaleTemp(bp.total_bat_temperature),               // ×0.1 → ℃
    maxChargeVoltage: scaleVoltage(bp.total_bat_maxChargeVoltage),         // ×0.1 → V
    maxChargeCurrent: scaleCurrent(bp.total_bat_maxChargeCurrent),         // ×0.1 → A
    maxDischargeCurrent: scaleCurrent(bp.total_bat_maxDischargeCurrent),   // ×0.1 → A
    totalChargeKwh: scaleEnergyKwh(bp.total_bat_totalChargedEnergy),       // ×0.1 → kWh
    totalDischargeKwh: scaleEnergyKwh(bp.total_bat_totalDischargedEnergy), // ×0.1 → kWh

    gridPowerKw: scalePowerKw(gp?.grid_totalActivePower),                  // W → kW
    gridDailyBuyKwh: scaleEnergyKwh(gp?.grid_dailyBuyEnergy),             // ×0.1 → kWh
    gridDailySellKwh: scaleEnergyKwh(gp?.grid_dailySellEnergy),           // ×0.1 → kWh

    pvPowerKw: scalePowerKw(pvp?.pv_totalPower),                           // W → kW
    pvDailyEnergyKwh: scaleEnergyKwh(pvp?.pv_dailyEnergy),                // ×0.1 → kWh

    loadPowerKw: scalePowerKw(lp?.load1_totalPower),                       // W → kW

    flloadPowerKw: scalePowerKw(flp?.flload_totalPower),                   // W → kW

    do0Active: do0?.value === "1",
    do1Active: do1?.value === "1",

    inverterTemp: scaleTemp(gp?.grid_temp),                                // ×0.1 → ℃
    pvTotalEnergyKwh: scaleEnergyKwh(pvp?.pv_totalEnergy),                // ×0.1 → kWh
    pv1Voltage: scaleVoltage(pv1?.properties.pv1_voltage),                 // ×0.1 → V
    pv1Current: scaleCurrent(pv1?.properties.pv1_current),                 // ×0.1 → A
    pv1Power: scalePowerKw(pv1?.properties.pv1_power),                     // W → kW
    pv2Voltage: scaleVoltage(pv2?.properties.pv2_voltage),                 // ×0.1 → V
    pv2Current: scaleCurrent(pv2?.properties.pv2_current),                 // ×0.1 → A
    pv2Power: scalePowerKw(pv2?.properties.pv2_power),                     // W → kW

    telemetryExtra,
  };
}

/** Build JSONB telemetry_extra from per-phase and meter data. */
function buildTelemetryExtra(
  grid?: SolfacilListItem,
  load?: SolfacilListItem,
  flload?: SolfacilListItem,
  pv1?: SolfacilListItem,
  pv2?: SolfacilListItem,
  meters?: SolfacilListItem[],
  dido?: {
    readonly do: ReadonlyArray<{
      id: string;
      type: string;
      value: string;
      gpionum?: string;
    }>;
    readonly di?: ReadonlyArray<{
      id: string;
      type: string;
      value: string;
      gpionum?: string;
    }>;
  },
  ems?: SolfacilListItem,
): Record<string, Record<string, number>> | null {
  const extra: Record<string, Record<string, number>> = {};
  let hasData = false;

  if (grid?.properties) {
    const g = grid.properties;
    extra.grid = {
      volt_a: scaleVoltage(g.grid_voltA),
      volt_b: scaleVoltage(g.grid_voltB),
      volt_c: scaleVoltage(g.grid_voltC),
      current_a: scaleCurrent(g.grid_currentA),
      current_b: scaleCurrent(g.grid_currentB),
      current_c: scaleCurrent(g.grid_currentC),
      active_power_a: scalePowerW(g.grid_activePowerA),
      active_power_b: scalePowerW(g.grid_activePowerB),
      active_power_c: scalePowerW(g.grid_activePowerC),
      reactive_power_a: scalePowerW(g.grid_reactivePowerA),
      reactive_power_b: scalePowerW(g.grid_reactivePowerB),
      reactive_power_c: scalePowerW(g.grid_reactivePowerC),
      total_reactive_power: scalePowerW(g.grid_totalReactivePower),
      apparent_power_a: scalePowerW(g.grid_apparentPowerA),
      apparent_power_b: scalePowerW(g.grid_apparentPowerB),
      apparent_power_c: scalePowerW(g.grid_apparentPowerC),
      total_apparent_power: scalePowerW(g.grid_totalApparentPower),
      factor_a: safeFloat(g.grid_factorA),
      factor_b: safeFloat(g.grid_factorB),
      factor_c: safeFloat(g.grid_factorC),
      frequency: scaleFrequency(g.grid_frequency),
      total_buy_kwh: scaleEnergyKwh(g.grid_totalBuyEnergy),
      total_sell_kwh: scaleEnergyKwh(g.grid_totalSellEnergy),
    };
    hasData = true;
  }

  if (load?.properties) {
    const l = load.properties;
    extra.load = {
      volt_a: scaleVoltage(l.load1_voltA),
      volt_b: scaleVoltage(l.load1_voltB),
      volt_c: scaleVoltage(l.load1_voltC),
      current_a: scaleCurrent(l.load1_currentA),
      current_b: scaleCurrent(l.load1_currentB),
      current_c: scaleCurrent(l.load1_currentC),
      active_power_a: scalePowerW(l.load1_activePowerA),
      active_power_b: scalePowerW(l.load1_activePowerB),
      active_power_c: scalePowerW(l.load1_activePowerC),
      frequency_a: scaleFrequency(l.load1_frequencyA),
      frequency_b: scaleFrequency(l.load1_frequencyB),
      frequency_c: scaleFrequency(l.load1_frequencyC),
    };
    hasData = true;
  }

  if (flload?.properties) {
    const f = flload.properties;
    extra.flload = {
      active_power_a: scalePowerW(f.flload_activePowerA),
      active_power_b: scalePowerW(f.flload_activePowerB),
      active_power_c: scalePowerW(f.flload_activePowerC),
      daily_energy_kwh: scaleEnergyKwh(f.flload_dailyEnergy),
    };
    hasData = true;
  }

  if (pv1?.properties || pv2?.properties) {
    extra.pv = {};
    if (pv1?.properties) {
      extra.pv.pv1_voltage = scaleVoltage(pv1.properties.pv1_voltage);
      extra.pv.pv1_current = scaleCurrent(pv1.properties.pv1_current);
      extra.pv.pv1_power = scalePowerW(pv1.properties.pv1_power);
    }
    if (pv2?.properties) {
      extra.pv.pv2_voltage = scaleVoltage(pv2.properties.pv2_voltage);
      extra.pv.pv2_current = scaleCurrent(pv2.properties.pv2_current);
      extra.pv.pv2_power = scalePowerW(pv2.properties.pv2_power);
    }
    hasData = true;
  }

  if (meters && meters.length > 0) {
    for (const meter of meters) {
      const m = meter.properties;
      const brand = meter.deviceBrand ?? "";
      const isSingle = brand.toLowerCase().includes("single");
      const key = isSingle ? "meter_single" : "meter_three";

      extra[key] = {
        volt_a: scaleVoltage(m.grid_voltA),
        volt_b: scaleVoltage(m.grid_voltB),
        volt_c: scaleVoltage(m.grid_voltC),
        line_ab_volt: scaleVoltage(m.grid_lineABVolt),
        line_bc_volt: scaleVoltage(m.grid_lineBCVolt),
        line_ca_volt: scaleVoltage(m.grid_lineCAVolt),
        current_a: scaleCurrent(m.grid_currentA),
        current_b: scaleCurrent(m.grid_currentB),
        current_c: scaleCurrent(m.grid_currentC),
        active_power_a: scalePowerW(m.grid_activePowerA),
        active_power_b: scalePowerW(m.grid_activePowerB),
        active_power_c: scalePowerW(m.grid_activePowerC),
        total_active_power: scalePowerW(m.grid_totalActivePower),
        reactive_power_a: scalePowerW(m.grid_reactivePowerA),
        reactive_power_b: scalePowerW(m.grid_reactivePowerB),
        reactive_power_c: scalePowerW(m.grid_reactivePowerC),
        total_reactive_power: scalePowerW(m.grid_totalReactivePower),
        factor: safeFloat(m.grid_factor),
        factor_a: safeFloat(m.grid_factorA),
        factor_b: safeFloat(m.grid_factorB),
        factor_c: safeFloat(m.grid_factorC),
        frequency: scaleFrequency(m.grid_frequency),
        positive_energy: scaleEnergyKwh(m.grid_positiveEnergy),
        positive_energy_a: scaleEnergyKwh(m.grid_positiveEnergyA),
        positive_energy_b: scaleEnergyKwh(m.grid_positiveEnergyB),
        positive_energy_c: scaleEnergyKwh(m.grid_positiveEnergyC),
        net_forward_energy: scaleEnergyKwh(m.grid_netForwardActiveEnergy),
        negative_energy_a: scaleEnergyKwh(m.grid_negativeEnergyA),
        negative_energy_b: scaleEnergyKwh(m.grid_negativeEnergyB),
        negative_energy_c: scaleEnergyKwh(m.grid_negativeEnergyC),
        net_reverse_energy: scaleEnergyKwh(m.grid_netReverseActiveEnergy),
      };
      hasData = true;
    }
  }

  if (dido?.di && dido.di.length > 0) {
    extra.dido = {};
    for (const di of dido.di) {
      const key = di.id.toLowerCase();
      extra.dido[key] = safeFloat(di.value);
    }
    hasData = true;
  }

  if (ems?.properties) {
    const e = ems.properties;
    extra.ems_health = {
      wifi_signal_dbm: safeFloat(e.wifi_signal_dbm),
      uptime_seconds: safeFloat(e.uptime_seconds),
    };
    hasData = true;
  }

  return hasData ? extra : null;
}

/** Find the PV summary item (name="pv") from pvList. */
function findPvSummary(
  pvList?: SolfacilListItem[],
): SolfacilListItem | undefined {
  if (!pvList?.length) return undefined;
  return pvList.find((p) => p.name === "pv") ?? pvList[0];
}

/** Find a specific MPPT item (name="pv1" or "pv2") from pvList. */
function findPvMppt(
  pvList?: SolfacilListItem[],
  name?: string,
): SolfacilListItem | undefined {
  if (!pvList?.length || !name) return undefined;
  return pvList.find((p) => p.name === name);
}

/** Safe parseFloat: returns 0 for undefined/null/empty/NaN/Infinity values. */
function safeFloat(val: string | undefined): number {
  if (val === undefined || val === null || val === "") return 0;
  const n = parseFloat(val);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Protocol v1.8 scaling helpers.
 * All raw fields are integer strings; cloud side applies the scale factor.
 */
/** Voltage (V): raw × 0.1 */
function scaleVoltage(val: string | undefined): number {
  return safeFloat(val) * 0.1;
}
/** Current (A): raw × 0.1 */
function scaleCurrent(val: string | undefined): number {
  return safeFloat(val) * 0.1;
}
/** Temperature (℃): raw × 0.1 */
function scaleTemp(val: string | undefined): number {
  return safeFloat(val) * 0.1;
}
/** Power: raw is W (×1), convert to kW for storage */
function scalePowerKw(val: string | undefined): number {
  return safeFloat(val) / 1000;
}
/** Power: raw is W (×1), keep as W for telemetry_extra */
function scalePowerW(val: string | undefined): number {
  return safeFloat(val);
}
/** Energy (*Energy fields): raw × 0.1 → kWh */
function scaleEnergyKwh(val: string | undefined): number {
  return safeFloat(val) * 0.1;
}
/** Frequency (Hz): raw × 0.01 */
function scaleFrequency(val: string | undefined): number {
  return safeFloat(val) * 0.01;
}
