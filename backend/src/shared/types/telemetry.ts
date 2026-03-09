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
    // v5.16: Digital Output relay state from MSG#1
    readonly dido?: {
      readonly do: ReadonlyArray<{
        readonly id: string; // "DO0" | "DO1"
        readonly type: string; // "DO"
        readonly value: string; // "0" = open, "1" = closed (load shed active)
        readonly gpionum?: string;
      }>;
    };
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
  // v5.16: DO relay state
  readonly do0Active: boolean;
  readonly do1Active: boolean;
  // v5.18: new hot-path fields
  readonly inverterTemp?: number;
  readonly pvTotalEnergyKwh?: number;
  readonly pv1Voltage?: number;
  readonly pv1Current?: number;
  readonly pv1Power?: number;
  readonly pv2Voltage?: number;
  readonly pv2Current?: number;
  readonly pv2Power?: number;
  // v5.18: JSONB extra for per-phase diagnostic fields
  readonly telemetryExtra?: Record<string, Record<string, number>> | null;
}

/** Xuheng message type discriminator */
export type XuhengMessageType = 0 | 1 | 2 | 3 | 4;
