/**
 * Type-safe EventBridge event schema definitions.
 * All inter-module events are defined here for compile-time safety.
 *
 * NOTE: These are type definitions only — no runtime logic.
 * Actual event publishing/subscribing will be implemented in later phases.
 */

/** Event source identifiers by module */
export const EVENT_SOURCE = {
  IOT_HUB: 'solfacil.vpp.iot-hub',
  OPTIMIZATION: 'solfacil.vpp.optimization',
  DR_DISPATCHER: 'solfacil.vpp.dr-dispatcher',
  MARKET_BILLING: 'solfacil.vpp.market-billing',
  BFF: 'solfacil.vpp.bff',
} as const;

/** Event detail types */
export const EVENT_DETAIL_TYPE = {
  ASSET_MODE_CHANGED: 'AssetModeChanged',
  SCHEDULE_GENERATED: 'ScheduleGenerated',
  PROFIT_CALCULATED: 'ProfitCalculated',
  INVOICE_GENERATED: 'InvoiceGenerated',
  DR_COMMAND_SENT: 'DrCommandSent',
  DR_RESPONSE_RECEIVED: 'DrResponseReceived',
  TELEMETRY_RECEIVED: 'TelemetryReceived',
} as const;

/** Base event envelope */
export interface VppEvent<T> {
  source: string;
  detailType: string;
  detail: T;
  timestamp: string;
}
