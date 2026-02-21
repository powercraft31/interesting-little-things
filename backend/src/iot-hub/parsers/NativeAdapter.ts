import { StandardTelemetry } from './StandardTelemetry';
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
    return {
      orgId,
      deviceId: p.deviceId,
      timestamp: p.timestamp ?? new Date().toISOString(),
      source: 'mqtt',
      metrics: {
        power:   p.power,
        voltage: p.voltage,
        current: p.current,
        soc:     p.soc,
      },
      rawPayload: raw,
    };
  }
}
