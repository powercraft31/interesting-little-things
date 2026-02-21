/**
 * 标准遥测数据格式 — 所有厂商适配器统一规范化为此结构。
 * 设计为不可变（每一层都使用 readonly）。
 */
export interface StandardTelemetry {
  readonly orgId: string;
  readonly deviceId: string;
  readonly timestamp: string;         // ISO 8601 UTC
  readonly source: 'mqtt' | 'huawei' | 'sungrow' | 'generic-rest';
  readonly metrics: {
    readonly power: number;           // kW（统一单位）
    readonly voltage?: number;        // V
    readonly current?: number;        // A
    readonly soc?: number;            // 0-100 %
  };
  readonly rawPayload?: unknown;      // 保留原始数据用于审计
}
