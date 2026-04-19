/**
 * WS6 — M2 optimization scheduler runtime emitters.
 *
 * Contract under test:
 *  - scheduler.schedule_generator.heartbeat / .failed / .missed_run are emitted
 *    via the existing M9 shared emit surface, under slice "m2_scheduler" and
 *    source "m2.scheduler".
 *  - scheduler.jobs.alive self-check is upserted through upsertRuntimeSelfCheck
 *    with check_id "scheduler.jobs.alive" and source "m2.scheduler", using the
 *    M9 pass helper exclusively. Detail carries a contributor marker so M2's
 *    evidence stays distinguishable from other contributors (M4 billing, …).
 *  - Every helper is strictly best-effort: returns 'disabled' when the global
 *    gate or slice is off, and 'degraded_fallback' (never throws) when the
 *    underlying DB path fails.
 *  - Failed/missed_run fingerprints dedup sensibly so distinct phases/gaps
 *    project to distinct runtime_issues rows without collapsing legitimate
 *    optimization scheduler failure modes.
 */

import { parseRuntimeFlags } from "../../src/shared/runtime/flags";
import type { RuntimeQueryable } from "../../src/shared/runtime/persistence";
import {
  emitSchedulerFailed,
  emitSchedulerHeartbeat,
  emitSchedulerMissedRun,
  emitSchedulerRecovered,
  maybeEmitSchedulerRecovered,
  recordSchedulerJobsAlive,
  schedulerFailedFingerprintFor,
} from "../../src/shared/runtime/scheduler-emitters";
import type {
  RuntimeIssue,
  RuntimeIssueState,
} from "../../src/shared/types/runtime";

type QueryCall = { sql: string; params: readonly unknown[] };

function makeRecordingClient(): RuntimeQueryable & { calls: QueryCall[] } {
  const calls: QueryCall[] = [];
  const client: RuntimeQueryable = {
    async query<R extends Record<string, unknown> = Record<string, unknown>>(
      sql: string,
      params: readonly unknown[] = [],
    ) {
      calls.push({ sql, params });
      return { rows: [] as unknown as readonly R[] };
    },
  };
  return Object.assign(client, { calls });
}

const FLAGS_ON = parseRuntimeFlags({
  RUNTIME_GOVERNANCE_ENABLED: "true",
  RUNTIME_EMIT_M2_SCHEDULER: "true",
});

const FLAGS_OFF = parseRuntimeFlags({});

const FLAGS_GATE_ONLY = parseRuntimeFlags({
  RUNTIME_GOVERNANCE_ENABLED: "true",
});

function findInsertEvent(calls: QueryCall[]): QueryCall | undefined {
  return calls.find((c) => /INSERT INTO runtime_events/.test(c.sql));
}

function findUpsertSelfCheck(calls: QueryCall[]): QueryCall | undefined {
  return calls.find((c) => /INSERT INTO runtime_self_checks/.test(c.sql));
}

describe("emitSchedulerHeartbeat", () => {
  it("emits scheduler.schedule_generator.heartbeat with run-scoped detail", async () => {
    const client = makeRecordingClient();
    const runStartedAt = new Date("2026-04-18T10:00:00.000Z");
    const result = await emitSchedulerHeartbeat(
      { flags: FLAGS_ON, client },
      {
        assetsProcessed: 47,
        slotsGenerated: 1128,
        runStartedAt,
        durationMs: 812,
      },
    );
    expect(result.status).toBe("persisted");
    const insert = findInsertEvent(client.calls);
    expect(insert).toBeDefined();
    expect(insert?.params[1]).toBe("scheduler.schedule_generator.heartbeat");
    expect(insert?.params[2]).toBe("m2.scheduler");

    const detailJson = String(insert?.params[11]);
    expect(detailJson).toMatch(/"assets_processed":47/);
    expect(detailJson).toMatch(/"slots_generated":1128/);
    expect(detailJson).toMatch(/"duration_ms":812/);
    expect(detailJson).toMatch(/"run_started_at":"2026-04-18T10:00:00\.000Z"/);
  });

  it("is a no-op when governance gate is off", async () => {
    const client = makeRecordingClient();
    const result = await emitSchedulerHeartbeat(
      { flags: FLAGS_OFF, client },
      {
        assetsProcessed: 1,
        slotsGenerated: 1,
        runStartedAt: new Date(),
        durationMs: 10,
      },
    );
    expect(result.status).toBe("disabled");
    expect(client.calls).toHaveLength(0);
  });

  it("is a no-op when m2_scheduler slice is off even with governance on", async () => {
    const client = makeRecordingClient();
    const result = await emitSchedulerHeartbeat(
      { flags: FLAGS_GATE_ONLY, client },
      {
        assetsProcessed: 1,
        slotsGenerated: 1,
        runStartedAt: new Date(),
        durationMs: 10,
      },
    );
    expect(result.status).toBe("disabled");
    expect(client.calls).toHaveLength(0);
  });

  it("swallows underlying persistence failure and returns degraded_fallback", async () => {
    const failing: RuntimeQueryable = {
      async query() {
        throw new Error("db-down");
      },
    };
    let threw = false;
    let result: Awaited<ReturnType<typeof emitSchedulerHeartbeat>> | null = null;
    try {
      result = await emitSchedulerHeartbeat(
        { flags: FLAGS_ON, client: failing, logger: () => {} },
        {
          assetsProcessed: 0,
          slotsGenerated: 0,
          runStartedAt: new Date(),
          durationMs: 0,
        },
      );
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(result?.status).toBe("degraded_fallback");
  });
});

describe("emitSchedulerFailed", () => {
  it("emits scheduler.schedule_generator.failed with phase folded into dedup", async () => {
    const client = makeRecordingClient();
    const result = await emitSchedulerFailed(
      { flags: FLAGS_ON, client },
      {
        error: new Error("pld_horario query failed"),
        phase: "pld_fetch",
        assetId: "ASSET_SP_001",
      },
    );
    expect(result.status).toBe("persisted");
    const insert = findInsertEvent(client.calls);
    expect(insert?.params[1]).toBe("scheduler.schedule_generator.failed");
    expect(insert?.params[2]).toBe("m2.scheduler");
    const detailJson = String(insert?.params[11]);
    expect(detailJson).toMatch(/"error":"pld_horario query failed"/);
    expect(detailJson).toMatch(/"phase":"pld_fetch"/);
    expect(detailJson).toMatch(/"asset_id":"ASSET_SP_001"/);
  });

  it("produces distinct fingerprints per phase so distinct failure modes stay distinct", async () => {
    const clientA = makeRecordingClient();
    const clientB = makeRecordingClient();
    const a = await emitSchedulerFailed(
      { flags: FLAGS_ON, client: clientA },
      { error: new Error("x"), phase: "pld_fetch" },
    );
    const b = await emitSchedulerFailed(
      { flags: FLAGS_ON, client: clientB },
      { error: new Error("x"), phase: "asset_scan" },
    );
    expect(a.event?.fingerprint).not.toBe(b.event?.fingerprint);
  });

  it("is a no-op when m2_scheduler slice is off", async () => {
    const client = makeRecordingClient();
    const result = await emitSchedulerFailed(
      { flags: FLAGS_OFF, client },
      { error: new Error("x") },
    );
    expect(result.status).toBe("disabled");
    expect(client.calls).toHaveLength(0);
  });

  it("never throws even if persistence blows up", async () => {
    const failing: RuntimeQueryable = {
      async query() {
        throw new Error("ded");
      },
    };
    let threw = false;
    try {
      await emitSchedulerFailed(
        { flags: FLAGS_ON, client: failing, logger: () => {} },
        { error: new Error("y") },
      );
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });
});

describe("emitSchedulerMissedRun", () => {
  it("emits scheduler.schedule_generator.missed_run with gap and expected interval", async () => {
    const client = makeRecordingClient();
    const result = await emitSchedulerMissedRun(
      { flags: FLAGS_ON, client },
      {
        lastObservedAt: new Date("2026-04-18T08:00:00.000Z"),
        observedAt: new Date("2026-04-18T10:30:00.000Z"),
        gapMs: 9_000_000,
        expectedIntervalMs: 3_600_000,
      },
    );
    expect(result.status).toBe("persisted");
    const insert = findInsertEvent(client.calls);
    expect(insert?.params[1]).toBe("scheduler.schedule_generator.missed_run");
    expect(insert?.params[2]).toBe("m2.scheduler");
    const detailJson = String(insert?.params[11]);
    expect(detailJson).toMatch(/"gap_ms":9000000/);
    expect(detailJson).toMatch(/"expected_interval_ms":3600000/);
  });

  it("is a no-op when governance gate is off", async () => {
    const client = makeRecordingClient();
    const result = await emitSchedulerMissedRun(
      { flags: FLAGS_OFF, client },
      {
        lastObservedAt: new Date(),
        observedAt: new Date(),
        gapMs: 99_999,
        expectedIntervalMs: 3_600_000,
      },
    );
    expect(result.status).toBe("disabled");
    expect(client.calls).toHaveLength(0);
  });
});

describe("recordSchedulerJobsAlive", () => {
  it("upserts scheduler.jobs.alive with last_status='pass' and m2 contributor marker", async () => {
    const client = makeRecordingClient();
    const observedAt = new Date("2026-04-18T10:05:00.000Z");
    const result = await recordSchedulerJobsAlive(
      { flags: FLAGS_ON, client, now: observedAt },
      {
        observedAt,
        durationMs: 812,
        detail: { assets_processed: 47 },
      },
    );
    expect(result.status).toBe("persisted");

    const upsert = findUpsertSelfCheck(client.calls);
    expect(upsert).toBeDefined();
    // upsertRuntimeSelfCheck binds: check_id, source, run_host, cadence_seconds,
    //   last_status, last_run_at, last_pass_at, last_duration_ms,
    //   consecutive_failures, latest_detail, updated_at
    expect(upsert?.params[0]).toBe("scheduler.jobs.alive");
    expect(upsert?.params[1]).toBe("m2.scheduler");
    expect(upsert?.params[4]).toBe("pass");
    expect(upsert?.params[5]).toBe(observedAt.toISOString()); // last_run_at
    expect(upsert?.params[6]).toBe(observedAt.toISOString()); // last_pass_at
    expect(upsert?.params[7]).toBe(812);
    const detailJson = String(upsert?.params[9]);
    expect(detailJson).toMatch(/"contributor":"m2\.scheduler"/);
    expect(detailJson).toMatch(/"assets_processed":47/);
  });

  it("is a no-op with status='disabled' when the governance gate is off", async () => {
    const client = makeRecordingClient();
    const result = await recordSchedulerJobsAlive(
      { flags: FLAGS_OFF, client },
      { observedAt: new Date(), durationMs: 1 },
    );
    expect(result.status).toBe("disabled");
    expect(client.calls).toHaveLength(0);
  });

  it("is a no-op when m2_scheduler slice is off even with governance on", async () => {
    const client = makeRecordingClient();
    const result = await recordSchedulerJobsAlive(
      { flags: FLAGS_GATE_ONLY, client },
      { observedAt: new Date(), durationMs: 1 },
    );
    expect(result.status).toBe("disabled");
    expect(client.calls).toHaveLength(0);
  });

  it("never throws and returns degraded_fallback on persistence failure", async () => {
    const failing: RuntimeQueryable = {
      async query() {
        throw new Error("pg-gone");
      },
    };
    let threw = false;
    let result: Awaited<ReturnType<typeof recordSchedulerJobsAlive>> | null = null;
    try {
      result = await recordSchedulerJobsAlive(
        { flags: FLAGS_ON, client: failing, logger: () => {} },
        { observedAt: new Date(), durationMs: 1 },
      );
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(result?.status).toBe("degraded_fallback");
  });
});

function makeIssueRow(over: Partial<RuntimeIssue>): RuntimeIssue {
  return {
    fingerprint: over.fingerprint ?? "fp",
    event_code: over.event_code ?? "scheduler.schedule_generator.failed",
    source: over.source ?? "m2.scheduler",
    tenant_scope: over.tenant_scope ?? null,
    cycle_count: 1,
    current_cycle_started_at: "2026-04-18T15:20:00.000Z",
    first_detected_at: "2026-04-18T15:20:00.000Z",
    last_observed_at: "2026-04-18T15:25:00.000Z",
    recovered_at: over.recovered_at ?? null,
    closed_at: null,
    suppressed_until: null,
    state: over.state ?? "detected",
    current_severity: "degraded",
    observation_count: 1,
    summary: null,
    latest_detail: null,
    operator_note: null,
    operator_actor: null,
    updated_at: "2026-04-18T15:25:00.000Z",
    ...over,
  };
}

function makeCanonicalClient(options: {
  existing: RuntimeIssue | null;
  selectError?: Error;
}): RuntimeQueryable & { calls: QueryCall[] } {
  const calls: QueryCall[] = [];
  const client: RuntimeQueryable = {
    async query<R extends Record<string, unknown> = Record<string, unknown>>(
      sql: string,
      params: readonly unknown[] = [],
    ) {
      calls.push({ sql, params });
      if (/SELECT\s+[\s\S]*FROM\s+runtime_issues\s+WHERE\s+fingerprint\s*=/i.test(sql)) {
        if (options.selectError) {
          throw options.selectError;
        }
        if (options.existing === null) {
          return { rows: [] as unknown as readonly R[] };
        }
        return { rows: [options.existing as unknown as R] };
      }
      return { rows: [] as unknown as readonly R[] };
    },
  };
  return Object.assign(client, { calls });
}

describe("emitSchedulerRecovered", () => {
  it("reuses the scheduler.schedule_generator.failed fingerprint with lifecycle_hint='recover'", async () => {
    const clientA = makeRecordingClient();
    const clientB = makeRecordingClient();
    const failed = await emitSchedulerFailed(
      { flags: FLAGS_ON, client: clientA },
      { error: new Error("pool down"), phase: "run" },
    );
    const recover = await emitSchedulerRecovered(
      { flags: FLAGS_ON, client: clientB },
      { observedAt: new Date("2026-04-18T15:32:00.000Z"), phase: "run" },
    );
    expect(failed.event?.fingerprint).toBeDefined();
    expect(recover.event?.fingerprint).toBe(failed.event?.fingerprint);

    const recoverInsert = findInsertEvent(clientB.calls);
    expect(recoverInsert).toBeDefined();
    expect(recoverInsert?.params[1]).toBe("scheduler.schedule_generator.failed");
    expect(recoverInsert?.params[2]).toBe("m2.scheduler");
    expect(recoverInsert?.params[4]).toBe("recover"); // lifecycle_hint

    // schedulerFailedFingerprintFor mirrors the detected event's fingerprint.
    expect(schedulerFailedFingerprintFor("run")).toBe(failed.event?.fingerprint);
  });

  it("is a no-op when m2_scheduler slice is off", async () => {
    const client = makeRecordingClient();
    const result = await emitSchedulerRecovered(
      { flags: FLAGS_OFF, client },
      { observedAt: new Date() },
    );
    expect(result.status).toBe("disabled");
    expect(client.calls).toHaveLength(0);
  });
});

describe("maybeEmitSchedulerRecovered (canonical authority)", () => {
  const recoveryInput = {
    observedAt: new Date("2026-04-18T15:32:00.000Z"),
    phase: "run",
  };

  it("is a no-op ('no_active_issue') when no runtime_issues row exists for the fingerprint", async () => {
    const client = makeCanonicalClient({ existing: null });
    const result = await maybeEmitSchedulerRecovered(
      { flags: FLAGS_ON, client },
      recoveryInput,
    );
    expect(result.status).toBe("no_active_issue");
    expect(findInsertEvent(client.calls)).toBeUndefined();
  });

  it("is a no-op when the existing runtime_issues row is already 'recovered'", async () => {
    const fingerprint = schedulerFailedFingerprintFor("run");
    const existing = makeIssueRow({
      fingerprint,
      state: "recovered",
      recovered_at: "2026-04-18T11:00:00.000Z",
    });
    const client = makeCanonicalClient({ existing });
    const result = await maybeEmitSchedulerRecovered(
      { flags: FLAGS_ON, client },
      recoveryInput,
    );
    expect(result.status).toBe("no_active_issue");
    expect(findInsertEvent(client.calls)).toBeUndefined();
  });

  it("is a no-op when the existing runtime_issues row is 'closed' or 'suppressed'", async () => {
    const fingerprint = schedulerFailedFingerprintFor("run");
    for (const terminal of ["closed", "suppressed"] as const) {
      const existing = makeIssueRow({
        fingerprint,
        state: terminal as RuntimeIssueState,
      });
      const client = makeCanonicalClient({ existing });
      const result = await maybeEmitSchedulerRecovered(
        { flags: FLAGS_ON, client },
        recoveryInput,
      );
      expect(result.status).toBe("no_active_issue");
      expect(findInsertEvent(client.calls)).toBeUndefined();
    }
  });

  it("emits recovery when an active 'detected' runtime_issues row exists for the same fingerprint", async () => {
    const fingerprint = schedulerFailedFingerprintFor("run");
    const existing = makeIssueRow({ fingerprint, state: "detected" });
    const client = makeCanonicalClient({ existing });

    const result = await maybeEmitSchedulerRecovered(
      { flags: FLAGS_ON, client },
      recoveryInput,
    );
    expect(result.status).toBe("persisted");

    const insert = findInsertEvent(client.calls);
    expect(insert).toBeDefined();
    expect(insert?.params[1]).toBe("scheduler.schedule_generator.failed");
    expect(insert?.params[2]).toBe("m2.scheduler");
    expect(insert?.params[4]).toBe("recover");
  });

  it("emits recovery when the active row is in 'ongoing' state (same cycle)", async () => {
    const fingerprint = schedulerFailedFingerprintFor("run");
    const existing = makeIssueRow({ fingerprint, state: "ongoing" });
    const client = makeCanonicalClient({ existing });

    const result = await maybeEmitSchedulerRecovered(
      { flags: FLAGS_ON, client },
      recoveryInput,
    );
    expect(result.status).toBe("persisted");
    expect(findInsertEvent(client.calls)).toBeDefined();
  });

  it("returns 'disabled' when the governance gate is off (no DB lookup occurs)", async () => {
    const client = makeCanonicalClient({ existing: null });
    const result = await maybeEmitSchedulerRecovered(
      { flags: FLAGS_OFF, client },
      recoveryInput,
    );
    expect(result.status).toBe("disabled");
    expect(client.calls).toHaveLength(0);
  });

  it("returns 'disabled' when the m2_scheduler slice is off even with governance on", async () => {
    const client = makeCanonicalClient({ existing: null });
    const result = await maybeEmitSchedulerRecovered(
      { flags: FLAGS_GATE_ONLY, client },
      recoveryInput,
    );
    expect(result.status).toBe("disabled");
    expect(client.calls).toHaveLength(0);
  });

  it("swallows lookup failures and returns degraded_fallback (does not synthesize recovery)", async () => {
    const client = makeCanonicalClient({
      existing: null,
      selectError: new Error("pg-gone"),
    });
    let threw = false;
    let result: Awaited<ReturnType<typeof maybeEmitSchedulerRecovered>> | null =
      null;
    try {
      result = await maybeEmitSchedulerRecovered(
        { flags: FLAGS_ON, client, logger: () => {} },
        recoveryInput,
      );
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(result?.status).toBe("degraded_fallback");
    expect(findInsertEvent(client.calls)).toBeUndefined();
  });
});
