import { normalizeEventInput } from "../../src/shared/runtime/contract";
import {
  applyOperatorClose,
  applyOperatorNote,
  applyOperatorSuppress,
  projectEventToIssue,
} from "../../src/shared/runtime/projection";
import type { RuntimeIssue } from "../../src/shared/types/runtime";

function detectEvent(overrides: {
  event_code?: string;
  source?: string;
  occurred_at?: string;
  observed_at?: string;
  tenant_scope?: string | null;
  severity?: "info" | "notice" | "warning" | "degraded" | "critical";
  detail?: Record<string, unknown> | null;
  summary?: string | null;
  lifecycle?: "detect" | "ongoing" | "recover" | "close" | "suppress" | null;
} = {}) {
  return normalizeEventInput({
    event_code: overrides.event_code ?? "db.critical_query.failed",
    source: overrides.source ?? "db",
    tenant_scope: overrides.tenant_scope ?? null,
    severity: overrides.severity,
    summary: overrides.summary ?? "db probe failed",
    detail: overrides.detail ?? null,
    lifecycle_hint: overrides.lifecycle === undefined ? "detect" : overrides.lifecycle,
    occurred_at: overrides.occurred_at,
    observed_at: overrides.observed_at,
  });
}

describe("projectEventToIssue — detect path", () => {
  it("creates a new issue row on first detect (one row per fingerprint)", () => {
    const event = detectEvent({ observed_at: "2026-04-18T09:00:00.000Z" });
    const result = projectEventToIssue({ event });

    expect(result.isNew).toBe(true);
    expect(result.cycleStarted).toBe(true);
    expect(result.row.fingerprint).toBe(event.fingerprint);
    expect(result.row.event_code).toBe(event.event_code);
    expect(result.row.source).toBe(event.source);
    expect(result.row.state).toBe("detected");
    expect(result.row.cycle_count).toBe(1);
    expect(result.row.observation_count).toBe(1);
    expect(result.row.first_detected_at).toBe(event.observed_at);
    expect(result.row.current_cycle_started_at).toBe(event.observed_at);
    expect(result.row.last_observed_at).toBe(event.observed_at);
    expect(result.row.recovered_at).toBeNull();
    expect(result.row.closed_at).toBeNull();
    expect(result.row.current_severity).toBe(event.severity);
  });

  it("updates the SAME fingerprint row on a repeat observation and increments observation_count", () => {
    const first = detectEvent({ observed_at: "2026-04-18T09:00:00.000Z" });
    const second = detectEvent({ observed_at: "2026-04-18T09:01:00.000Z" });
    const initial = projectEventToIssue({ event: first }).row;

    const result = projectEventToIssue({ event: second, existing: initial });

    expect(result.isNew).toBe(false);
    expect(result.cycleStarted).toBe(false);
    expect(result.row.fingerprint).toBe(initial.fingerprint);
    expect(result.row.cycle_count).toBe(1);
    expect(result.row.observation_count).toBe(2);
    expect(result.row.state).toBe("ongoing");
    expect(result.row.last_observed_at).toBe(second.observed_at);
    expect(result.row.first_detected_at).toBe(first.observed_at);
    expect(result.row.current_cycle_started_at).toBe(first.observed_at);
  });

  it("captures the highest-severity observation for the current cycle", () => {
    const first = detectEvent({
      severity: "warning",
      observed_at: "2026-04-18T09:00:00.000Z",
    });
    const second = detectEvent({
      severity: "critical",
      observed_at: "2026-04-18T09:05:00.000Z",
    });
    const third = detectEvent({
      severity: "notice",
      observed_at: "2026-04-18T09:10:00.000Z",
    });

    const r1 = projectEventToIssue({ event: first }).row;
    const r2 = projectEventToIssue({ event: second, existing: r1 }).row;
    const r3 = projectEventToIssue({ event: third, existing: r2 }).row;

    expect(r2.current_severity).toBe("critical");
    expect(r3.current_severity).toBe("critical");
  });
});

describe("projectEventToIssue — recover / close / suppress", () => {
  it("recover transitions detected/ongoing → recovered and stamps recovered_at", () => {
    const d = detectEvent({ observed_at: "2026-04-18T09:00:00.000Z" });
    const r = detectEvent({
      observed_at: "2026-04-18T09:05:00.000Z",
      lifecycle: "recover",
    });
    const afterDetect = projectEventToIssue({ event: d }).row;
    const afterRecover = projectEventToIssue({
      event: r,
      existing: afterDetect,
    }).row;

    expect(afterRecover.state).toBe("recovered");
    expect(afterRecover.recovered_at).toBe(r.observed_at);
    expect(afterRecover.cycle_count).toBe(1);
  });

  it("operator close → closed, records closed_at and actor", () => {
    const d = detectEvent({ observed_at: "2026-04-18T09:00:00.000Z" });
    const initial = projectEventToIssue({ event: d }).row;

    const closed = applyOperatorClose(initial, {
      actor: "ops@solfacil",
      note: "manually closed",
      now: new Date("2026-04-18T09:30:00.000Z"),
    });

    expect(closed.state).toBe("closed");
    expect(closed.closed_at).toBe("2026-04-18T09:30:00.000Z");
    expect(closed.operator_actor).toBe("ops@solfacil");
    expect(closed.operator_note).toBe("manually closed");
    expect(closed.cycle_count).toBe(1);
  });

  it("operator suppress → suppressed with suppressed_until; remains distinct from closed", () => {
    const d = detectEvent({ observed_at: "2026-04-18T09:00:00.000Z" });
    const initial = projectEventToIssue({ event: d }).row;
    const suppressed = applyOperatorSuppress(initial, {
      actor: "ops@solfacil",
      until: "2026-04-19T09:00:00.000Z",
      note: "noise during maintenance",
      now: new Date("2026-04-18T09:30:00.000Z"),
    });

    expect(suppressed.state).toBe("suppressed");
    expect(suppressed.suppressed_until).toBe("2026-04-19T09:00:00.000Z");
    expect(suppressed.closed_at).toBeNull();
    // Cycle still exists — suppressed mutes; it does not close.
    expect(suppressed.cycle_count).toBe(initial.cycle_count);
  });

  it("operator note preserves current state and records actor/note", () => {
    const d = detectEvent();
    const initial = projectEventToIssue({ event: d }).row;
    const annotated = applyOperatorNote(initial, {
      actor: "ops@solfacil",
      note: "investigating",
      now: new Date("2026-04-18T09:15:00.000Z"),
    });

    expect(annotated.state).toBe(initial.state);
    expect(annotated.operator_note).toBe("investigating");
    expect(annotated.operator_actor).toBe("ops@solfacil");
  });
});

describe("projectEventToIssue — reopen semantics", () => {
  it("reopen after recovered increments cycle_count on the same fingerprint row", () => {
    const d1 = detectEvent({ observed_at: "2026-04-18T08:00:00.000Z" });
    const r1 = detectEvent({
      observed_at: "2026-04-18T08:05:00.000Z",
      lifecycle: "recover",
    });
    const d2 = detectEvent({ observed_at: "2026-04-18T09:00:00.000Z" });

    const afterDetect1 = projectEventToIssue({ event: d1 }).row;
    const afterRecover = projectEventToIssue({
      event: r1,
      existing: afterDetect1,
    }).row;
    const reopen = projectEventToIssue({ event: d2, existing: afterRecover });

    expect(reopen.cycleStarted).toBe(true);
    expect(reopen.row.fingerprint).toBe(afterRecover.fingerprint);
    expect(reopen.row.cycle_count).toBe(2);
    expect(reopen.row.state).toBe("detected");
    expect(reopen.row.current_cycle_started_at).toBe(d2.observed_at);
    expect(reopen.row.first_detected_at).toBe(d1.observed_at); // preserved
    expect(reopen.row.recovered_at).toBeNull(); // cleared for new cycle
    expect(reopen.row.closed_at).toBeNull();
    expect(reopen.row.observation_count).toBe(1); // reset per cycle
  });

  it("reopen after closed increments cycle_count and clears closed_at", () => {
    const d1 = detectEvent({ observed_at: "2026-04-18T08:00:00.000Z" });
    const initial = projectEventToIssue({ event: d1 }).row;
    const closed = applyOperatorClose(initial, {
      actor: "ops@solfacil",
      now: new Date("2026-04-18T08:30:00.000Z"),
    });

    const d2 = detectEvent({ observed_at: "2026-04-18T09:00:00.000Z" });
    const reopen = projectEventToIssue({ event: d2, existing: closed });

    expect(reopen.row.cycle_count).toBe(2);
    expect(reopen.row.state).toBe("detected");
    expect(reopen.row.closed_at).toBeNull();
  });

  it("detect while suppressed does not reopen — it updates last_observed_at but stays suppressed", () => {
    const d1 = detectEvent({ observed_at: "2026-04-18T08:00:00.000Z" });
    const initial = projectEventToIssue({ event: d1 }).row;
    const suppressed = applyOperatorSuppress(initial, {
      actor: "ops@solfacil",
      until: "2026-04-19T00:00:00.000Z",
      now: new Date("2026-04-18T08:30:00.000Z"),
    });

    const d2 = detectEvent({ observed_at: "2026-04-18T09:00:00.000Z" });
    const result = projectEventToIssue({ event: d2, existing: suppressed });

    expect(result.row.state).toBe("suppressed");
    expect(result.cycleStarted).toBe(false);
    expect(result.row.cycle_count).toBe(1);
    expect(result.row.last_observed_at).toBe(d2.observed_at);
  });
});

describe("projectEventToIssue — immutability", () => {
  it("does not mutate the existing issue row passed in", () => {
    const d1 = detectEvent({ observed_at: "2026-04-18T09:00:00.000Z" });
    const initial: RuntimeIssue = projectEventToIssue({ event: d1 }).row;
    const snapshot = { ...initial };

    const d2 = detectEvent({ observed_at: "2026-04-18T09:01:00.000Z" });
    projectEventToIssue({ event: d2, existing: initial });

    expect(initial).toEqual(snapshot);
  });
});
