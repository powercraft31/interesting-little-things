import { isSliceEnabled, type RuntimeFlags, type RuntimeSlice } from "./flags";

export type RuntimeOverallState = "ok" | "warning" | "degraded" | "critical" | "disabled";

export interface RuntimeHealthPosture {
  readonly overall: RuntimeOverallState;
  readonly components: readonly string[];
  readonly criticalOpenCount: number;
  readonly selfCheckAllPass: boolean;
  readonly capturedAt: string | null;
}

export interface RuntimeDisabledPosture {
  readonly health: RuntimeHealthPosture;
  readonly issues: readonly never[];
  readonly events: readonly never[];
  readonly selfChecks: readonly never[];
}

export function runtimeDisabledHealth(): RuntimeHealthPosture {
  return Object.freeze({
    overall: "disabled" as const,
    components: Object.freeze<string[]>([]),
    criticalOpenCount: 0,
    selfCheckAllPass: false,
    capturedAt: null,
  });
}

export function buildDisabledRuntimePosture(): RuntimeDisabledPosture {
  return Object.freeze({
    health: runtimeDisabledHealth(),
    issues: Object.freeze<never[]>([]),
    events: Object.freeze<never[]>([]),
    selfChecks: Object.freeze<never[]>([]),
  });
}

export function isEmitterEnabled(flags: RuntimeFlags, slice: RuntimeSlice): boolean {
  return isSliceEnabled(flags, slice);
}
