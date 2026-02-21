import { StandardTelemetry } from './StandardTelemetry';

/**
 * 反腐层契约。
 * 每个厂商专属适配器实现此接口，将专有负载
 * 转换为标准 StandardTelemetry 格式。
 */
export interface TelemetryAdapter {
  readonly source: StandardTelemetry['source'];
  canHandle(payload: unknown): boolean;
  normalize(raw: unknown, orgId: string): StandardTelemetry;
}
