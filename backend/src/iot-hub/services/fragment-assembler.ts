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
    readonly do: ReadonlyArray<{ id: string; type: string; value: string; gpionum?: string }>;
    readonly di?: ReadonlyArray<{ id: string; type: string; value: string; gpionum?: string }>;
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

function getInstances(
  pool: Pool,
): { cache: DeviceAssetCache; buffer: MessageBuffer } {
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
    if (data.emsList) {
      const emsList = data.emsList as SolfacilListItem[];
      if (emsList.length > 0) {
        acc.ems = emsList[0];
      }
      return false;
    }

    if (data.dido) {
      acc.dido = data.dido as Accumulator["dido"];
      return false;
    }

    if (data.meterList) {
      const meters = data.meterList as SolfacilListItem[];
      // Append — may receive multiple meterList messages (single + three phase)
      acc.meters = [...acc.meters, ...meters];
      return false;
    }

    if (data.batList) {
      // Core message (MSG#5) — contains batList + gridList + loadList + flloadList + pvList
      acc.core = data;
      return true;
    }

    return false;
  }

  private getOrCreateAccumulator(clientId: string, recordedAt: Date): Accumulator {
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
       WHERE client_id = $3`,
      [healthJson, recordedAt, clientId],
    );
  }

  private async writeTelemetry(
    clientId: string,
    acc: Accumulator,
  ): Promise<void> {
    const core = acc.core!;
    const data = core as {
      batList?: SolfacilListItem[];
      pvList?: SolfacilListItem[];
      gridList?: SolfacilListItem[];
      loadList?: SolfacilListItem[];
      flloadList?: SolfacilListItem[];
    };

    const bat = data.batList?.[0];
    if (!bat) return; // Safety: core should always have batList

    const pv = findPvSummary(data.pvList);
    const pv1 = findPvMppt(data.pvList, "pv1");
    const pv2 = findPvMppt(data.pvList, "pv2");
    const grid = data.gridList?.[0];
    const load = data.loadList?.[0];
    const flload = data.flloadList?.[0];

    const bp = bat.properties;
    const gp = grid?.properties;
    const lp = load?.properties;
    const flp = flload?.properties;
    const pvp = pv?.properties;

    // Extract DO0/DO1 from dido fragment
    const do0 = acc.dido?.do.find((d) => d.id === "DO0");
    const do1 = acc.dido?.do.find((d) => d.id === "DO1");

    // Build telemetry_extra with meters + dido DI + ems_health
    const telemetryExtra = this.buildTelemetryExtra(
      grid, load, flload, pv1, pv2, acc.meters, acc.dido, acc.ems,
    );

    const parsed: ParsedTelemetry = {
      clientId,
      deviceSn: bat.deviceSn,
      recordedAt: acc.recordedAt,

      // Battery core
      batterySoc: safeFloat(bp.total_bat_soc),
      batteryPowerKw: safeFloat(bp.total_bat_power),
      dailyChargeKwh: safeFloat(bp.total_bat_dailyChargedEnergy),
      dailyDischargeKwh: safeFloat(bp.total_bat_dailyDischargedEnergy),

      // Battery deep (v5.14)
      batterySoh: safeFloat(bp.total_bat_soh),
      batteryVoltage: safeFloat(bp.total_bat_vlotage), // typo in protocol
      batteryCurrent: safeFloat(bp.total_bat_current),
      batteryTemperature: safeFloat(bp.total_bat_temperature),
      maxChargeVoltage: safeFloat(bp.total_bat_maxChargeVoltage),
      maxChargeCurrent: safeFloat(bp.total_bat_maxChargeCurrent),
      maxDischargeCurrent: safeFloat(bp.total_bat_maxDischargeCurrent),
      totalChargeKwh: safeFloat(bp.total_bat_totalChargedEnergy),
      totalDischargeKwh: safeFloat(bp.total_bat_totalDischargedEnergy),

      // Grid
      gridPowerKw: safeFloat(gp?.grid_totalActivePower),
      gridDailyBuyKwh: safeFloat(gp?.grid_dailyBuyEnergy),
      gridDailySellKwh: safeFloat(gp?.grid_dailySellEnergy),

      // PV
      pvPowerKw: safeFloat(pvp?.pv_totalPower),
      pvDailyEnergyKwh: safeFloat(pvp?.pv_dailyEnergy),

      // Load
      loadPowerKw: safeFloat(lp?.load1_totalPower),

      // Flload
      flloadPowerKw: safeFloat(flp?.flload_totalPower),

      // DO from dido fragment (real values, not hardcoded false)
      do0Active: do0?.value === "1",
      do1Active: do1?.value === "1",

      // v5.18: new hot-path fields
      inverterTemp: safeFloat(gp?.grid_temp),
      pvTotalEnergyKwh: safeFloat(pvp?.pv_totalEnergy),
      pv1Voltage: safeFloat(pv1?.properties.pv1_voltage),
      pv1Current: safeFloat(pv1?.properties.pv1_current),
      pv1Power: safeFloat(pv1?.properties.pv1_power),
      pv2Voltage: safeFloat(pv2?.properties.pv2_voltage),
      pv2Current: safeFloat(pv2?.properties.pv2_current),
      pv2Power: safeFloat(pv2?.properties.pv2_power),

      // v5.18: JSONB extra
      telemetryExtra,
    };

    const { cache, buffer } = getInstances(this.pool);
    const assetId = await cache.resolve(parsed.deviceSn);
    if (!assetId) {
      console.warn(`[FragmentAssembler] Unknown device: ${parsed.deviceSn}`);
      return;
    }

    buffer.enqueue(assetId, parsed);
    await this.updateDeviceState(assetId, parsed);
  }

  private buildTelemetryExtra(
    grid?: SolfacilListItem,
    load?: SolfacilListItem,
    flload?: SolfacilListItem,
    pv1?: SolfacilListItem,
    pv2?: SolfacilListItem,
    meters?: SolfacilListItem[],
    dido?: Accumulator["dido"],
    ems?: SolfacilListItem,
  ): Record<string, Record<string, number>> | null {
    const extra: Record<string, Record<string, number>> = {};
    let hasData = false;

    // Grid per-phase from core (MSG#5)
    if (grid?.properties) {
      const g = grid.properties;
      extra.grid = {
        volt_a: safeFloat(g.grid_voltA),
        volt_b: safeFloat(g.grid_voltB),
        volt_c: safeFloat(g.grid_voltC),
        current_a: safeFloat(g.grid_currentA),
        current_b: safeFloat(g.grid_currentB),
        current_c: safeFloat(g.grid_currentC),
        active_power_a: safeFloat(g.grid_activePowerA),
        active_power_b: safeFloat(g.grid_activePowerB),
        active_power_c: safeFloat(g.grid_activePowerC),
        reactive_power_a: safeFloat(g.grid_reactivePowerA),
        reactive_power_b: safeFloat(g.grid_reactivePowerB),
        reactive_power_c: safeFloat(g.grid_reactivePowerC),
        total_reactive_power: safeFloat(g.grid_totalReactivePower),
        apparent_power_a: safeFloat(g.grid_apparentPowerA),
        apparent_power_b: safeFloat(g.grid_apparentPowerB),
        apparent_power_c: safeFloat(g.grid_apparentPowerC),
        total_apparent_power: safeFloat(g.grid_totalApparentPower),
        factor_a: safeFloat(g.grid_factorA),
        factor_b: safeFloat(g.grid_factorB),
        factor_c: safeFloat(g.grid_factorC),
        frequency: safeFloat(g.grid_frequency),
        total_buy_kwh: safeFloat(g.grid_totalBuyEnergy),
        total_sell_kwh: safeFloat(g.grid_totalSellEnergy),
      };
      hasData = true;
    }

    // Load per-phase from core (MSG#5)
    if (load?.properties) {
      const l = load.properties;
      extra.load = {
        volt_a: safeFloat(l.load1_voltA),
        volt_b: safeFloat(l.load1_voltB),
        volt_c: safeFloat(l.load1_voltC),
        current_a: safeFloat(l.load1_currentA),
        current_b: safeFloat(l.load1_currentB),
        current_c: safeFloat(l.load1_currentC),
        active_power_a: safeFloat(l.load1_activePowerA),
        active_power_b: safeFloat(l.load1_activePowerB),
        active_power_c: safeFloat(l.load1_activePowerC),
        frequency_a: safeFloat(l.load1_frequencyA),
        frequency_b: safeFloat(l.load1_frequencyB),
        frequency_c: safeFloat(l.load1_frequencyC),
      };
      hasData = true;
    }

    // Flload per-phase from core (MSG#5)
    if (flload?.properties) {
      const f = flload.properties;
      extra.flload = {
        active_power_a: safeFloat(f.flload_activePowerA),
        active_power_b: safeFloat(f.flload_activePowerB),
        active_power_c: safeFloat(f.flload_activePowerC),
        daily_energy_kwh: safeFloat(f.flload_dailyEnergy),
      };
      hasData = true;
    }

    // PV MPPT from core (MSG#5)
    if (pv1?.properties || pv2?.properties) {
      extra.pv = {};
      if (pv1?.properties) {
        extra.pv.pv1_voltage = safeFloat(pv1.properties.pv1_voltage);
        extra.pv.pv1_current = safeFloat(pv1.properties.pv1_current);
        extra.pv.pv1_power = safeFloat(pv1.properties.pv1_power);
      }
      if (pv2?.properties) {
        extra.pv.pv2_voltage = safeFloat(pv2.properties.pv2_voltage);
        extra.pv.pv2_current = safeFloat(pv2.properties.pv2_current);
        extra.pv.pv2_power = safeFloat(pv2.properties.pv2_power);
      }
      hasData = true;
    }

    // Meters from MSG#3 + MSG#4 — classify by deviceBrand
    if (meters && meters.length > 0) {
      for (const meter of meters) {
        const m = meter.properties;
        const brand = meter.deviceBrand ?? "";
        const isSingle = brand.toLowerCase().includes("single");
        const key = isSingle ? "meter_single" : "meter_three";

        extra[key] = {
          volt_a: safeFloat(m.grid_voltA),
          volt_b: safeFloat(m.grid_voltB),
          volt_c: safeFloat(m.grid_voltC),
          line_ab_volt: safeFloat(m.grid_lineABVolt),
          line_bc_volt: safeFloat(m.grid_lineBCVolt),
          line_ca_volt: safeFloat(m.grid_lineCAVolt),
          current_a: safeFloat(m.grid_currentA),
          current_b: safeFloat(m.grid_currentB),
          current_c: safeFloat(m.grid_currentC),
          active_power_a: safeFloat(m.grid_activePowerA),
          active_power_b: safeFloat(m.grid_activePowerB),
          active_power_c: safeFloat(m.grid_activePowerC),
          total_active_power: safeFloat(m.grid_totalActivePower),
          reactive_power_a: safeFloat(m.grid_reactivePowerA),
          reactive_power_b: safeFloat(m.grid_reactivePowerB),
          reactive_power_c: safeFloat(m.grid_reactivePowerC),
          total_reactive_power: safeFloat(m.grid_totalReactivePower),
          factor: safeFloat(m.grid_factor),
          factor_a: safeFloat(m.grid_factorA),
          factor_b: safeFloat(m.grid_factorB),
          factor_c: safeFloat(m.grid_factorC),
          frequency: safeFloat(m.grid_frequency),
          positive_energy: safeFloat(m.grid_positiveEnergy),
          positive_energy_a: safeFloat(m.grid_positiveEnergyA),
          positive_energy_b: safeFloat(m.grid_positiveEnergyB),
          positive_energy_c: safeFloat(m.grid_positiveEnergyC),
          net_forward_energy: safeFloat(m.grid_netForwardActiveEnergy),
          negative_energy_a: safeFloat(m.grid_negativeEnergyA),
          negative_energy_b: safeFloat(m.grid_negativeEnergyB),
          negative_energy_c: safeFloat(m.grid_negativeEnergyC),
          net_reverse_energy: safeFloat(m.grid_netReverseActiveEnergy),
        };
        hasData = true;
      }
    }

    // DIDO DI values (diagnostic)
    if (dido?.di && dido.di.length > 0) {
      extra.dido = {};
      for (const di of dido.di) {
        const key = di.id.toLowerCase(); // "DI0" → "di0"
        extra.dido[key] = safeFloat(di.value);
      }
      hasData = true;
    }

    // EMS health snapshot (historical trail in telemetry_extra)
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
