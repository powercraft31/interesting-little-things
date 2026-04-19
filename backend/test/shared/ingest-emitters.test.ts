/**
 * WS5 — M1 ingest runtime emitters.
 *
 * Contract under test:
 *  - ingest.telemetry.stale / ingest.fragment.backlog / ingest.parser.failed
 *    are emitted via the existing M9 shared emit surface, under slice
 *    "m1_ingest" and source "m1.ingest".
 *  - ingest.parser.failed folds parser_id into dedup_keys so distinct parsers
 *    project to distinct runtime_issues rows.
 *  - ingest.freshness self-check is upserted through upsertRuntimeSelfCheck
 *    with check_id "ingest.freshness" and source "m1.ingest", using the
 *    M9 pass/stale helpers exclusively.
 *  - Every helper is strictly best-effort: returns 'disabled' when the global
 *    gate or slice is off, and 'degraded_fallback' (never throws) when the
 *    underlying DB path fails.
 */

import { parseRuntimeFlags } from "../../src/shared/runtime/flags";
import type { RuntimeQueryable } from "../../src/shared/runtime/persistence";
import {
  emitIngestFragmentBacklog,
  emitIngestParserFailed,
  emitIngestTelemetryRecovered,
  emitIngestTelemetryStale,
  ingestTelemetryStaleFingerprintFor,
  maybeEmitIngestTelemetryRecovered,
  recordIngestFreshness,
} from "../../src/shared/runtime/ingest-emitters";
import type { RuntimeIssue, RuntimeIssueState } from "../../src/shared/types/runtime";

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
  RUNTIME_EMIT_M1_INGEST: "true",
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

describe("emitIngestTelemetryStale", () => {
  it("emits ingest.telemetry.stale with gateway tenant_scope and structured detail", async () => {
    const client = makeRecordingClient();
    const lastObservedAt = new Date("2026-04-18T10:00:00.000Z");
    const observedAt = new Date("2026-04-18T10:07:00.000Z");
    const result = await emitIngestTelemetryStale(
      { flags: FLAGS_ON, client },
      {
        tenantScope: "gateway:gw-001",
        gatewayId: "gw-001",
        lastObservedAt,
        observedAt,
        staleForMs: 420_000,
        thresholdMs: 300_000,
      },
    );
    expect(result.status).toBe("persisted");
    const insert = findInsertEvent(client.calls);
    expect(insert).toBeDefined();
    expect(insert?.params[1]).toBe("ingest.telemetry.stale");
    expect(insert?.params[2]).toBe("m1.ingest");
    expect(insert?.params[9]).toBe("gateway:gw-001"); // tenant_scope

    const detailJson = String(insert?.params[11]);
    expect(detailJson).toMatch(/"gateway_id":"gw-001"/);
    expect(detailJson).toMatch(/"stale_for_ms":420000/);
    expect(detailJson).toMatch(/"threshold_ms":300000/);
  });

  it("produces distinct fingerprints per tenant_scope (per-gateway dedup)", async () => {
    const client = makeRecordingClient();
    const now = new Date("2026-04-18T10:00:00.000Z");
    const a = await emitIngestTelemetryStale(
      { flags: FLAGS_ON, client },
      {
        tenantScope: "gateway:alpha",
        gatewayId: "alpha",
        lastObservedAt: now,
        observedAt: now,
        staleForMs: 310_000,
        thresholdMs: 300_000,
      },
    );
    const b = await emitIngestTelemetryStale(
      { flags: FLAGS_ON, client },
      {
        tenantScope: "gateway:bravo",
        gatewayId: "bravo",
        lastObservedAt: now,
        observedAt: now,
        staleForMs: 320_000,
        thresholdMs: 300_000,
      },
    );
    expect(a.event?.fingerprint).not.toBe(b.event?.fingerprint);
  });

  it("is a no-op when governance gate is off", async () => {
    const client = makeRecordingClient();
    const result = await emitIngestTelemetryStale(
      { flags: FLAGS_OFF, client },
      {
        tenantScope: "gateway:gw-001",
        gatewayId: "gw-001",
        lastObservedAt: new Date(),
        observedAt: new Date(),
        staleForMs: 999_999,
        thresholdMs: 300_000,
      },
    );
    expect(result.status).toBe("disabled");
    expect(client.calls).toHaveLength(0);
  });

  it("is a no-op when m1_ingest slice is off even with governance on", async () => {
    const client = makeRecordingClient();
    const result = await emitIngestTelemetryStale(
      { flags: FLAGS_GATE_ONLY, client },
      {
        tenantScope: "gateway:gw-001",
        gatewayId: "gw-001",
        lastObservedAt: new Date(),
        observedAt: new Date(),
        staleForMs: 999_999,
        thresholdMs: 300_000,
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
    let result: Awaited<ReturnType<typeof emitIngestTelemetryStale>> | null =
      null;
    try {
      result = await emitIngestTelemetryStale(
        { flags: FLAGS_ON, client: failing, logger: () => {} },
        {
          tenantScope: "gateway:gw-001",
          gatewayId: "gw-001",
          lastObservedAt: new Date(),
          observedAt: new Date(),
          staleForMs: 999_999,
          thresholdMs: 300_000,
        },
      );
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(result?.status).toBe("degraded_fallback");
  });
});

describe("emitIngestFragmentBacklog", () => {
  it("emits ingest.fragment.backlog with backlog + threshold detail", async () => {
    const client = makeRecordingClient();
    const result = await emitIngestFragmentBacklog(
      { flags: FLAGS_ON, client },
      {
        backlogCount: 120,
        thresholdCount: 100,
        assemblerKind: "live",
        sampleClientIds: ["cid-a", "cid-b"],
      },
    );
    expect(result.status).toBe("persisted");
    const insert = findInsertEvent(client.calls);
    expect(insert?.params[1]).toBe("ingest.fragment.backlog");
    expect(insert?.params[2]).toBe("m1.ingest");
    const detailJson = String(insert?.params[11]);
    expect(detailJson).toMatch(/"backlog_count":120/);
    expect(detailJson).toMatch(/"threshold_count":100/);
    expect(detailJson).toMatch(/"assembler_kind":"live"/);
    expect(detailJson).toMatch(/"sample_client_ids":\["cid-a","cid-b"\]/);
  });

  it("is a no-op when m1_ingest slice is off", async () => {
    const client = makeRecordingClient();
    const result = await emitIngestFragmentBacklog(
      { flags: FLAGS_OFF, client },
      { backlogCount: 500, thresholdCount: 100, assemblerKind: "backfill" },
    );
    expect(result.status).toBe("disabled");
    expect(client.calls).toHaveLength(0);
  });
});

describe("emitIngestParserFailed", () => {
  it("emits ingest.parser.failed with parser_id folded into dedup", async () => {
    const client = makeRecordingClient();
    const result = await emitIngestParserFailed(
      { flags: FLAGS_ON, client },
      {
        parserId: "DynamicAdapter.v2",
        error: new Error("missing required field: orgId"),
        orgId: "org-7",
        deviceId: "dev-9",
        gatewayId: "gw-001",
        reason: "schema_violation",
      },
    );
    expect(result.status).toBe("persisted");
    const insert = findInsertEvent(client.calls);
    expect(insert?.params[1]).toBe("ingest.parser.failed");
    expect(insert?.params[2]).toBe("m1.ingest");
    const detailJson = String(insert?.params[11]);
    expect(detailJson).toMatch(/"parser_id":"DynamicAdapter.v2"/);
    expect(detailJson).toMatch(/"error":"missing required field: orgId"/);
    expect(detailJson).toMatch(/"reason":"schema_violation"/);
  });

  it("produces distinct fingerprints per parser_id so per-parser bursts stay distinct", async () => {
    const clientA = makeRecordingClient();
    const clientB = makeRecordingClient();
    const a = await emitIngestParserFailed(
      { flags: FLAGS_ON, client: clientA },
      { parserId: "XuhengAdapter", error: new Error("x") },
    );
    const b = await emitIngestParserFailed(
      { flags: FLAGS_ON, client: clientB },
      { parserId: "DynamicAdapter.v2", error: new Error("x") },
    );
    expect(a.event?.fingerprint).not.toBe(b.event?.fingerprint);
  });

  it("never throws even if persistence blows up", async () => {
    const failing: RuntimeQueryable = {
      async query() {
        throw new Error("ded");
      },
    };
    let threw = false;
    try {
      await emitIngestParserFailed(
        { flags: FLAGS_ON, client: failing, logger: () => {} },
        { parserId: "x", error: new Error("y") },
      );
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });
});

describe("recordIngestFreshness", () => {
  it("upserts ingest.freshness self-check with last_status='pass' on activity", async () => {
    const client = makeRecordingClient();
    const observedAt = new Date("2026-04-18T10:05:00.000Z");
    const result = await recordIngestFreshness(
      { flags: FLAGS_ON, client, now: observedAt },
      {
        status: "pass",
        observedAt,
        detail: { gateway_id: "gw-001" },
      },
    );
    expect(result.status).toBe("persisted");

    const upsert = findUpsertSelfCheck(client.calls);
    expect(upsert).toBeDefined();
    // upsertRuntimeSelfCheck binds: check_id, source, run_host, cadence_seconds,
    //   last_status, last_run_at, last_pass_at, last_duration_ms,
    //   consecutive_failures, latest_detail, updated_at
    expect(upsert?.params[0]).toBe("ingest.freshness");
    expect(upsert?.params[1]).toBe("m1.ingest");
    expect(upsert?.params[4]).toBe("pass");
    expect(upsert?.params[5]).toBe(observedAt.toISOString()); // last_run_at
    expect(upsert?.params[6]).toBe(observedAt.toISOString()); // last_pass_at
    expect(String(upsert?.params[9])).toMatch(/"gateway_id":"gw-001"/);
  });

  it("upserts ingest.freshness with last_status='stale' when a cadence gap is detected", async () => {
    const client = makeRecordingClient();
    const now = new Date("2026-04-18T10:30:00.000Z");
    const lastObservedAt = new Date("2026-04-18T10:00:00.000Z");
    const result = await recordIngestFreshness(
      { flags: FLAGS_ON, client, now },
      {
        status: "stale",
        observedAt: lastObservedAt,
        detail: { stale_for_ms: 1800000, gateway_id: "gw-001" },
      },
    );
    expect(result.status).toBe("persisted");
    const upsert = findUpsertSelfCheck(client.calls);
    expect(upsert?.params[0]).toBe("ingest.freshness");
    expect(upsert?.params[4]).toBe("stale");
    // stale does not synthesize last_run_at — it stays null on the freshly
    // built row so the cadence watchdog owns the truth.
    expect(upsert?.params[5]).toBeNull();
    expect(String(upsert?.params[9])).toMatch(/"stale_for_ms":1800000/);
  });

  it("is a no-op with status='disabled' when the governance gate is off", async () => {
    const client = makeRecordingClient();
    const result = await recordIngestFreshness(
      { flags: FLAGS_OFF, client },
      { status: "pass", observedAt: new Date() },
    );
    expect(result.status).toBe("disabled");
    expect(client.calls).toHaveLength(0);
  });

  it("is a no-op when m1_ingest slice is off even with governance on", async () => {
    const client = makeRecordingClient();
    const result = await recordIngestFreshness(
      { flags: FLAGS_GATE_ONLY, client },
      { status: "pass", observedAt: new Date() },
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
    let result: Awaited<ReturnType<typeof recordIngestFreshness>> | null = null;
    try {
      result = await recordIngestFreshness(
        { flags: FLAGS_ON, client: failing, logger: () => {} },
        { status: "pass", observedAt: new Date() },
      );
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(result?.status).toBe("degraded_fallback");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// I3 fix — recovery lifecycle + canonical authority
// ─────────────────────────────────────────────────────────────────────────────

describe("emitIngestTelemetryRecovered", () => {
  it("emits ingest.telemetry.stale with lifecycle_hint='recover' and severity='info'", async () => {
    const client = makeRecordingClient();
    const lastObservedAt = new Date("2026-04-18T15:20:00.000Z");
    const observedAt = new Date("2026-04-18T15:32:00.000Z");
    const result = await emitIngestTelemetryRecovered(
      { flags: FLAGS_ON, client },
      {
        tenantScope: "gateway:DEMO-GW-10KW",
        gatewayId: "DEMO-GW-10KW",
        lastObservedAt,
        observedAt,
        gapMs: 720_000,
      },
    );
    expect(result.status).toBe("persisted");

    const insert = findInsertEvent(client.calls);
    expect(insert).toBeDefined();
    // insertRuntimeEvent column order:
    //  event_id, event_code, source, severity, lifecycle_hint,
    //  occurred_at, observed_at, fingerprint, correlation_id,
    //  tenant_scope, summary, detail
    expect(insert?.params[1]).toBe("ingest.telemetry.stale");
    expect(insert?.params[2]).toBe("m1.ingest");
    expect(insert?.params[3]).toBe("info");
    expect(insert?.params[4]).toBe("recover");
    expect(insert?.params[9]).toBe("gateway:DEMO-GW-10KW");

    const detailJson = String(insert?.params[11]);
    expect(detailJson).toMatch(/"recovered":true/);
    expect(detailJson).toMatch(/"gap_ms":720000/);
  });

  it("produces the SAME fingerprint as a matching stale event for the same tenant_scope (canonical recovery identity)", async () => {
    const clientStale = makeRecordingClient();
    const clientRecover = makeRecordingClient();
    const now = new Date("2026-04-18T15:31:00.000Z");

    const stale = await emitIngestTelemetryStale(
      { flags: FLAGS_ON, client: clientStale },
      {
        tenantScope: "gateway:DEMO-GW-10KW",
        gatewayId: "DEMO-GW-10KW",
        lastObservedAt: new Date("2026-04-18T15:20:00.000Z"),
        observedAt: now,
        staleForMs: 660_000,
        thresholdMs: 300_000,
      },
    );
    const recover = await emitIngestTelemetryRecovered(
      { flags: FLAGS_ON, client: clientRecover },
      {
        tenantScope: "gateway:DEMO-GW-10KW",
        gatewayId: "DEMO-GW-10KW",
        lastObservedAt: new Date("2026-04-18T15:20:00.000Z"),
        observedAt: new Date("2026-04-18T15:32:00.000Z"),
        gapMs: 720_000,
      },
    );
    expect(stale.event?.fingerprint).toBeDefined();
    expect(recover.event?.fingerprint).toBeDefined();
    expect(recover.event?.fingerprint).toBe(stale.event?.fingerprint);

    // Mirrors the public helper the handler uses for canonical lookup.
    expect(ingestTelemetryStaleFingerprintFor("gateway:DEMO-GW-10KW")).toBe(
      stale.event?.fingerprint,
    );
  });
});

function makeIssueRow(over: Partial<RuntimeIssue>): RuntimeIssue {
  return {
    fingerprint: over.fingerprint ?? "fp",
    event_code: over.event_code ?? "ingest.telemetry.stale",
    source: over.source ?? "m1.ingest",
    tenant_scope: over.tenant_scope ?? "gateway:DEMO-GW-10KW",
    cycle_count: 1,
    current_cycle_started_at: "2026-04-18T15:31:00.000Z",
    first_detected_at: "2026-04-18T15:31:00.000Z",
    last_observed_at: "2026-04-18T15:31:00.000Z",
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
    updated_at: "2026-04-18T15:31:00.000Z",
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

describe("maybeEmitIngestTelemetryRecovered (canonical authority)", () => {
  const recoveryInput = {
    tenantScope: "gateway:DEMO-GW-10KW",
    gatewayId: "DEMO-GW-10KW",
    lastObservedAt: new Date("2026-04-18T15:20:00.000Z"),
    observedAt: new Date("2026-04-18T15:32:00.000Z"),
    gapMs: 720_000,
  };

  it("is a no-op ('no_active_issue') when no runtime_issues row exists for the fingerprint", async () => {
    const client = makeCanonicalClient({ existing: null });
    const result = await maybeEmitIngestTelemetryRecovered(
      { flags: FLAGS_ON, client },
      recoveryInput,
    );
    expect(result.status).toBe("no_active_issue");
    expect(findInsertEvent(client.calls)).toBeUndefined();
  });

  it("is a no-op when the existing runtime_issues row is already 'recovered' (does not re-emit)", async () => {
    const fingerprint = ingestTelemetryStaleFingerprintFor(recoveryInput.tenantScope);
    const existing = makeIssueRow({
      fingerprint,
      state: "recovered",
      recovered_at: "2026-04-18T11:00:00.000Z",
    });
    const client = makeCanonicalClient({ existing });
    const result = await maybeEmitIngestTelemetryRecovered(
      { flags: FLAGS_ON, client },
      recoveryInput,
    );
    expect(result.status).toBe("no_active_issue");
    expect(findInsertEvent(client.calls)).toBeUndefined();
  });

  it("is a no-op when the existing runtime_issues row is 'closed' or 'suppressed'", async () => {
    const fingerprint = ingestTelemetryStaleFingerprintFor(recoveryInput.tenantScope);
    for (const terminal of ["closed", "suppressed"] as const) {
      const existing = makeIssueRow({ fingerprint, state: terminal as RuntimeIssueState });
      const client = makeCanonicalClient({ existing });
      const result = await maybeEmitIngestTelemetryRecovered(
        { flags: FLAGS_ON, client },
        recoveryInput,
      );
      expect(result.status).toBe("no_active_issue");
      expect(findInsertEvent(client.calls)).toBeUndefined();
    }
  });

  it("emits recovery when an active 'detected' runtime_issues row exists for the same fingerprint", async () => {
    const fingerprint = ingestTelemetryStaleFingerprintFor(recoveryInput.tenantScope);
    const existing = makeIssueRow({ fingerprint, state: "detected" });
    const client = makeCanonicalClient({ existing });

    const result = await maybeEmitIngestTelemetryRecovered(
      { flags: FLAGS_ON, client },
      recoveryInput,
    );
    expect(result.status).toBe("persisted");

    const insert = findInsertEvent(client.calls);
    expect(insert).toBeDefined();
    expect(insert?.params[1]).toBe("ingest.telemetry.stale");
    expect(insert?.params[4]).toBe("recover");
    expect(insert?.params[9]).toBe("gateway:DEMO-GW-10KW");
  });

  it("emits recovery when the active row is in 'ongoing' state (same cycle)", async () => {
    const fingerprint = ingestTelemetryStaleFingerprintFor(recoveryInput.tenantScope);
    const existing = makeIssueRow({ fingerprint, state: "ongoing" });
    const client = makeCanonicalClient({ existing });

    const result = await maybeEmitIngestTelemetryRecovered(
      { flags: FLAGS_ON, client },
      recoveryInput,
    );
    expect(result.status).toBe("persisted");
    expect(findInsertEvent(client.calls)).toBeDefined();
  });

  it("returns 'disabled' when the governance gate is off (no DB lookup occurs)", async () => {
    const client = makeCanonicalClient({ existing: null });
    const result = await maybeEmitIngestTelemetryRecovered(
      { flags: FLAGS_OFF, client },
      recoveryInput,
    );
    expect(result.status).toBe("disabled");
    expect(client.calls).toHaveLength(0);
  });

  it("returns 'disabled' when the m1_ingest slice is off even with governance on", async () => {
    const client = makeCanonicalClient({ existing: null });
    const result = await maybeEmitIngestTelemetryRecovered(
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
    let result: Awaited<ReturnType<typeof maybeEmitIngestTelemetryRecovered>> | null =
      null;
    try {
      result = await maybeEmitIngestTelemetryRecovered(
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
