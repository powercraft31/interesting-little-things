import { StandardTelemetry, castValue } from './StandardTelemetry';
import { TelemetryAdapter } from './TelemetryAdapter';

/**
 * 原生 MQTT 适配器 — 处理 SOLFACIL 自有设备
 * 直接发布的扁平遥测格式。
 */
export class NativeAdapter implements TelemetryAdapter {
  readonly source = 'mqtt' as const;

  canHandle(payload: unknown): boolean {
    const p = payload as Record<string, unknown>;
    return typeof p?.deviceId === 'string' && typeof p?.power === 'number';
  }

  normalize(raw: unknown, orgId: string): StandardTelemetry {
    const p = raw as {
      deviceId: string;
      timestamp?: string;
      power: number;
      voltage?: number;
      current?: number;
      soc?: number;
    };

    // ── metering（数值型计量指标）───────────────────────────────
    const metering: Record<string, number> = {};

    metering['metering.grid_power_kw'] = castValue(p.power, 'number');

    if (p.voltage !== undefined) {
      metering['metering.grid_voltage_v'] = castValue(p.voltage, 'number');
    }

    if (p.current !== undefined) {
      metering['metering.grid_current_a'] = castValue(p.current, 'number');
    }

    // ── status（设备状态）──────────────────────────────────────
    const status: Record<string, number | string | boolean> = {};

    if (p.soc !== undefined) {
      status['status.battery_soc'] = castValue(p.soc, 'number');
    }

    return {
      orgId,
      deviceId: p.deviceId,
      timestamp: p.timestamp ?? new Date().toISOString(),
      source: 'mqtt',
      metering,
      status: Object.keys(status).length > 0 ? status : undefined,
      rawPayload: raw,
    };
  }
}
