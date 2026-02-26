import { StandardTelemetry, castValue } from './StandardTelemetry';
import { TelemetryAdapter } from './TelemetryAdapter';

/** 模拟华为 FusionSolar 负载格式 */
interface HuaweiPayload {
  devSn: string;            // 华为：devSn → 我方：deviceId
  collectTime: number;      // 华为：Unix 毫秒 → 我方：ISO 8601
  dataItemMap: {
    active_power?: number;  // 华为：W → 我方：kW（÷1000）
    battery_soc?: number;   // 华为：%（0-100）→ 透传
    mppt_total_cap?: number;// 华为：kWh — 保留为 metering
    grid_voltage?: number;  // 华为：V
    grid_current?: number;  // 华为：A
  };
}

export class HuaweiAdapter implements TelemetryAdapter {
  readonly source = 'huawei' as const;

  canHandle(payload: unknown): boolean {
    const p = payload as Record<string, unknown>;
    return typeof p?.devSn === 'string' && typeof p?.dataItemMap === 'object';
  }

  normalize(raw: unknown, orgId: string): StandardTelemetry {
    const p = raw as HuaweiPayload;

    // ── metering（数值型计量指标）───────────────────────────────
    const metering: Record<string, number> = {};

    metering['metering.grid_power_kw'] = castValue(
      (p.dataItemMap.active_power ?? 0) / 1000,
      'number',
    ); // W → kW

    if (p.dataItemMap.mppt_total_cap !== undefined) {
      metering['metering.mppt_total_cap_kwh'] = castValue(p.dataItemMap.mppt_total_cap, 'number');
    }

    if (p.dataItemMap.grid_voltage !== undefined) {
      metering['metering.grid_voltage_v'] = castValue(p.dataItemMap.grid_voltage, 'number');
    }

    if (p.dataItemMap.grid_current !== undefined) {
      metering['metering.grid_current_a'] = castValue(p.dataItemMap.grid_current, 'number');
    }

    // ── status（设备状态）──────────────────────────────────────
    const status: Record<string, number | string | boolean> = {};

    if (p.dataItemMap.battery_soc !== undefined) {
      status['status.battery_soc'] = castValue(p.dataItemMap.battery_soc, 'number');
    }

    return {
      orgId,
      deviceId: p.devSn,
      timestamp: new Date(p.collectTime).toISOString(),
      source: 'huawei',
      metering,
      status: Object.keys(status).length > 0 ? status : undefined,
      rawPayload: raw,
    };
  }
}
