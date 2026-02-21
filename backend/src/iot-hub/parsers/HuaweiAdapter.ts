import { StandardTelemetry } from './StandardTelemetry';
import { TelemetryAdapter } from './TelemetryAdapter';

/** 模拟华为 FusionSolar 负载格式 */
interface HuaweiPayload {
  devSn: string;            // 华为：devSn → 我方：deviceId
  collectTime: number;      // 华为：Unix 毫秒 → 我方：ISO 8601
  dataItemMap: {
    active_power?: number;  // 华为：W → 我方：kW（÷1000）
    battery_soc?: number;   // 华为：%（0-100）→ 透传
    mppt_total_cap?: number;// 华为：kWh — 忽略
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
