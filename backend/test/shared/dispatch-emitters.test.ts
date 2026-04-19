/**
 * WS7 — M3 dispatch runtime emitters.
 *
 * Contract under test:
 *  - dispatch.loop.heartbeat / dispatch.loop.stalled /
 *    dispatch.timeout_checker.heartbeat / dispatch.ack.stalled are emitted via
 *    the existing M9 shared emit surface, under slice "m3_dispatch" and
 *    source "m3.dispatch".
 *  - dispatch.loop.alive self-check is upserted through upsertRuntimeSelfCheck
 *    with check_id "dispatch.loop.alive" and source "m3.dispatch", using the
 *    M9 pass helper exclusively. Detail carries a contributor marker so M3's
 *    evidence stays distinguishable from other contributors.
 *  - Every helper is strictly best-effort: returns 'disabled' when the global
 *    gate or slice is off, and 'degraded_fallback' (never throws) when the
 *    underlying DB path fails.
 *  - dispatch.loop.stalled fingerprints dedup by phase so distinct
 *    non-progression phases stay separable.
 *  - dispatch.ack.stalled fingerprints dedup by tenant_scope so distinct
 *    tenant stall populations stay separable.
 */

import { parseRuntimeFlags } from "../../src/shared/runtime/flags";
import type { RuntimeQueryable } from "../../src/shared/runtime/persistence";
import {
  dispatchAckStalledFingerprintFor,
  emitDispatchAckRecovered,
  emitDispatchAckStalled,
  emitDispatchLoopHeartbeat,
  emitDispatchLoopStalled,
  emitDispatchTimeoutCheckerHeartbeat,
  maybeEmitDispatchAckRecovered,
  recordDispatchLoopAlive,
} from "../../src/shared/runtime/dispatch-emitters";
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
  RUNTIME_EMIT_M3_DISPATCH: "true",
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

describe("emitDispatchLoopHeartbeat", () => {
  it("emits dispatch.loop.heartbeat with run-scoped detail", async () => {
    const client = makeRecordingClient();
    const runStartedAt = new Date("2026-04-18T10:00:00.000Z");
    const result = await emitDispatchLoopHeartbeat(
      { flags: FLAGS_ON, client },
      {
        commandsDispatched: 7,
        runStartedAt,
        durationMs: 312,
      },
    );
    expect(result.status).toBe("persisted");
    const insert = findInsertEvent(client.calls);
    expect(insert).toBeDefined();
    expect(insert?.params[1]).toBe("dispatch.loop.heartbeat");
    expect(insert?.params[2]).toBe("m3.dispatch");

    const detailJson = String(insert?.params[11]);
    expect(detailJson).toMatch(/"commands_dispatched":7/);
    expect(detailJson).toMatch(/"duration_ms":312/);
    expect(detailJson).toMatch(/"run_started_at":"2026-04-18T10:00:00\.000Z"/);
  });

  it("is a no-op when governance gate is off", async () => {
    const client = makeRecordingClient();
    const result = await emitDispatchLoopHeartbeat(
      { flags: FLAGS_OFF, client },
      {
        commandsDispatched: 0,
        runStartedAt: new Date(),
        durationMs: 1,
      },
    );
    expect(result.status).toBe("disabled");
    expect(client.calls).toHaveLength(0);
  });

  it("is a no-op when m3_dispatch slice is off even with governance on", async () => {
    const client = makeRecordingClient();
    const result = await emitDispatchLoopHeartbeat(
      { flags: FLAGS_GATE_ONLY, client },
      {
        commandsDispatched: 0,
        runStartedAt: new Date(),
        durationMs: 1,
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
    let result: Awaited<ReturnType<typeof emitDispatchLoopHeartbeat>> | null = null;
    try {
      result = await emitDispatchLoopHeartbeat(
        { flags: FLAGS_ON, client: failing, logger: () => {} },
        {
          commandsDispatched: 0,
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

describe("emitDispatchLoopStalled", () => {
  it("emits dispatch.loop.stalled with phase folded into dedup", async () => {
    const client = makeRecordingClient();
    const result = await emitDispatchLoopStalled(
      { flags: FLAGS_ON, client },
      {
        error: new Error("SELECT FOR UPDATE timed out"),
        runStartedAt: new Date("2026-04-18T10:00:00.000Z"),
        phase: "due_scan",
      },
    );
    expect(result.status).toBe("persisted");
    const insert = findInsertEvent(client.calls);
    expect(insert?.params[1]).toBe("dispatch.loop.stalled");
    expect(insert?.params[2]).toBe("m3.dispatch");
    const detailJson = String(insert?.params[11]);
    expect(detailJson).toMatch(/"error":"SELECT FOR UPDATE timed out"/);
    expect(detailJson).toMatch(/"phase":"due_scan"/);
  });

  it("produces distinct fingerprints per phase so distinct non-progression modes stay distinct", async () => {
    const clientA = makeRecordingClient();
    const clientB = makeRecordingClient();
    const a = await emitDispatchLoopStalled(
      { flags: FLAGS_ON, client: clientA },
      {
        error: new Error("x"),
        runStartedAt: new Date(),
        phase: "due_scan",
      },
    );
    const b = await emitDispatchLoopStalled(
      { flags: FLAGS_ON, client: clientB },
      {
        error: new Error("x"),
        runStartedAt: new Date(),
        phase: "insert_commands",
      },
    );
    expect(a.event?.fingerprint).not.toBe(b.event?.fingerprint);
  });

  it("is a no-op when m3_dispatch slice is off", async () => {
    const client = makeRecordingClient();
    const result = await emitDispatchLoopStalled(
      { flags: FLAGS_OFF, client },
      { error: new Error("x"), runStartedAt: new Date() },
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
      await emitDispatchLoopStalled(
        { flags: FLAGS_ON, client: failing, logger: () => {} },
        { error: new Error("y"), runStartedAt: new Date() },
      );
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });
});

describe("emitDispatchTimeoutCheckerHeartbeat", () => {
  it("emits dispatch.timeout_checker.heartbeat with stale-count detail", async () => {
    const client = makeRecordingClient();
    const runStartedAt = new Date("2026-04-18T10:05:00.000Z");
    const result = await emitDispatchTimeoutCheckerHeartbeat(
      { flags: FLAGS_ON, client },
      {
        staleCommandsFailed: 3,
        runStartedAt,
        durationMs: 92,
      },
    );
    expect(result.status).toBe("persisted");
    const insert = findInsertEvent(client.calls);
    expect(insert?.params[1]).toBe("dispatch.timeout_checker.heartbeat");
    expect(insert?.params[2]).toBe("m3.dispatch");
    const detailJson = String(insert?.params[11]);
    expect(detailJson).toMatch(/"stale_commands_failed":3/);
    expect(detailJson).toMatch(/"duration_ms":92/);
    expect(detailJson).toMatch(/"run_started_at":"2026-04-18T10:05:00\.000Z"/);
  });

  it("is a no-op when governance gate is off", async () => {
    const client = makeRecordingClient();
    const result = await emitDispatchTimeoutCheckerHeartbeat(
      { flags: FLAGS_OFF, client },
      {
        staleCommandsFailed: 0,
        runStartedAt: new Date(),
        durationMs: 1,
      },
    );
    expect(result.status).toBe("disabled");
    expect(client.calls).toHaveLength(0);
  });
});

describe("emitDispatchAckStalled", () => {
  it("emits dispatch.ack.stalled with tenant_scope and cutoff detail", async () => {
    const client = makeRecordingClient();
    const observedAt = new Date("2026-04-18T10:06:00.000Z");
    const result = await emitDispatchAckStalled(
      { flags: FLAGS_ON, client },
      {
        staleCount: 5,
        cutoffSeconds: 900,
        observedAt,
        tenantScope: "org:ORG_ENERGIA_001",
        sampleDispatchIds: [101, 102, 103],
      },
    );
    expect(result.status).toBe("persisted");
    const insert = findInsertEvent(client.calls);
    expect(insert?.params[1]).toBe("dispatch.ack.stalled");
    expect(insert?.params[2]).toBe("m3.dispatch");
    // tenant_scope is the 10th bound param (params[9]).
    expect(insert?.params[9]).toBe("org:ORG_ENERGIA_001");
    const detailJson = String(insert?.params[11]);
    expect(detailJson).toMatch(/"stale_count":5/);
    expect(detailJson).toMatch(/"cutoff_seconds":900/);
    expect(detailJson).toMatch(/"sample_dispatch_ids":\[101,102,103\]/);
  });

  it("produces distinct fingerprints per tenant_scope", async () => {
    const clientA = makeRecordingClient();
    const clientB = makeRecordingClient();
    const a = await emitDispatchAckStalled(
      { flags: FLAGS_ON, client: clientA },
      {
        staleCount: 1,
        cutoffSeconds: 900,
        observedAt: new Date(),
        tenantScope: "org:A",
      },
    );
    const b = await emitDispatchAckStalled(
      { flags: FLAGS_ON, client: clientB },
      {
        staleCount: 1,
        cutoffSeconds: 900,
        observedAt: new Date(),
        tenantScope: "org:B",
      },
    );
    expect(a.event?.fingerprint).not.toBe(b.event?.fingerprint);
  });

  it("is a no-op when m3_dispatch slice is off", async () => {
    const client = makeRecordingClient();
    const result = await emitDispatchAckStalled(
      { flags: FLAGS_OFF, client },
      {
        staleCount: 1,
        cutoffSeconds: 900,
        observedAt: new Date(),
      },
    );
    expect(result.status).toBe("disabled");
    expect(client.calls).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// I4a fix — canonical recovery lifecycle for dispatch.ack.stalled
// ─────────────────────────────────────────────────────────────────────────────

describe("emitDispatchAckRecovered", () => {
  it("emits dispatch.ack.stalled with lifecycle_hint='recover' and severity='info'", async () => {
    const client = makeRecordingClient();
    const observedAt = new Date("2026-04-18T15:32:00.000Z");
    const result = await emitDispatchAckRecovered(
      { flags: FLAGS_ON, client },
      {
        cutoffSeconds: 900,
        observedAt,
        tenantScope: "org:ORG_ENERGIA_001",
      },
    );
    expect(result.status).toBe("persisted");

    const insert = findInsertEvent(client.calls);
    expect(insert).toBeDefined();
    // insertRuntimeEvent column order:
    //  event_id, event_code, source, severity, lifecycle_hint,
    //  occurred_at, observed_at, fingerprint, correlation_id,
    //  tenant_scope, summary, detail
    expect(insert?.params[1]).toBe("dispatch.ack.stalled");
    expect(insert?.params[2]).toBe("m3.dispatch");
    expect(insert?.params[3]).toBe("info");
    expect(insert?.params[4]).toBe("recover");
    expect(insert?.params[9]).toBe("org:ORG_ENERGIA_001");

    const detailJson = String(insert?.params[11]);
    expect(detailJson).toMatch(/"recovered":true/);
    expect(detailJson).toMatch(/"cutoff_seconds":900/);
  });

  it("produces the SAME fingerprint as a matching stalled event for the same tenant_scope (canonical recovery identity)", async () => {
    const clientStale = makeRecordingClient();
    const clientRecover = makeRecordingClient();
    const now = new Date("2026-04-18T15:31:00.000Z");

    const stalled = await emitDispatchAckStalled(
      { flags: FLAGS_ON, client: clientStale },
      {
        staleCount: 1,
        cutoffSeconds: 900,
        observedAt: now,
        tenantScope: null,
      },
    );
    const recover = await emitDispatchAckRecovered(
      { flags: FLAGS_ON, client: clientRecover },
      {
        cutoffSeconds: 900,
        observedAt: new Date("2026-04-18T15:32:00.000Z"),
        tenantScope: null,
      },
    );
    expect(stalled.event?.fingerprint).toBeDefined();
    expect(recover.event?.fingerprint).toBeDefined();
    expect(recover.event?.fingerprint).toBe(stalled.event?.fingerprint);

    // Mirrors the helper the handler uses for canonical lookup.
    expect(dispatchAckStalledFingerprintFor(null)).toBe(
      stalled.event?.fingerprint,
    );
  });

  it("is a no-op when m3_dispatch slice is off", async () => {
    const client = makeRecordingClient();
    const result = await emitDispatchAckRecovered(
      { flags: FLAGS_OFF, client },
      { cutoffSeconds: 900, observedAt: new Date() },
    );
    expect(result.status).toBe("disabled");
    expect(client.calls).toHaveLength(0);
  });
});

function makeIssueRow(over: Partial<RuntimeIssue>): RuntimeIssue {
  return {
    fingerprint: over.fingerprint ?? "fp",
    event_code: over.event_code ?? "dispatch.ack.stalled",
    source: over.source ?? "m3.dispatch",
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
        return {
          rows: [options.existing as unknown as R],
        };
      }
      return { rows: [] as unknown as readonly R[] };
    },
  };
  return Object.assign(client, { calls });
}

describe("maybeEmitDispatchAckRecovered (canonical authority)", () => {
  const recoveryInput = {
    cutoffSeconds: 900,
    observedAt: new Date("2026-04-18T15:32:00.000Z"),
    tenantScope: null as string | null,
  };

  it("is a no-op ('no_active_issue') when no runtime_issues row exists for the fingerprint", async () => {
    const client = makeCanonicalClient({ existing: null });
    const result = await maybeEmitDispatchAckRecovered(
      { flags: FLAGS_ON, client },
      recoveryInput,
    );
    expect(result.status).toBe("no_active_issue");
    expect(findInsertEvent(client.calls)).toBeUndefined();
  });

  it("is a no-op when the existing runtime_issues row is already 'recovered' (does not re-emit)", async () => {
    const fingerprint = dispatchAckStalledFingerprintFor(null);
    const existing = makeIssueRow({
      fingerprint,
      state: "recovered",
      recovered_at: "2026-04-18T11:00:00.000Z",
    });
    const client = makeCanonicalClient({ existing });
    const result = await maybeEmitDispatchAckRecovered(
      { flags: FLAGS_ON, client },
      recoveryInput,
    );
    expect(result.status).toBe("no_active_issue");
    expect(findInsertEvent(client.calls)).toBeUndefined();
  });

  it("is a no-op when the existing runtime_issues row is 'closed' or 'suppressed'", async () => {
    const fingerprint = dispatchAckStalledFingerprintFor(null);
    for (const terminal of ["closed", "suppressed"] as const) {
      const existing = makeIssueRow({
        fingerprint,
        state: terminal as RuntimeIssueState,
      });
      const client = makeCanonicalClient({ existing });
      const result = await maybeEmitDispatchAckRecovered(
        { flags: FLAGS_ON, client },
        recoveryInput,
      );
      expect(result.status).toBe("no_active_issue");
      expect(findInsertEvent(client.calls)).toBeUndefined();
    }
  });

  it("emits recovery when an active 'detected' runtime_issues row exists for the same fingerprint", async () => {
    const fingerprint = dispatchAckStalledFingerprintFor(null);
    const existing = makeIssueRow({ fingerprint, state: "detected" });
    const client = makeCanonicalClient({ existing });

    const result = await maybeEmitDispatchAckRecovered(
      { flags: FLAGS_ON, client },
      recoveryInput,
    );
    expect(result.status).toBe("persisted");

    const insert = findInsertEvent(client.calls);
    expect(insert).toBeDefined();
    expect(insert?.params[1]).toBe("dispatch.ack.stalled");
    expect(insert?.params[4]).toBe("recover");
  });

  it("emits recovery when the active row is in 'ongoing' state (same cycle)", async () => {
    const fingerprint = dispatchAckStalledFingerprintFor(null);
    const existing = makeIssueRow({ fingerprint, state: "ongoing" });
    const client = makeCanonicalClient({ existing });

    const result = await maybeEmitDispatchAckRecovered(
      { flags: FLAGS_ON, client },
      recoveryInput,
    );
    expect(result.status).toBe("persisted");
    expect(findInsertEvent(client.calls)).toBeDefined();
  });

  it("returns 'disabled' when the governance gate is off (no DB lookup occurs)", async () => {
    const client = makeCanonicalClient({ existing: null });
    const result = await maybeEmitDispatchAckRecovered(
      { flags: FLAGS_OFF, client },
      recoveryInput,
    );
    expect(result.status).toBe("disabled");
    expect(client.calls).toHaveLength(0);
  });

  it("returns 'disabled' when the m3_dispatch slice is off even with governance on", async () => {
    const client = makeCanonicalClient({ existing: null });
    const result = await maybeEmitDispatchAckRecovered(
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
    let result: Awaited<ReturnType<typeof maybeEmitDispatchAckRecovered>> | null =
      null;
    try {
      result = await maybeEmitDispatchAckRecovered(
        { flags: FLAGS_ON, client, logger: () => {} },
        recoveryInput,
      );
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(result?.status).toBe("degraded_fallback");
    // No recover event was inserted — authority lookup failed, so we do NOT
    // fall through to emit blindly (that would synthesize a recovered row).
    expect(findInsertEvent(client.calls)).toBeUndefined();
  });
});

describe("recordDispatchLoopAlive", () => {
  it("upserts dispatch.loop.alive with last_status='pass' and m3 contributor marker", async () => {
    const client = makeRecordingClient();
    const observedAt = new Date("2026-04-18T10:05:00.000Z");
    const result = await recordDispatchLoopAlive(
      { flags: FLAGS_ON, client, now: observedAt },
      {
        observedAt,
        durationMs: 312,
        detail: { commands_dispatched: 7 },
      },
    );
    expect(result.status).toBe("persisted");

    const upsert = findUpsertSelfCheck(client.calls);
    expect(upsert).toBeDefined();
    // upsertRuntimeSelfCheck binds: check_id, source, run_host, cadence_seconds,
    //   last_status, last_run_at, last_pass_at, last_duration_ms,
    //   consecutive_failures, latest_detail, updated_at
    expect(upsert?.params[0]).toBe("dispatch.loop.alive");
    expect(upsert?.params[1]).toBe("m3.dispatch");
    expect(upsert?.params[4]).toBe("pass");
    expect(upsert?.params[5]).toBe(observedAt.toISOString()); // last_run_at
    expect(upsert?.params[6]).toBe(observedAt.toISOString()); // last_pass_at
    expect(upsert?.params[7]).toBe(312);
    const detailJson = String(upsert?.params[9]);
    expect(detailJson).toMatch(/"contributor":"m3\.dispatch"/);
    expect(detailJson).toMatch(/"commands_dispatched":7/);
  });

  it("is a no-op with status='disabled' when the governance gate is off", async () => {
    const client = makeRecordingClient();
    const result = await recordDispatchLoopAlive(
      { flags: FLAGS_OFF, client },
      { observedAt: new Date(), durationMs: 1 },
    );
    expect(result.status).toBe("disabled");
    expect(client.calls).toHaveLength(0);
  });

  it("is a no-op when m3_dispatch slice is off even with governance on", async () => {
    const client = makeRecordingClient();
    const result = await recordDispatchLoopAlive(
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
    let result: Awaited<ReturnType<typeof recordDispatchLoopAlive>> | null = null;
    try {
      result = await recordDispatchLoopAlive(
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
