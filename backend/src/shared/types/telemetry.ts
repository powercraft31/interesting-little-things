/** Raw Xuheng EMS MSG#4 as received from MQTT topic xuheng/+/+/data */
export interface XuhengRawMessage {
  readonly clientId: string;
  readonly productKey: string;
  readonly timeStamp: string;
  readonly data: {
    readonly batList?: ReadonlyArray<{
      readonly deviceSn: string;
      readonly properties: {
        readonly total_bat_soc: string;
        readonly total_bat_power: string;
        readonly total_bat_dailyChargedEnergy: string;
        readonly total_bat_dailyDischargedEnergy: string;
        // v5.14 NEW — 9 additional fields
        readonly total_bat_soh?: string;
        readonly total_bat_vlotage?: string; // note: source typo "vlotage"
        readonly total_bat_current?: string;
        readonly total_bat_temperature?: string;
        readonly total_bat_maxChargeVoltage?: string;
        readonly total_bat_maxChargeCurrent?: string;
        readonly total_bat_maxDischargeCurrent?: string;
        readonly total_bat_totalChargedEnergy?: string;
        readonly total_bat_totalDischargedEnergy?: string;
      };
    }>;
    readonly pvList?: ReadonlyArray<{
      readonly deviceSn: string;
      readonly properties: {
        readonly pv_totalPower: string;
        readonly pv_dailyEnergy: string;
      };
    }>;
    readonly gridList?: ReadonlyArray<{
      readonly deviceSn: string;
      readonly properties: {
        readonly grid_totalActivePower: string;
        readonly grid_dailyBuyEnergy: string;
        readonly grid_dailySellEnergy: string;
      };
    }>;
    readonly loadList?: ReadonlyArray<{
      readonly deviceSn: string;
      readonly properties: {
        readonly load1_totalPower: string;
      };
    }>;
    readonly flloadList?: ReadonlyArray<{
      readonly deviceSn: string;
      readonly properties: {
        readonly flload_totalPower: string;
      };
    }>;
    readonly emsList?: ReadonlyArray<{
      readonly deviceSn?: string;
      readonly properties: {
        readonly firmware_version?: string;
        readonly wifi_signal_dbm?: string;
        readonly uptime_seconds?: string;
        readonly error_codes?: string;
      };
    }>;
    readonly [key: string]: unknown;
  };
}

/** Canonical telemetry record after parsing -- all values numeric, SI units */
export interface ParsedTelemetry {
  readonly clientId: string;
  readonly deviceSn: string;
  readonly recordedAt: Date;
  readonly batterySoc: number;
  readonly batteryPowerKw: number;
  readonly dailyChargeKwh: number;
  readonly dailyDischargeKwh: number;
  readonly pvPowerKw: number;
  readonly pvDailyEnergyKwh: number;
  readonly gridPowerKw: number;
  readonly gridDailyBuyKwh: number;
  readonly gridDailySellKwh: number;
  readonly loadPowerKw: number;
  readonly flloadPowerKw: number;
  // v5.14 NEW — 9 battery deep telemetry fields
  readonly batterySoh: number;
  readonly batteryVoltage: number;
  readonly batteryCurrent: number;
  readonly batteryTemperature: number;
  readonly maxChargeVoltage: number;
  readonly maxChargeCurrent: number;
  readonly maxDischargeCurrent: number;
  readonly totalChargeKwh: number;
  readonly totalDischargeKwh: number;
}

/** Xuheng message type discriminator */
export type XuhengMessageType = 0 | 1 | 2 | 3 | 4;
