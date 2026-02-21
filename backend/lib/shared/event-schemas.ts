/**
 * Type-safe EventBridge event schema definitions.
 * All inter-module events are defined here for compile-time safety.
 *
 * NOTE: These are type definitions only — no runtime logic.
 * Actual event publishing/subscribing will be implemented in later phases.
 */

/** Event source identifiers by module */
export const EVENT_SOURCE = {
  IOT_HUB: "solfacil.vpp.iot-hub",
  OPTIMIZATION: "solfacil.vpp.optimization",
  DR_DISPATCHER: "solfacil.vpp.dr-dispatcher",
  MARKET_BILLING: "solfacil.vpp.market-billing",
  BFF: "solfacil.vpp.bff",
} as const;

/** Event detail types */
export const EVENT_DETAIL_TYPE = {
  ASSET_MODE_CHANGED: "AssetModeChanged",
  SCHEDULE_GENERATED: "ScheduleGenerated",
  PROFIT_CALCULATED: "ProfitCalculated",
  INVOICE_GENERATED: "InvoiceGenerated",
  DR_COMMAND_ISSUED: "DRCommandIssued",
  DR_COMMAND_SENT: "DrCommandSent",
  DR_DISPATCH_COMPLETED: "DRDispatchCompleted",
  DR_RESPONSE_RECEIVED: "DrResponseReceived",
  TELEMETRY_RECEIVED: "TelemetryReceived",
} as const;

/** Base event envelope */
export interface VppEvent<T> {
  source: string;
  detailType: string;
  detail: T;
  timestamp: string;
}

// ── Event Detail Interfaces ─────────────────────────────────────────
// Each cross-module event carries a mandatory traceId for distributed tracing.

/** M1 → EventBridge: raw telemetry ingested */
export interface TelemetryReceivedDetail {
  readonly traceId: string; // format: vpp-{UUID}
  readonly assetId: string;
  readonly deviceId: string;
  readonly timestamp: string;
  readonly metrics: Record<string, number>;
}

/** M2 → M1: optimization schedule generated */
export interface ScheduleGeneratedDetail {
  readonly traceId: string;
  readonly scheduleId: string;
  readonly assetIds: readonly string[];
  readonly validFrom: string;
  readonly validTo: string;
}

/** M1/M2 → M3: asset mode change requested */
export interface AssetModeChangedDetail {
  readonly traceId: string;
  readonly assetId: string;
  readonly previousMode: string;
  readonly newMode: string;
  readonly reason: string;
}

/** BFF → M3: demand-response command issued */
export interface DRCommandIssuedDetail {
  readonly traceId: string;
  readonly dispatchId: string;
  readonly assetIds: readonly string[];
  readonly command: string;
  readonly issuedBy: string;
}

/** M3 → devices: DR command sent to IoT */
export interface DRCommandSentDetail {
  readonly traceId: string;
  readonly dispatchId: string;
  readonly assetId: string;
  readonly deviceId: string;
  readonly command: string;
}

/** M3 → EventBridge: all devices responded or timed out */
export interface DRDispatchCompletedDetail {
  readonly traceId: string;
  readonly dispatchId: string;
  readonly totalDevices: number;
  readonly successCount: number;
  readonly failureCount: number;
  readonly timeoutCount: number;
}

/** Device → M3: device responded to DR command */
export interface DRResponseReceivedDetail {
  readonly traceId: string;
  readonly dispatchId: string;
  readonly assetId: string;
  readonly deviceId: string;
  readonly status: string;
}

/** M4 → EventBridge: profit calculated for a period */
export interface ProfitCalculatedDetail {
  readonly traceId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly totalRevenueBrl: number;
  readonly orgId: string;
}

/** M4 → EventBridge: invoice generated */
export interface InvoiceGeneratedDetail {
  readonly traceId: string;
  readonly invoiceId: string;
  readonly orgId: string;
  readonly amountBrl: number;
  readonly periodStart: string;
  readonly periodEnd: string;
}
