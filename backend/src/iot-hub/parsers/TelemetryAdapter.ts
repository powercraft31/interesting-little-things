import { StandardTelemetry } from './StandardTelemetry';

/**
 * Anti-Corruption Layer contract.
 * Each vendor-specific adapter implements this interface to translate
 * proprietary payloads into the canonical StandardTelemetry shape.
 */
export interface TelemetryAdapter {
  readonly source: StandardTelemetry['source'];
  canHandle(payload: unknown): boolean;
  normalize(raw: unknown, orgId: string): StandardTelemetry;
}
