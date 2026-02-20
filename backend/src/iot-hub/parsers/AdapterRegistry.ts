import { TelemetryAdapter } from './TelemetryAdapter';
import { HuaweiAdapter } from './HuaweiAdapter';
import { NativeAdapter } from './NativeAdapter';

/** Priority order: try HuaweiAdapter first, fallback to NativeAdapter */
const ADAPTERS: readonly TelemetryAdapter[] = [
  new HuaweiAdapter(),
  new NativeAdapter(),
];

/**
 * Finds the first adapter that can handle the given payload.
 * @throws Error if no adapter matches.
 */
export function resolveAdapter(payload: unknown): TelemetryAdapter {
  const adapter = ADAPTERS.find(a => a.canHandle(payload));
  if (!adapter) throw new Error('No adapter found for telemetry payload');
  return adapter;
}
