import { StandardTelemetry } from './StandardTelemetry';
import { TelemetryAdapter } from './TelemetryAdapter';

/** Simulated Huawei FusionSolar payload shape */
interface HuaweiPayload {
  devSn: string;            // Huawei: devSn → our: deviceId
  collectTime: number;      // Huawei: Unix ms → our: ISO 8601
  dataItemMap: {
    active_power?: number;  // Huawei: W → our: kW (÷1000)
    battery_soc?: number;   // Huawei: % (0-100) → passthrough
    mppt_total_cap?: number;// Huawei: kWh — ignored
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
    return {
      orgId,
      deviceId: p.devSn,
      timestamp: new Date(p.collectTime).toISOString(),
      source: 'huawei',
      metrics: {
        power: (p.dataItemMap.active_power ?? 0) / 1000, // W → kW
        soc:   p.dataItemMap.battery_soc,
      },
      rawPayload: raw,
    };
  }
}
