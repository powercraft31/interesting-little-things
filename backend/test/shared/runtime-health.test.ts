import {
  allSelfChecksPassing,
  buildHealthSnapshotInput,
  countCriticalOpenIssues,
  deriveComponentStates,
  deriveOverallPosture,
  SELF_CHECK_CRITICAL_FAIL_THRESHOLD,
} from "../../src/shared/runtime/health";
import type {
  RuntimeIssue,
  RuntimePersistedOverall,
  RuntimeSelfCheckRow,
  RuntimeSeverity,
} from "../../src/shared/types/runtime";

function issue(over: Partial<RuntimeIssue> = {}): RuntimeIssue {
  return {
    fingerprint: over.fingerprint ?? "fp1",
    event_code: over.event_code ?? "db.critical_query.failed",
    source: over.source ?? "db",
    tenant_scope: over.tenant_scope ?? null,
    cycle_count: 1,
    current_cycle_started_at: "2026-04-18T09:00:00.000Z",
    first_detected_at: "2026-04-18T09:00:00.000Z",
    last_observed_at: "2026-04-18T09:01:00.000Z",
    recovered_at: null,
    closed_at: null,
    suppressed_until: null,
    state: over.state ?? "detected",
    current_severity: over.current_severity ?? ("critical" as RuntimeSeverity),
    observation_count: 1,
    summary: null,
    latest_detail: null,
    operator_note: null,
    operator_actor: null,
    updated_at: "2026-04-18T09:01:00.000Z",
    ...over,
  };
}

function check(over: Partial<RuntimeSelfCheckRow> = {}): RuntimeSelfCheckRow {
  return {
    check_id: over.check_id ?? "db.app_pool.reachable",
    source: over.source ?? "db",
    run_host: null,
    cadence_seconds: 30,
    last_status: over.last_status ?? "pass",
    last_run_at: "2026-04-18T09:00:00.000Z",
    last_pass_at: "2026-04-18T09:00:00.000Z",
    last_duration_ms: 10,
    consecutive_failures: over.consecutive_failures ?? 0,
    latest_detail: null,
    updated_at: "2026-04-18T09:00:00.000Z",
    ...over,
  };
}

describe("runtime health — deriveOverallPosture", () => {
  it("returns 'ok' when no active issues and all self-checks pass", () => {
    const posture = deriveOverallPosture({
      activeIssues: [],
      selfChecks: [check({ last_status: "pass" })],
    });
    expect(posture).toBe<RuntimePersistedOverall>("ok");
  });

  it("returns 'critical' when any active issue has severity critical", () => {
    const posture = deriveOverallPosture({
      activeIssues: [issue({ current_severity: "critical", state: "ongoing" })],
      selfChecks: [],
    });
    expect(posture).toBe<RuntimePersistedOverall>("critical");
  });

  it("returns 'degraded' for an active degraded issue with no critical", () => {
    const posture = deriveOverallPosture({
      activeIssues: [issue({ current_severity: "degraded", state: "ongoing" })],
      selfChecks: [],
    });
    expect(posture).toBe<RuntimePersistedOverall>("degraded");
  });

  it("returns 'warning' for an active warning/notice issue", () => {
    const w = deriveOverallPosture({
      activeIssues: [issue({ current_severity: "warning", state: "detected" })],
      selfChecks: [],
    });
    const n = deriveOverallPosture({
      activeIssues: [issue({ current_severity: "notice", state: "detected" })],
      selfChecks: [],
    });
    expect(w).toBe<RuntimePersistedOverall>("warning");
    expect(n).toBe<RuntimePersistedOverall>("warning");
  });

  it("ignores 'recovered' issues for overall severity", () => {
    const posture = deriveOverallPosture({
      activeIssues: [issue({ current_severity: "critical", state: "recovered" })],
      selfChecks: [],
    });
    expect(posture).toBe<RuntimePersistedOverall>("ok");
  });

  it("ignores 'closed' and 'suppressed' issues", () => {
    const posture = deriveOverallPosture({
      activeIssues: [
        issue({ current_severity: "critical", state: "closed" }),
        issue({ current_severity: "critical", state: "suppressed" }),
      ],
      selfChecks: [],
    });
    expect(posture).toBe<RuntimePersistedOverall>("ok");
  });

  it("escalates to 'critical' when a self-check exceeds the fail threshold", () => {
    const posture = deriveOverallPosture({
      activeIssues: [],
      selfChecks: [
        check({
          last_status: "fail",
          consecutive_failures: SELF_CHECK_CRITICAL_FAIL_THRESHOLD,
        }),
      ],
    });
    expect(posture).toBe<RuntimePersistedOverall>("critical");
  });

  it("escalates to 'warning' for a single failed self-check below the threshold", () => {
    const posture = deriveOverallPosture({
      activeIssues: [],
      selfChecks: [check({ last_status: "fail", consecutive_failures: 1 })],
    });
    expect(posture).toBe<RuntimePersistedOverall>("warning");
  });

  it("escalates to 'warning' for a stale self-check", () => {
    const posture = deriveOverallPosture({
      activeIssues: [],
      selfChecks: [check({ last_status: "stale" })],
    });
    expect(posture).toBe<RuntimePersistedOverall>("warning");
  });

  it("takes the worst of (issue, self-check) contributions", () => {
    const posture = deriveOverallPosture({
      activeIssues: [issue({ current_severity: "warning", state: "detected" })],
      selfChecks: [
        check({
          last_status: "fail",
          consecutive_failures: SELF_CHECK_CRITICAL_FAIL_THRESHOLD + 1,
        }),
      ],
    });
    expect(posture).toBe<RuntimePersistedOverall>("critical");
  });

  it("never returns 'disabled' from derivation (disabled is API-layer only)", () => {
    const result = deriveOverallPosture({
      activeIssues: [],
      selfChecks: [],
    });
    expect(["ok", "warning", "degraded", "critical"]).toContain(result);
    expect(result).not.toBe("disabled");
  });
});

describe("runtime health — deriveComponentStates", () => {
  it("assigns per-source worst-case overall state", () => {
    const components = deriveComponentStates({
      activeIssues: [
        issue({ source: "db", current_severity: "critical", state: "ongoing" }),
        issue({ source: "m1.ingest", current_severity: "warning", state: "detected" }),
      ],
      selfChecks: [
        check({ check_id: "bff.listen", source: "bff", last_status: "pass" }),
      ],
    });

    expect(components.db).toBe("critical");
    expect(components["m1.ingest"]).toBe("warning");
  });

  it("does not emit components for recovered/closed/suppressed-only sources unless self-checks exist", () => {
    const components = deriveComponentStates({
      activeIssues: [
        issue({ source: "m3.dispatch", current_severity: "critical", state: "recovered" }),
      ],
      selfChecks: [],
    });
    expect(components["m3.dispatch"]).toBeUndefined();
  });

  it("reflects self-check failures for sources without active issues", () => {
    const components = deriveComponentStates({
      activeIssues: [],
      selfChecks: [
        check({
          check_id: "bff.listen",
          source: "bff",
          last_status: "fail",
          consecutive_failures: SELF_CHECK_CRITICAL_FAIL_THRESHOLD,
        }),
      ],
    });
    expect(components.bff).toBe("critical");
  });
});

describe("runtime health — buildHealthSnapshotInput", () => {
  it("produces a persisted snapshot input (overall never 'disabled')", () => {
    const input = buildHealthSnapshotInput({
      activeIssues: [issue({ current_severity: "critical", state: "ongoing" })],
      selfChecks: [check({ last_status: "pass" })],
      capturedAt: "2026-04-18T09:05:00.000Z",
      snapshotSource: "spine.periodic",
    });

    expect(input.captured_at).toBe("2026-04-18T09:05:00.000Z");
    expect(input.snapshot_source).toBe("spine.periodic");
    expect(input.overall).toBe("critical");
    expect(input.self_check_all_pass).toBe(true);
    expect(input.critical_open_count).toBe(1);
    expect(input.component_states.db).toBe("critical");
  });

  it("self_check_all_pass is false when any check is not pass", () => {
    const input = buildHealthSnapshotInput({
      activeIssues: [],
      selfChecks: [check({ last_status: "fail" })],
      capturedAt: "2026-04-18T09:05:00.000Z",
      snapshotSource: "spine.periodic",
    });
    expect(input.self_check_all_pass).toBe(false);
  });

  it("critical_open_count only counts detected/ongoing critical issues", () => {
    const input = buildHealthSnapshotInput({
      activeIssues: [
        issue({ fingerprint: "a", current_severity: "critical", state: "ongoing" }),
        issue({ fingerprint: "b", current_severity: "critical", state: "recovered" }),
        issue({ fingerprint: "c", current_severity: "warning", state: "detected" }),
      ],
      selfChecks: [],
      capturedAt: "2026-04-18T09:05:00.000Z",
      snapshotSource: "spine.periodic",
    });
    expect(input.critical_open_count).toBe(1);
  });

  it("restricts overall to the 4 persisted values, never 'disabled'", () => {
    const input = buildHealthSnapshotInput({
      activeIssues: [],
      selfChecks: [],
      capturedAt: "2026-04-18T09:05:00.000Z",
      snapshotSource: "spine.periodic",
    });
    expect(["ok", "warning", "degraded", "critical"]).toContain(input.overall);
  });

  it("drops overall posture out of 'critical' when the sole critical DB issue transitions to 'recovered' and self-checks pass (I2 live-recovery semantics)", () => {
    // Exactly reproduces Ryan's live I2 sequence: the only critical runtime
    // issue was db.app_pool.unreachable; after a healthy probe cycle, the
    // canonical recovery lifecycle moves it to state='recovered' and the
    // three DB self-checks return to pass. Health must no longer report
    // critical on the strength of that recovered fault.
    const recoveredDbIssue = issue({
      fingerprint: "bf0a9ca2cad97844291e7443c0c3ba58",
      event_code: "db.app_pool.unreachable",
      source: "db",
      state: "recovered",
      recovered_at: "2026-04-18T11:00:00.000Z",
      current_severity: "critical",
    });
    const healthyChecks = [
      check({ check_id: "db.app_pool.reachable", last_status: "pass" }),
      check({ check_id: "db.service_pool.reachable", last_status: "pass" }),
      check({ check_id: "db.critical_query", last_status: "pass" }),
    ];

    const overall = deriveOverallPosture({
      activeIssues: [recoveredDbIssue],
      selfChecks: healthyChecks,
    });
    expect(overall).toBe("ok");
    expect(countCriticalOpenIssues([recoveredDbIssue])).toBe(0);
    expect(allSelfChecksPassing(healthyChecks)).toBe(true);

    const snapshot = buildHealthSnapshotInput({
      activeIssues: [recoveredDbIssue],
      selfChecks: healthyChecks,
      capturedAt: "2026-04-18T11:00:01.000Z",
      snapshotSource: "spine.periodic",
    });
    expect(snapshot.overall).toBe("ok");
    expect(snapshot.critical_open_count).toBe(0);
    expect(snapshot.self_check_all_pass).toBe(true);
    // The 'db' component must not remain pinned to 'critical' on a recovered-only fault.
    expect(snapshot.component_states.db ?? "ok").not.toBe("critical");
  });
});
