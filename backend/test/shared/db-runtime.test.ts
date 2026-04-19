/**
 * WS4 — DB substrate runtime probes + pool idle-error runtime facts.
 *
 * Contract under test:
 *  - probeAppPool / probeServicePool / probeCriticalQuery return structured
 *    results without throwing to the caller.
 *  - runDbSubstrateProbes() writes self-check rows for all three phase-1 ids
 *    and emits a runtime_event on failure. When a probe passes and the
 *    matching failure issue is still in an active cycle, a `recover` lifecycle
 *    event under the same event_code is emitted so the M9 projection
 *    transitions the issue out of detected/ongoing.
 *  - When runtime governance flag is off, the helper is a full no-op.
 *  - attachPoolIdleErrorEmitter() turns pg.Pool "error" events into structured
 *    runtime facts (db.pool.idle_error) instead of free-form console output,
 *    and never rethrows.
 */

import { computeFingerprint } from "../../src/shared/runtime/contract";
import { parseRuntimeFlags } from "../../src/shared/runtime/flags";
import type { RuntimeQueryable } from "../../src/shared/runtime/persistence";
import {
  attachPoolIdleErrorEmitter,
  probeAppPool,
  probeCriticalQuery,
  probeServicePool,
  runDbSubstrateProbes,
} from "../../src/shared/runtime/substrate";

type QueryCall = { sql: string; params: readonly unknown[] };

type SeededIssueRow = Record<string, unknown>;

interface RecordingClientOptions {
  readonly seededIssues?: ReadonlyMap<string, SeededIssueRow>;
}

function makeRecordingClient(
  options: RecordingClientOptions = {},
): RuntimeQueryable & { calls: QueryCall[] } {
  const calls: QueryCall[] = [];
  const client: RuntimeQueryable = {
    async query<R extends Record<string, unknown> = Record<string, unknown>>(
      sql: string,
      params: readonly unknown[] = [],
    ) {
      calls.push({ sql, params });
      if (
        options.seededIssues &&
        /FROM runtime_issues\s+WHERE fingerprint = \$1/i.test(sql)
      ) {
        const fp = String(params[0] ?? "");
        const row = options.seededIssues.get(fp);
        if (row) {
          return { rows: [row] as unknown as readonly R[] };
        }
      }
      return { rows: [] as unknown as readonly R[] };
    },
  };
  return Object.assign(client, { calls });
}

function seededIssueRow(overrides: Partial<SeededIssueRow> = {}): SeededIssueRow {
  return {
    fingerprint: overrides.fingerprint ?? "fp",
    event_code: overrides.event_code ?? "db.app_pool.unreachable",
    source: overrides.source ?? "db",
    tenant_scope: overrides.tenant_scope ?? null,
    cycle_count: overrides.cycle_count ?? 1,
    current_cycle_started_at:
      overrides.current_cycle_started_at ?? "2026-04-18T10:00:00.000Z",
    first_detected_at:
      overrides.first_detected_at ?? "2026-04-18T10:00:00.000Z",
    last_observed_at:
      overrides.last_observed_at ?? "2026-04-18T10:00:00.000Z",
    recovered_at: overrides.recovered_at ?? null,
    closed_at: overrides.closed_at ?? null,
    suppressed_until: overrides.suppressed_until ?? null,
    state: overrides.state ?? "detected",
    current_severity: overrides.current_severity ?? "critical",
    observation_count: overrides.observation_count ?? 1,
    summary: overrides.summary ?? null,
    latest_detail: overrides.latest_detail ?? null,
    operator_note: overrides.operator_note ?? null,
    operator_actor: overrides.operator_actor ?? null,
    updated_at: overrides.updated_at ?? "2026-04-18T10:00:00.000Z",
  };
}

/** Fake pg.Pool-like object with controllable connect() behavior. */
interface FakePool {
  connect(): Promise<{
    query: (sql: string) => Promise<{ rows: Array<{ ok: number }> }>;
    release: () => void;
  }>;
  on(event: string, handler: (err: Error) => void): FakePool;
  emit(event: string, err: Error): void;
}

function makeFakePool(opts: {
  connectFails?: Error;
  queryFails?: Error;
}): FakePool {
  const handlers: Record<string, Array<(err: Error) => void>> = {};
  const pool: FakePool = {
    async connect() {
      if (opts.connectFails) {
        throw opts.connectFails;
      }
      return {
        async query(_sql: string) {
          if (opts.queryFails) {
            throw opts.queryFails;
          }
          return { rows: [{ ok: 1 }] };
        },
        release() {
          // no-op
        },
      };
    },
    on(event, handler) {
      (handlers[event] ??= []).push(handler);
      return pool;
    },
    emit(event, err) {
      for (const h of handlers[event] ?? []) {
        h(err);
      }
    },
  };
  return pool;
}

const FLAGS_ON = parseRuntimeFlags({
  RUNTIME_GOVERNANCE_ENABLED: "true",
  RUNTIME_EMIT_BFF_DB: "true",
});

const FLAGS_OFF = parseRuntimeFlags({});

describe("DB substrate probes — individual probe primitives", () => {
  it("probeAppPool returns status='pass' with duration_ms on success", async () => {
    const pool = makeFakePool({});
    const result = await probeAppPool(pool as unknown as never);
    expect(result.status).toBe("pass");
    expect(typeof result.durationMs).toBe("number");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.error).toBeUndefined();
  });

  it("probeAppPool returns status='fail' with the error when connect rejects", async () => {
    const pool = makeFakePool({ connectFails: new Error("ECONNREFUSED") });
    const result = await probeAppPool(pool as unknown as never);
    expect(result.status).toBe("fail");
    expect(result.error?.message).toBe("ECONNREFUSED");
  });

  it("probeAppPool does NOT throw to the caller even if pool.connect rejects", async () => {
    const pool = makeFakePool({ connectFails: new Error("any") });
    let threw = false;
    try {
      await probeAppPool(pool as unknown as never);
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });

  it("probeServicePool returns status='fail' when connect rejects", async () => {
    const pool = makeFakePool({ connectFails: new Error("svc-down") });
    const result = await probeServicePool(pool as unknown as never);
    expect(result.status).toBe("fail");
    expect(result.error?.message).toBe("svc-down");
  });

  it("probeCriticalQuery returns status='fail' when SELECT fails", async () => {
    const pool = makeFakePool({ queryFails: new Error("boom") });
    const result = await probeCriticalQuery(pool as unknown as never);
    expect(result.status).toBe("fail");
    expect(result.error?.message).toBe("boom");
  });

  it("probeCriticalQuery returns status='pass' when SELECT succeeds", async () => {
    const pool = makeFakePool({});
    const result = await probeCriticalQuery(pool as unknown as never);
    expect(result.status).toBe("pass");
  });
});

describe("runDbSubstrateProbes — self-check + emit integration", () => {
  it("writes self-check rows for all three phase-1 DB ids on success, no runtime_event row", async () => {
    const client = makeRecordingClient();
    const appPool = makeFakePool({});
    const servicePool = makeFakePool({});

    await runDbSubstrateProbes({
      flags: FLAGS_ON,
      appPool: appPool as unknown as never,
      servicePool: servicePool as unknown as never,
      client,
      now: new Date("2026-04-18T10:00:00.000Z"),
    });

    const upserts = client.calls.filter((c) =>
      /INSERT INTO runtime_self_checks/.test(c.sql),
    );
    const inserts = client.calls.filter((c) =>
      /INSERT INTO runtime_events/.test(c.sql),
    );
    expect(upserts).toHaveLength(3);
    expect(inserts).toHaveLength(0);
    const ids = upserts.map((c) => c.params[0]);
    expect(ids).toEqual(
      expect.arrayContaining([
        "db.app_pool.reachable",
        "db.service_pool.reachable",
        "db.critical_query",
      ]),
    );
  });

  it("emits db.app_pool.unreachable runtime_event AND writes fail self-check when the app pool probe fails", async () => {
    const client = makeRecordingClient();
    const appPool = makeFakePool({ connectFails: new Error("no-route") });
    const servicePool = makeFakePool({});

    await runDbSubstrateProbes({
      flags: FLAGS_ON,
      appPool: appPool as unknown as never,
      servicePool: servicePool as unknown as never,
      client,
      now: new Date("2026-04-18T10:00:00.000Z"),
    });

    const inserts = client.calls.filter((c) =>
      /INSERT INTO runtime_events/.test(c.sql),
    );
    expect(inserts.length).toBeGreaterThanOrEqual(1);
    const eventCodes = inserts.map((c) => c.params[1]);
    expect(eventCodes).toContain("db.app_pool.unreachable");

    const selfChecks = client.calls.filter((c) =>
      /INSERT INTO runtime_self_checks/.test(c.sql),
    );
    const appCheck = selfChecks.find(
      (c) => c.params[0] === "db.app_pool.reachable",
    );
    expect(appCheck).toBeDefined();
    expect(appCheck?.params[4]).toBe("fail"); // last_status column
  });

  it("emits db.critical_query.failed when the representative query probe fails", async () => {
    const client = makeRecordingClient();
    const appPool = makeFakePool({});
    const servicePool = makeFakePool({ queryFails: new Error("query-fail") });

    await runDbSubstrateProbes({
      flags: FLAGS_ON,
      appPool: appPool as unknown as never,
      servicePool: servicePool as unknown as never,
      client,
      now: new Date("2026-04-18T10:00:00.000Z"),
    });

    const inserts = client.calls.filter((c) =>
      /INSERT INTO runtime_events/.test(c.sql),
    );
    const codes = inserts.map((c) => c.params[1]);
    expect(codes).toContain("db.critical_query.failed");
  });

  it("is a no-op when governance flag is off (neither events nor self-checks written)", async () => {
    const client = makeRecordingClient();
    const appPool = makeFakePool({ connectFails: new Error("would-fail") });
    const servicePool = makeFakePool({});

    await runDbSubstrateProbes({
      flags: FLAGS_OFF,
      appPool: appPool as unknown as never,
      servicePool: servicePool as unknown as never,
      client,
      now: new Date(),
    });

    expect(client.calls).toHaveLength(0);
  });

  it("never throws to the caller even if the runtime client rejects every write", async () => {
    const failingClient: RuntimeQueryable = {
      async query() {
        throw new Error("runtime-db-offline");
      },
    };
    const appPool = makeFakePool({});
    const servicePool = makeFakePool({});

    let threw = false;
    try {
      await runDbSubstrateProbes({
        flags: FLAGS_ON,
        appPool: appPool as unknown as never,
        servicePool: servicePool as unknown as never,
        client: failingClient,
        now: new Date(),
        logger: () => {},
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });

  it("emits a recover-lifecycle runtime_event when a pass probe follows an active failure cycle (fail → pass I2 recovery)", async () => {
    // Seed the state the I2 evidence showed live: db.app_pool.unreachable
    // projected as an open critical issue (state=detected) from a prior
    // failing probe cycle. A subsequent pass probe must transition it out of
    // the active cycle via a canonical `recover` lifecycle event.
    const failFingerprint = computeFingerprint({
      event_code: "db.app_pool.unreachable",
      source: "db",
    });
    const seeded = new Map<string, SeededIssueRow>([
      [
        failFingerprint,
        seededIssueRow({
          fingerprint: failFingerprint,
          event_code: "db.app_pool.unreachable",
          state: "detected",
          current_severity: "critical",
        }),
      ],
    ]);
    const client = makeRecordingClient({ seededIssues: seeded });

    const appPool = makeFakePool({});
    const servicePool = makeFakePool({});

    await runDbSubstrateProbes({
      flags: FLAGS_ON,
      appPool: appPool as unknown as never,
      servicePool: servicePool as unknown as never,
      client,
      now: new Date("2026-04-18T11:00:00.000Z"),
    });

    const inserts = client.calls.filter((c) =>
      /INSERT INTO runtime_events/.test(c.sql),
    );
    // At least the recovery event must have been inserted.
    const recoveryInserts = inserts.filter(
      (c) =>
        c.params[1] === "db.app_pool.unreachable" &&
        c.params[4] === "recover",
    );
    expect(recoveryInserts).toHaveLength(1);

    // Projection must write the runtime_issues row back in a non-active state.
    const issueUpserts = client.calls.filter((c) =>
      /INSERT INTO runtime_issues/.test(c.sql),
    );
    const relevant = issueUpserts.filter((c) => c.params[0] === failFingerprint);
    expect(relevant.length).toBeGreaterThanOrEqual(1);
    const finalState = relevant[relevant.length - 1].params[11];
    expect(finalState).toBe("recovered");
  });

  it("does NOT emit a recovery event when the probe passes and no active issue exists for that event_code", async () => {
    const client = makeRecordingClient(); // no seeded issues
    const appPool = makeFakePool({});
    const servicePool = makeFakePool({});

    await runDbSubstrateProbes({
      flags: FLAGS_ON,
      appPool: appPool as unknown as never,
      servicePool: servicePool as unknown as never,
      client,
      now: new Date("2026-04-18T11:00:00.000Z"),
    });

    const inserts = client.calls.filter((c) =>
      /INSERT INTO runtime_events/.test(c.sql),
    );
    const recovers = inserts.filter((c) => c.params[4] === "recover");
    expect(recovers).toHaveLength(0);
  });

  it("does NOT emit recovery when the prior issue is already recovered/closed/suppressed", async () => {
    const failFingerprint = computeFingerprint({
      event_code: "db.app_pool.unreachable",
      source: "db",
    });
    const seeded = new Map<string, SeededIssueRow>([
      [
        failFingerprint,
        seededIssueRow({
          fingerprint: failFingerprint,
          state: "recovered",
          recovered_at: "2026-04-18T10:30:00.000Z",
        }),
      ],
    ]);
    const client = makeRecordingClient({ seededIssues: seeded });
    const appPool = makeFakePool({});
    const servicePool = makeFakePool({});

    await runDbSubstrateProbes({
      flags: FLAGS_ON,
      appPool: appPool as unknown as never,
      servicePool: servicePool as unknown as never,
      client,
      now: new Date("2026-04-18T11:00:00.000Z"),
    });

    const recovers = client.calls.filter(
      (c) =>
        /INSERT INTO runtime_events/.test(c.sql) && c.params[4] === "recover",
    );
    expect(recovers).toHaveLength(0);
  });
});

describe("attachPoolIdleErrorEmitter — structured pool idle-error facts", () => {
  it("emits a db.pool.idle_error runtime event when the pool fires 'error' and the flag is on", async () => {
    const client = makeRecordingClient();
    const pool = makeFakePool({});

    attachPoolIdleErrorEmitter(pool as unknown as never, {
      pool: "app",
      flags: FLAGS_ON,
      client,
    });

    pool.emit("error", new Error("idle-client-lost"));

    // Wait a microtask for async emit to complete.
    await new Promise((r) => setImmediate(r));

    const inserts = client.calls.filter((c) =>
      /INSERT INTO runtime_events/.test(c.sql),
    );
    expect(inserts.length).toBeGreaterThanOrEqual(1);
    expect(inserts[0].params[1]).toBe("db.pool.idle_error");
  });

  it("is a no-op when governance flag is off (no runtime_event written)", async () => {
    const client = makeRecordingClient();
    const pool = makeFakePool({});

    attachPoolIdleErrorEmitter(pool as unknown as never, {
      pool: "service",
      flags: FLAGS_OFF,
      client,
    });

    pool.emit("error", new Error("whatever"));

    await new Promise((r) => setImmediate(r));

    expect(client.calls).toHaveLength(0);
  });

  it("swallows emit failures — pool error handler must not re-throw", async () => {
    const failingClient: RuntimeQueryable = {
      async query() {
        throw new Error("persist-failed");
      },
    };
    const pool = makeFakePool({});

    attachPoolIdleErrorEmitter(pool as unknown as never, {
      pool: "app",
      flags: FLAGS_ON,
      client: failingClient,
      logger: () => {},
    });

    let threw = false;
    try {
      pool.emit("error", new Error("idle-err"));
      await new Promise((r) => setImmediate(r));
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });
});
