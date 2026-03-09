import { Pool } from "pg";
import type {
  SolfacilMessage,
  SolfacilListItem,
} from "../../shared/types/solfacil-protocol";
import type { ParsedTelemetry } from "../../shared/types/telemetry";
import { DeviceAssetCache } from "../services/device-asset-cache";
import { MessageBuffer } from "../services/message-buffer";

/**
 * PR4: TelemetryHandler
 *
 * Processes `device/ems/{clientId}/data` messages.
 * Parses all 6 Lists: meterList, gridList, pvList, batList, loadList, flloadList.
 * All protocol values are strings — converted to numbers via safeFloat().
 *
 * TimeStamp Rule (鐵律): `recorded_at` MUST come from `payload.timeStamp`.
 * Server-side NOW() is FORBIDDEN for telemetry writes.
 *
 * Typo Rule: `total_bat_vlotage` is the protocol field (typo in firmware).
 * ACL translates to `batteryVoltage` in domain model.
 */

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

/**
 * Handle telemetry data message from a gateway.
 * Uses getServicePool (BYPASSRLS).
 */
export async function handleTelemetry(
  pool: Pool,
  _gatewayId: string,
  _clientId: string,
  payload: SolfacilMessage,
): Promise<void> {
  const data = payload.data as {
    batList?: SolfacilListItem[];
    pvList?: SolfacilListItem[];
    gridList?: SolfacilListItem[];
    loadList?: SolfacilListItem[];
    flloadList?: SolfacilListItem[];
    meterList?: SolfacilListItem[];
  };

  // TimeStamp Rule: recordedAt from payload.timeStamp, NEVER from server
  const recordedAt = new Date(parseInt(payload.timeStamp, 10));

  const bat = data.batList?.[0];
  if (!bat) {
    // No battery data — skip (same as existing XuhengAdapter pattern)
    return;
  }

  const pv = findPvSummary(data.pvList);
  const pv1 = findPvMppt(data.pvList, "pv1");
  const pv2 = findPvMppt(data.pvList, "pv2");
  const grid = data.gridList?.[0];
  const load = data.loadList?.[0];
  const flload = data.flloadList?.[0];
  const meter = data.meterList?.[0];

  const bp = bat.properties;
  const gp = grid?.properties;
  const lp = load?.properties;
  const flp = flload?.properties;
  const pvp = pv?.properties;

  // Build telemetry_extra JSONB for per-phase diagnostic fields
  const telemetryExtra = buildTelemetryExtra(grid, meter, load, flload, pv1, pv2);

  const parsed: ParsedTelemetry = {
    clientId: payload.clientId,
    deviceSn: bat.deviceSn,
    recordedAt,

    // Battery core
    batterySoc: safeFloat(bp.total_bat_soc),
    batteryPowerKw: safeFloat(bp.total_bat_power),
    dailyChargeKwh: safeFloat(bp.total_bat_dailyChargedEnergy),
    dailyDischargeKwh: safeFloat(bp.total_bat_dailyDischargedEnergy),

    // Battery deep (v5.14)
    batterySoh: safeFloat(bp.total_bat_soh),
    batteryVoltage: safeFloat(bp.total_bat_vlotage), // typo in protocol: vlotage
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

    // DO (not present in Solfacil protocol v1.1 data topic — retain defaults)
    do0Active: false,
    do1Active: false,

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

  const { cache, buffer } = getInstances(pool);

  const assetId = await cache.resolve(parsed.deviceSn);
  if (!assetId) {
    console.warn(
      `[TelemetryHandler] Unknown device: ${parsed.deviceSn}`,
    );
    return;
  }

  buffer.enqueue(assetId, parsed);
  await updateDeviceState(pool, assetId, parsed);
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

/** Build telemetry_extra JSONB for per-phase diagnostic fields. */
function buildTelemetryExtra(
  grid?: SolfacilListItem,
  meter?: SolfacilListItem,
  load?: SolfacilListItem,
  flload?: SolfacilListItem,
  pv1?: SolfacilListItem,
  pv2?: SolfacilListItem,
): Record<string, Record<string, number>> | null {
  const extra: Record<string, Record<string, number>> = {};
  let hasData = false;

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

  if (meter?.properties) {
    const m = meter.properties;
    extra.meter = {
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

  return hasData ? extra : null;
}

/** Update device_state for real-time dashboard. */
async function updateDeviceState(
  pool: Pool,
  assetId: string,
  t: ParsedTelemetry,
): Promise<void> {
  await pool.query(
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

/** Safe parseFloat: returns 0 for undefined/null/empty/NaN/Infinity values. */
export function safeFloat(val: string | undefined): number {
  if (val === undefined || val === null || val === "") return 0;
  const n = parseFloat(val);
  return Number.isFinite(n) ? n : 0;
}
