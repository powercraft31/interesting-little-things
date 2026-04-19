export type RuntimeSlice =
  | "bff_db"
  | "m1_ingest"
  | "m2_scheduler"
  | "m3_dispatch"
  | "m4_billing"
  | "frontend_runtime";

export const RUNTIME_SLICES: readonly RuntimeSlice[] = Object.freeze([
  "bff_db",
  "m1_ingest",
  "m2_scheduler",
  "m3_dispatch",
  "m4_billing",
  "frontend_runtime",
] as const);

export interface RuntimeFlags {
  readonly governanceEnabled: boolean;
  readonly slices: Readonly<Record<RuntimeSlice, boolean>>;
}

const RUNTIME_GOVERNANCE_ENV_KEY = "RUNTIME_GOVERNANCE_ENABLED" as const;

const SLICE_ENV_KEYS: Readonly<Record<RuntimeSlice, string>> = Object.freeze({
  bff_db: "RUNTIME_EMIT_BFF_DB",
  m1_ingest: "RUNTIME_EMIT_M1_INGEST",
  m2_scheduler: "RUNTIME_EMIT_M2_SCHEDULER",
  m3_dispatch: "RUNTIME_EMIT_M3_DISPATCH",
  m4_billing: "RUNTIME_EMIT_M4_BILLING",
  frontend_runtime: "RUNTIME_FRONTEND_PAGE_ENABLED",
});

function parseBoolFlag(raw: string | undefined): boolean {
  if (raw === undefined) {
    return false;
  }
  return raw.trim().toLowerCase() === "true";
}

function freezeFlags(flags: { governanceEnabled: boolean; slices: Record<RuntimeSlice, boolean> }): RuntimeFlags {
  return Object.freeze({
    governanceEnabled: flags.governanceEnabled,
    slices: Object.freeze({ ...flags.slices }),
  });
}

export function parseRuntimeFlags(env: NodeJS.ProcessEnv = {}): RuntimeFlags {
  const governanceEnabled = parseBoolFlag(env[RUNTIME_GOVERNANCE_ENV_KEY]);
  const slices: Record<RuntimeSlice, boolean> = {
    bff_db: false,
    m1_ingest: false,
    m2_scheduler: false,
    m3_dispatch: false,
    m4_billing: false,
    frontend_runtime: false,
  };

  for (const slice of RUNTIME_SLICES) {
    slices[slice] = parseBoolFlag(env[SLICE_ENV_KEYS[slice]]);
  }

  return freezeFlags({ governanceEnabled, slices });
}

export function defaultRuntimeFlags(): RuntimeFlags {
  return parseRuntimeFlags({});
}

export function isRuntimeGovernanceEnabled(flags: RuntimeFlags): boolean {
  return flags.governanceEnabled;
}

export function isSliceEnabled(flags: RuntimeFlags, slice: RuntimeSlice): boolean {
  return flags.governanceEnabled && flags.slices[slice] === true;
}

export function getSliceEnvKey(slice: RuntimeSlice): string {
  return SLICE_ENV_KEYS[slice];
}

export function getGovernanceEnvKey(): string {
  return RUNTIME_GOVERNANCE_ENV_KEY;
}
