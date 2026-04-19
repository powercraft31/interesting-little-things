import {
  RUNTIME_EVENT_CODES,
  computeFingerprint,
  getEventCodeSpec,
  isKnownEventCode,
  normalizeEventInput,
} from "../../src/shared/runtime/contract";
import type { RuntimeEventInput } from "../../src/shared/types/runtime";
import { RUNTIME_SEVERITIES } from "../../src/shared/types/runtime";

describe("runtime contract registry", () => {
  it("registers every phase-1 emitter source family with stable source/severity metadata", () => {
    const sources = new Set(RUNTIME_EVENT_CODES.map((spec) => spec.source));
    // Mandatory phase-1 source families (bff, db, m1.ingest, m2, m3, m4).
    expect(sources.has("bff")).toBe(true);
    expect(sources.has("db")).toBe(true);
    expect(sources.has("m1.ingest")).toBe(true);
    expect(sources.has("m3.dispatch")).toBe(true);
    expect(sources.has("m2.scheduler")).toBe(true);
    expect(sources.has("m4.billing")).toBe(true);
  });

  it("registry is a closed list with unique event codes and valid severities/lifecycle hints", () => {
    const codes = RUNTIME_EVENT_CODES.map((spec) => spec.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const spec of RUNTIME_EVENT_CODES) {
      expect(RUNTIME_SEVERITIES).toContain(spec.defaultSeverity);
      expect(["detect", "ongoing", "recover", "close", "suppress", null]).toContain(
        spec.defaultLifecycle,
      );
      expect(spec.dedupDimensions.length).toBeGreaterThan(0);
    }
  });

  it("isKnownEventCode rejects unknown codes and accepts registered ones", () => {
    expect(isKnownEventCode("made.up.code")).toBe(false);
    expect(isKnownEventCode(RUNTIME_EVENT_CODES[0].code)).toBe(true);
  });

  it("getEventCodeSpec returns the spec for a known code and undefined otherwise", () => {
    const spec = RUNTIME_EVENT_CODES[0];
    expect(getEventCodeSpec(spec.code)).toEqual(spec);
    expect(getEventCodeSpec("does.not.exist")).toBeUndefined();
  });
});

describe("runtime fingerprint", () => {
  it("is deterministic for identical inputs", () => {
    const input: RuntimeEventInput = {
      event_code: "db.critical_query.failed",
      source: "db",
      tenant_scope: null,
    };
    expect(computeFingerprint(input)).toBe(computeFingerprint(input));
  });

  it("produces a short stable hex digest (not a raw JSON string)", () => {
    const fp = computeFingerprint({
      event_code: "db.critical_query.failed",
      source: "db",
    });
    expect(fp).toMatch(/^[0-9a-f]{16,64}$/);
  });

  it("differs when event_code differs", () => {
    const a = computeFingerprint({
      event_code: "db.critical_query.failed",
      source: "db",
    });
    const b = computeFingerprint({
      event_code: "db.app_pool.unreachable",
      source: "db",
    });
    expect(a).not.toBe(b);
  });

  it("differs when source differs", () => {
    const a = computeFingerprint({ event_code: "x.y", source: "bff" });
    const b = computeFingerprint({ event_code: "x.y", source: "m1.ingest" });
    expect(a).not.toBe(b);
  });

  it("folds tenant_scope into the fingerprint when dedup dimensions include it", () => {
    const spec = RUNTIME_EVENT_CODES.find((s) =>
      s.dedupDimensions.includes("tenant_scope"),
    );
    if (!spec) {
      throw new Error("registry must contain at least one tenant-scoped code");
    }
    const a = computeFingerprint({
      event_code: spec.code,
      source: spec.source,
      tenant_scope: "ORG_A",
    });
    const b = computeFingerprint({
      event_code: spec.code,
      source: spec.source,
      tenant_scope: "ORG_B",
    });
    expect(a).not.toBe(b);
  });

  it("ignores fields not declared as dedup dimensions", () => {
    const input1: RuntimeEventInput = {
      event_code: "db.critical_query.failed",
      source: "db",
      summary: "failed A",
      detail: { note: "A" },
    };
    const input2: RuntimeEventInput = {
      event_code: "db.critical_query.failed",
      source: "db",
      summary: "failed B",
      detail: { note: "B" },
    };
    expect(computeFingerprint(input1)).toBe(computeFingerprint(input2));
  });

  it("respects explicit dedup_keys overrides", () => {
    const a = computeFingerprint({
      event_code: "db.critical_query.failed",
      source: "db",
      dedup_keys: { query_id: "q1" },
    });
    const b = computeFingerprint({
      event_code: "db.critical_query.failed",
      source: "db",
      dedup_keys: { query_id: "q2" },
    });
    expect(a).not.toBe(b);
  });

  it("prefers an explicit fingerprint on the input when provided", () => {
    const explicit = "deadbeefdeadbeef";
    expect(
      computeFingerprint({
        event_code: "db.critical_query.failed",
        source: "db",
        fingerprint: explicit,
      }),
    ).toBe(explicit);
  });
});

describe("normalizeEventInput", () => {
  it("applies registry defaults for severity and lifecycle when omitted", () => {
    const spec = RUNTIME_EVENT_CODES[0];
    const normalized = normalizeEventInput({
      event_code: spec.code,
      source: spec.source,
    });
    expect(normalized.severity).toBe(spec.defaultSeverity);
    expect(normalized.lifecycle_hint).toBe(spec.defaultLifecycle);
    expect(normalized.fingerprint).toMatch(/^[0-9a-f]{16,64}$/);
    expect(typeof normalized.event_id).toBe("string");
    expect(normalized.event_id.length).toBeGreaterThan(0);
    expect(normalized.observed_at).toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(normalized.occurred_at).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it("honors caller-supplied severity and lifecycle", () => {
    const spec = RUNTIME_EVENT_CODES[0];
    const normalized = normalizeEventInput({
      event_code: spec.code,
      source: spec.source,
      severity: "critical",
      lifecycle_hint: "recover",
    });
    expect(normalized.severity).toBe("critical");
    expect(normalized.lifecycle_hint).toBe("recover");
  });

  it("throws for an unregistered event code so emitters cannot invent semantics", () => {
    expect(() =>
      normalizeEventInput({ event_code: "totally.fake", source: "m1.ingest" }),
    ).toThrow();
  });
});
