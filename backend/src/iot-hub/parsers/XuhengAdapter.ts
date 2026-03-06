import type {
  XuhengRawMessage,
  ParsedTelemetry,
} from "../../shared/types/telemetry";

/**
 * Parse Xuheng MSG#4 into canonical ParsedTelemetry.
 * All string property values are parseFloat'd.
 * Returns null if message is malformed (no batList).
 */
export class XuhengAdapter {
  parse(raw: XuhengRawMessage): ParsedTelemetry | null {
    const { data } = raw;
    if (!data.batList?.length) return null;

    const bat = data.batList[0];
    const pv = data.pvList?.[0];
    const grid = data.gridList?.[0];
    const load = data.loadList?.[0];
    const flload = data.flloadList?.[0];

    return {
      clientId: raw.clientId,
      deviceSn: bat.deviceSn,
      recordedAt: new Date(parseInt(raw.timeStamp, 10)),
      batterySoc: safeFloat(bat.properties.total_bat_soc),
      batteryPowerKw: safeFloat(bat.properties.total_bat_power),
      dailyChargeKwh: safeFloat(bat.properties.total_bat_dailyChargedEnergy),
      dailyDischargeKwh: safeFloat(
        bat.properties.total_bat_dailyDischargedEnergy,
      ),
      pvPowerKw: safeFloat(pv?.properties.pv_totalPower),
      pvDailyEnergyKwh: safeFloat(pv?.properties.pv_dailyEnergy),
      gridPowerKw: safeFloat(grid?.properties.grid_totalActivePower),
      gridDailyBuyKwh: safeFloat(grid?.properties.grid_dailyBuyEnergy),
      gridDailySellKwh: safeFloat(grid?.properties.grid_dailySellEnergy),
      loadPowerKw: safeFloat(load?.properties.load1_totalPower),
      flloadPowerKw: safeFloat(flload?.properties.flload_totalPower),
    };
  }
}

function safeFloat(val: string | undefined): number {
  if (val === undefined || val === null || val === "") return 0;
  const n = parseFloat(val);
  return Number.isFinite(n) ? n : 0;
}
