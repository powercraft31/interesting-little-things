import {
  PHASE1_SELF_CHECK_REGISTRY,
  applySelfCheckFail,
  applySelfCheckPass,
  applySelfCheckStale,
  buildInitialSelfCheckRow,
  getPhase1SelfCheckSpec,
  isPhase1RegistryComplete,
} from "../../src/shared/runtime/self-check";
import {
  PHASE1_SELF_CHECK_IDS,
  type RuntimeSelfCheckRow,
} from "../../src/shared/types/runtime";

describe("runtime self-check registry — phase-1", () => {
  it("covers every PHASE1_SELF_CHECK_ID exactly once", () => {
    const ids = PHASE1_SELF_CHECK_REGISTRY.map((s) => s.check_id).sort();
    expect(ids).toEqual([...PHASE1_SELF_CHECK_IDS].sort());
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("binds each mandatory id to a non-empty source and a positive cadence", () => {
    for (const spec of PHASE1_SELF_CHECK_REGISTRY) {
      expect(typeof spec.source).toBe("string");
      expect(spec.source.length).toBeGreaterThan(0);
      expect(spec.defaultCadenceSeconds).toBeGreaterThan(0);
    }
  });

  it("getPhase1SelfCheckSpec returns the registered spec and undefined for unknowns", () => {
    const spec = getPhase1SelfCheckSpec("db.app_pool.reachable");
    expect(spec).toBeDefined();
    expect(spec?.source).toBe("db");
    expect(getPhase1SelfCheckSpec("made.up.check")).toBeUndefined();
  });

  it("isPhase1RegistryComplete detects a registry that is missing a mandatory id", () => {
    expect(isPhase1RegistryComplete(PHASE1_SELF_CHECK_REGISTRY)).toBe(true);
    expect(
      isPhase1RegistryComplete(
        PHASE1_SELF_CHECK_REGISTRY.filter(
          (s) => s.check_id !== "bff.listen",
        ),
      ),
    ).toBe(false);
  });
});

describe("runtime self-check — buildInitialSelfCheckRow", () => {
  it("initializes a registered id with unknown status and zero failures", () => {
    const now = new Date("2026-04-18T09:00:00.000Z");
    const row = buildInitialSelfCheckRow("db.app_pool.reachable", { now });

    expect(row.check_id).toBe("db.app_pool.reachable");
    expect(row.source).toBe("db");
    expect(row.last_status).toBe("unknown");
    expect(row.last_run_at).toBeNull();
    expect(row.last_pass_at).toBeNull();
    expect(row.last_duration_ms).toBeNull();
    expect(row.consecutive_failures).toBe(0);
    expect(row.latest_detail).toBeNull();
    expect(row.updated_at).toBe("2026-04-18T09:00:00.000Z");
    expect(row.cadence_seconds).toBeGreaterThan(0);
  });

  it("accepts an override run_host and cadence", () => {
    const now = new Date("2026-04-18T09:00:00.000Z");
    const row = buildInitialSelfCheckRow("db.service_pool.reachable", {
      now,
      runHost: "host-a",
      cadenceSeconds: 60,
    });
    expect(row.run_host).toBe("host-a");
    expect(row.cadence_seconds).toBe(60);
  });

  it("throws on an unknown check_id so callers cannot invent phase-1 checks", () => {
    expect(() =>
      buildInitialSelfCheckRow("bogus.check" as never, { now: new Date() }),
    ).toThrow();
  });
});

describe("runtime self-check — pass/fail/stale latest-state semantics", () => {
  function existing(over: Partial<RuntimeSelfCheckRow> = {}): RuntimeSelfCheckRow {
    return {
      check_id: "db.app_pool.reachable",
      source: "db",
      run_host: "host-a",
      cadence_seconds: 30,
      last_status: "unknown",
      last_run_at: null,
      last_pass_at: null,
      last_duration_ms: null,
      consecutive_failures: 0,
      latest_detail: null,
      updated_at: "2026-04-18T08:00:00.000Z",
      ...over,
    };
  }

  it("applySelfCheckPass stamps pass, resets consecutive_failures, updates last_pass_at", () => {
    const before = existing({
      last_status: "fail",
      consecutive_failures: 2,
      last_pass_at: "2026-04-18T07:55:00.000Z",
    });
    const next = applySelfCheckPass(before, {
      runAt: "2026-04-18T09:00:00.000Z",
      durationMs: 12,
      now: new Date("2026-04-18T09:00:00.000Z"),
      detail: { ok: true },
    });

    expect(next.last_status).toBe("pass");
    expect(next.last_run_at).toBe("2026-04-18T09:00:00.000Z");
    expect(next.last_pass_at).toBe("2026-04-18T09:00:00.000Z");
    expect(next.last_duration_ms).toBe(12);
    expect(next.consecutive_failures).toBe(0);
    expect(next.latest_detail).toEqual({ ok: true });
    expect(next.updated_at).toBe("2026-04-18T09:00:00.000Z");
  });

  it("applySelfCheckFail increments consecutive_failures, preserves last_pass_at", () => {
    const before = existing({
      last_status: "pass",
      consecutive_failures: 0,
      last_pass_at: "2026-04-18T08:55:00.000Z",
    });
    const next = applySelfCheckFail(before, {
      runAt: "2026-04-18T09:00:00.000Z",
      durationMs: 52,
      now: new Date("2026-04-18T09:00:00.000Z"),
      detail: { err: "timeout" },
    });

    expect(next.last_status).toBe("fail");
    expect(next.last_run_at).toBe("2026-04-18T09:00:00.000Z");
    expect(next.last_pass_at).toBe("2026-04-18T08:55:00.000Z"); // preserved
    expect(next.last_duration_ms).toBe(52);
    expect(next.consecutive_failures).toBe(1);
    expect(next.latest_detail).toEqual({ err: "timeout" });
  });

  it("applySelfCheckFail accumulates consecutive_failures across multiple fails", () => {
    const a = applySelfCheckFail(existing(), {
      runAt: "2026-04-18T09:00:00.000Z",
      durationMs: 10,
      now: new Date("2026-04-18T09:00:00.000Z"),
    });
    const b = applySelfCheckFail(a, {
      runAt: "2026-04-18T09:00:30.000Z",
      durationMs: 10,
      now: new Date("2026-04-18T09:00:30.000Z"),
    });
    const c = applySelfCheckFail(b, {
      runAt: "2026-04-18T09:01:00.000Z",
      durationMs: 10,
      now: new Date("2026-04-18T09:01:00.000Z"),
    });

    expect(a.consecutive_failures).toBe(1);
    expect(b.consecutive_failures).toBe(2);
    expect(c.consecutive_failures).toBe(3);
  });

  it("applySelfCheckStale flips status to 'stale' without creating a new run record", () => {
    const before = existing({
      last_status: "pass",
      last_run_at: "2026-04-18T08:55:00.000Z",
      last_pass_at: "2026-04-18T08:55:00.000Z",
      last_duration_ms: 8,
      consecutive_failures: 0,
    });
    const next = applySelfCheckStale(before, {
      now: new Date("2026-04-18T09:10:00.000Z"),
      detail: { gap_seconds: 900 },
    });

    expect(next.last_status).toBe("stale");
    expect(next.last_run_at).toBe("2026-04-18T08:55:00.000Z"); // preserved, no new run
    expect(next.last_pass_at).toBe("2026-04-18T08:55:00.000Z"); // preserved
    expect(next.last_duration_ms).toBe(8); // preserved
    expect(next.updated_at).toBe("2026-04-18T09:10:00.000Z");
    expect(next.latest_detail).toEqual({ gap_seconds: 900 });
  });

  it("latest-state transitions do not mutate the input row", () => {
    const before = existing({ consecutive_failures: 1 });
    const snapshot = { ...before };
    applySelfCheckPass(before, {
      runAt: "2026-04-18T09:00:00.000Z",
      durationMs: 5,
      now: new Date("2026-04-18T09:00:00.000Z"),
    });
    applySelfCheckFail(before, {
      runAt: "2026-04-18T09:00:00.000Z",
      durationMs: 5,
      now: new Date("2026-04-18T09:00:00.000Z"),
    });
    applySelfCheckStale(before, {
      now: new Date("2026-04-18T09:00:00.000Z"),
    });
    expect(before).toEqual(snapshot);
  });
});
