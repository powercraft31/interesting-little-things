import {
  defaultRuntimeFlags,
  isRuntimeGovernanceEnabled,
  isSliceEnabled,
  parseRuntimeFlags,
  RUNTIME_SLICES,
  type RuntimeFlags,
  type RuntimeSlice,
} from "../../src/shared/runtime/flags";

describe("runtime flag parsing and slice semantics", () => {
  it("defaults every flag to off when no env is provided", () => {
    const flags = parseRuntimeFlags({});

    expect(flags.governanceEnabled).toBe(false);
    for (const slice of RUNTIME_SLICES) {
      expect(flags.slices[slice]).toBe(false);
    }
  });

  it("produces a defaultRuntimeFlags() value equal to parseRuntimeFlags({})", () => {
    expect(defaultRuntimeFlags()).toEqual(parseRuntimeFlags({}));
  });

  it("enumerates exactly the canonical phase-1 per-slice flag set", () => {
    const expected: readonly RuntimeSlice[] = [
      "bff_db",
      "m1_ingest",
      "m2_scheduler",
      "m3_dispatch",
      "m4_billing",
      "frontend_runtime",
    ];
    expect(RUNTIME_SLICES).toEqual(expected);
  });

  it("reads the governance gate from RUNTIME_GOVERNANCE_ENABLED", () => {
    expect(parseRuntimeFlags({ RUNTIME_GOVERNANCE_ENABLED: "true" }).governanceEnabled).toBe(true);
    expect(parseRuntimeFlags({ RUNTIME_GOVERNANCE_ENABLED: "TRUE" }).governanceEnabled).toBe(true);
    expect(parseRuntimeFlags({ RUNTIME_GOVERNANCE_ENABLED: "false" }).governanceEnabled).toBe(false);
    expect(parseRuntimeFlags({ RUNTIME_GOVERNANCE_ENABLED: "0" }).governanceEnabled).toBe(false);
    expect(parseRuntimeFlags({ RUNTIME_GOVERNANCE_ENABLED: "" }).governanceEnabled).toBe(false);
  });

  it("reads each slice flag from its canonical environment variable", () => {
    const flags = parseRuntimeFlags({
      RUNTIME_GOVERNANCE_ENABLED: "true",
      RUNTIME_EMIT_BFF_DB: "true",
      RUNTIME_EMIT_M1_INGEST: "true",
      RUNTIME_EMIT_M2_SCHEDULER: "true",
      RUNTIME_EMIT_M3_DISPATCH: "true",
      RUNTIME_EMIT_M4_BILLING: "true",
      RUNTIME_FRONTEND_PAGE_ENABLED: "true",
    });

    expect(flags.slices.bff_db).toBe(true);
    expect(flags.slices.m1_ingest).toBe(true);
    expect(flags.slices.m2_scheduler).toBe(true);
    expect(flags.slices.m3_dispatch).toBe(true);
    expect(flags.slices.m4_billing).toBe(true);
    expect(flags.slices.frontend_runtime).toBe(true);
  });

  it("treats any non-true value (including undefined) as disabled", () => {
    const flags = parseRuntimeFlags({
      RUNTIME_GOVERNANCE_ENABLED: "yes",
      RUNTIME_EMIT_BFF_DB: "1",
      RUNTIME_EMIT_M1_INGEST: undefined,
      RUNTIME_EMIT_M2_SCHEDULER: "on",
    });

    expect(flags.governanceEnabled).toBe(false);
    expect(flags.slices.bff_db).toBe(false);
    expect(flags.slices.m1_ingest).toBe(false);
    expect(flags.slices.m2_scheduler).toBe(false);
  });

  it("isRuntimeGovernanceEnabled mirrors the global gate", () => {
    expect(isRuntimeGovernanceEnabled(parseRuntimeFlags({}))).toBe(false);
    expect(
      isRuntimeGovernanceEnabled(parseRuntimeFlags({ RUNTIME_GOVERNANCE_ENABLED: "true" })),
    ).toBe(true);
  });

  it("isSliceEnabled returns false when the global gate is off regardless of slice flag", () => {
    const flags = parseRuntimeFlags({
      RUNTIME_GOVERNANCE_ENABLED: "false",
      RUNTIME_EMIT_BFF_DB: "true",
      RUNTIME_EMIT_M1_INGEST: "true",
    });
    expect(isSliceEnabled(flags, "bff_db")).toBe(false);
    expect(isSliceEnabled(flags, "m1_ingest")).toBe(false);
  });

  it("isSliceEnabled returns true only when both the global gate and the per-slice flag are on", () => {
    const flags = parseRuntimeFlags({
      RUNTIME_GOVERNANCE_ENABLED: "true",
      RUNTIME_EMIT_BFF_DB: "true",
    });

    expect(isSliceEnabled(flags, "bff_db")).toBe(true);
    expect(isSliceEnabled(flags, "m1_ingest")).toBe(false);
    expect(isSliceEnabled(flags, "m2_scheduler")).toBe(false);
    expect(isSliceEnabled(flags, "m3_dispatch")).toBe(false);
    expect(isSliceEnabled(flags, "m4_billing")).toBe(false);
    expect(isSliceEnabled(flags, "frontend_runtime")).toBe(false);
  });

  it("parseRuntimeFlags returns a frozen structure so callers cannot mutate shared state", () => {
    const flags: RuntimeFlags = parseRuntimeFlags({});
    expect(Object.isFrozen(flags)).toBe(true);
    expect(Object.isFrozen(flags.slices)).toBe(true);
  });
});
