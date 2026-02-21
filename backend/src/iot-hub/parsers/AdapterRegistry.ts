import { TelemetryAdapter } from './TelemetryAdapter';
import { HuaweiAdapter } from './HuaweiAdapter';
import { NativeAdapter } from './NativeAdapter';

/** 优先级顺序：先尝试 HuaweiAdapter，降级使用 NativeAdapter */
const ADAPTERS: readonly TelemetryAdapter[] = [
  new HuaweiAdapter(),
  new NativeAdapter(),
];

/**
 * 查找第一个可处理给定负载的适配器。
 * @throws Error 无匹配适配器时抛出异常。
 */
export function resolveAdapter(payload: unknown): TelemetryAdapter {
  const adapter = ADAPTERS.find(a => a.canHandle(payload));
  if (!adapter) throw new Error('No adapter found for telemetry payload');
  return adapter;
}
