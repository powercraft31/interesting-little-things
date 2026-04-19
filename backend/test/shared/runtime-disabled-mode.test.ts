import {
  buildDisabledRuntimePosture,
  isEmitterEnabled,
  runtimeDisabledHealth,
  type RuntimeDisabledPosture,
} from "../../src/shared/runtime/config";
import { parseRuntimeFlags } from "../../src/shared/runtime/flags";

describe("runtime disabled-mode helpers", () => {
  it("runtimeDisabledHealth returns overall='disabled' with empty component state", () => {
    const health = runtimeDisabledHealth();

    expect(health.overall).toBe("disabled");
    expect(health.components).toEqual([]);
    expect(health.criticalOpenCount).toBe(0);
    expect(health.selfCheckAllPass).toBe(false);
    expect(health.capturedAt).toBeNull();
  });

  it("buildDisabledRuntimePosture returns the canonical disabled API envelope", () => {
    const posture: RuntimeDisabledPosture = buildDisabledRuntimePosture();

    expect(posture.health.overall).toBe("disabled");
    expect(posture.issues).toEqual([]);
    expect(posture.events).toEqual([]);
    expect(posture.selfChecks).toEqual([]);
  });

  it("buildDisabledRuntimePosture always returns frozen collections to prevent accidental mutation", () => {
    const posture = buildDisabledRuntimePosture();

    expect(Object.isFrozen(posture)).toBe(true);
    expect(Object.isFrozen(posture.health)).toBe(true);
    expect(Object.isFrozen(posture.issues)).toBe(true);
    expect(Object.isFrozen(posture.events)).toBe(true);
    expect(Object.isFrozen(posture.selfChecks)).toBe(true);
  });

  it("isEmitterEnabled returns false when global governance is off even if the slice flag is true", () => {
    const flags = parseRuntimeFlags({
      RUNTIME_GOVERNANCE_ENABLED: "false",
      RUNTIME_EMIT_BFF_DB: "true",
      RUNTIME_EMIT_M3_DISPATCH: "true",
    });

    expect(isEmitterEnabled(flags, "bff_db")).toBe(false);
    expect(isEmitterEnabled(flags, "m3_dispatch")).toBe(false);
  });

  it("isEmitterEnabled returns true only when both the global gate and per-slice flag are true", () => {
    const flags = parseRuntimeFlags({
      RUNTIME_GOVERNANCE_ENABLED: "true",
      RUNTIME_EMIT_M3_DISPATCH: "true",
    });

    expect(isEmitterEnabled(flags, "m3_dispatch")).toBe(true);
    expect(isEmitterEnabled(flags, "m1_ingest")).toBe(false);
  });

  it("disabled posture survives default env (all flags off) without throwing", () => {
    expect(() => buildDisabledRuntimePosture()).not.toThrow();
    const flags = parseRuntimeFlags({});
    expect(isEmitterEnabled(flags, "bff_db")).toBe(false);
    expect(isEmitterEnabled(flags, "m1_ingest")).toBe(false);
    expect(isEmitterEnabled(flags, "m2_scheduler")).toBe(false);
    expect(isEmitterEnabled(flags, "m3_dispatch")).toBe(false);
    expect(isEmitterEnabled(flags, "m4_billing")).toBe(false);
    expect(isEmitterEnabled(flags, "frontend_runtime")).toBe(false);
  });
});
