import { StandardTelemetry } from './StandardTelemetry';
import { TelemetryAdapter } from './TelemetryAdapter';

/**
 * Native MQTT adapter — handles the flat telemetry format
 * published directly by SOLFACIL-controlled devices.
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
