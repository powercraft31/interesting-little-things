/**
 * Canonical telemetry shape — every vendor adapter normalises into this.
 * Immutable by design (readonly at every level).
 */
export interface StandardTelemetry {
  readonly orgId: string;
  readonly deviceId: string;
  readonly timestamp: string;         // ISO 8601 UTC
  readonly source: 'mqtt' | 'huawei' | 'sungrow' | 'generic-rest';
  readonly metrics: {
    readonly power: number;           // kW (unified unit)
    readonly voltage?: number;        // V
    readonly current?: number;        // A
    readonly soc?: number;            // 0-100 %
  };
  readonly rawPayload?: unknown;      // preserve raw data for audit
}
