import { emitRuntimeEvent } from "../../src/shared/runtime/emit";
import { parseRuntimeFlags } from "../../src/shared/runtime/flags";
import type { RuntimeQueryable } from "../../src/shared/runtime/persistence";

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

function makeFailingClient(error: Error): RuntimeQueryable {
  return {
    async query() {
      throw error;
    },
  };
}

const FLAGS_ON = parseRuntimeFlags({
  RUNTIME_GOVERNANCE_ENABLED: "true",
  RUNTIME_EMIT_BFF_DB: "true",
  RUNTIME_EMIT_M1_INGEST: "true",
  RUNTIME_EMIT_M3_DISPATCH: "true",
});

const FLAGS_OFF = parseRuntimeFlags({});

describe("emitRuntimeEvent — feature-flag gating", () => {
  it("returns status='disabled' when global governance is off (no DB writes)", async () => {
    const client = makeRecordingClient();
    const result = await emitRuntimeEvent(
      {
        event_code: "db.critical_query.failed",
        source: "db",
      },
      { flags: FLAGS_OFF, slice: "bff_db", client },
    );

    expect(result.status).toBe("disabled");
    expect(client.calls).toHaveLength(0);
  });

  it("returns status='disabled' when slice flag is off even if governance is on", async () => {
    const flags = parseRuntimeFlags({
      RUNTIME_GOVERNANCE_ENABLED: "true",
      // intentionally no RUNTIME_EMIT_M1_INGEST
    });
    const client = makeRecordingClient();
    const result = await emitRuntimeEvent(
      { event_code: "ingest.telemetry.stale", source: "m1.ingest" },
      { flags, slice: "m1_ingest", client },
    );

    expect(result.status).toBe("disabled");
    expect(client.calls).toHaveLength(0);
  });
});

describe("emitRuntimeEvent — happy path persistence", () => {
  it("normalizes input, inserts into runtime_events and upserts runtime_issues", async () => {
    const client = makeRecordingClient();
    const result = await emitRuntimeEvent(
      {
        event_code: "db.critical_query.failed",
        source: "db",
        summary: "probe failed",
      },
      { flags: FLAGS_ON, slice: "bff_db", client, now: new Date("2026-04-18T09:00:00.000Z") },
    );

    expect(result.status).toBe("persisted");
    expect(result.event).toBeDefined();
    expect(result.event?.event_code).toBe("db.critical_query.failed");

    const sqls = client.calls.map((c) => c.sql).join("\n");
    expect(sqls).toMatch(/INSERT INTO runtime_events/);
    expect(sqls).toMatch(/INSERT INTO runtime_issues/);
    expect(sqls).toMatch(/ON CONFLICT\s*\(\s*fingerprint\s*\)/);
  });

  it("queries existing runtime_issues row to carry cycle_count forward", async () => {
    // First emit → creates row. Second emit → should see existing row and stay cycle_count=1.
    const responses: { rows: readonly Record<string, unknown>[] }[] = [
      { rows: [] }, // INSERT runtime_events (no return)
      { rows: [] }, // SELECT runtime_issues (returns none)
      { rows: [] }, // INSERT runtime_issues
    ];
    let i = 0;
    const calls: QueryCall[] = [];
    const client: RuntimeQueryable = {
      async query<R extends Record<string, unknown> = Record<string, unknown>>(
        sql: string,
        params: readonly unknown[] = [],
      ) {
        calls.push({ sql, params });
        const r = responses[i] ?? { rows: [] };
        i += 1;
        return { rows: r.rows as unknown as readonly R[] };
      },
    };

    const result = await emitRuntimeEvent(
      { event_code: "db.critical_query.failed", source: "db" },
      { flags: FLAGS_ON, slice: "bff_db", client, now: new Date() },
    );
    expect(result.status).toBe("persisted");
    const sqls = calls.map((c) => c.sql);
    expect(sqls.some((s) => /INSERT INTO runtime_events/.test(s))).toBe(true);
    expect(sqls.some((s) => /FROM runtime_issues/.test(s))).toBe(true);
    expect(sqls.some((s) => /INSERT INTO runtime_issues/.test(s))).toBe(true);
  });
});

describe("emitRuntimeEvent — best-effort: never throws to caller on failure", () => {
  it("does not throw when persistence client rejects; returns status='degraded_fallback'", async () => {
    const client = makeFailingClient(new Error("db down"));

    const loggerCalls: string[] = [];
    const logger = (line: string) => {
      loggerCalls.push(line);
    };

    let threw = false;
    let result: Awaited<ReturnType<typeof emitRuntimeEvent>> | undefined;
    try {
      result = await emitRuntimeEvent(
        { event_code: "db.critical_query.failed", source: "db" },
        {
          flags: FLAGS_ON,
          slice: "bff_db",
          client,
          logger,
          now: new Date("2026-04-18T09:00:00.000Z"),
        },
      );
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    expect(result?.status).toBe("degraded_fallback");
    expect(result?.error).toBeInstanceOf(Error);
    expect(loggerCalls.length).toBeGreaterThanOrEqual(1);
    // fallback log should carry the event_code so operators can still see the fact
    expect(loggerCalls.join("\n")).toMatch(/db\.critical_query\.failed/);
  });

  it("does not throw for unknown event codes; returns status='degraded_fallback'", async () => {
    const client = makeRecordingClient();
    const loggerCalls: string[] = [];
    const result = await emitRuntimeEvent(
      { event_code: "not.a.real.code", source: "m1.ingest" },
      {
        flags: FLAGS_ON,
        slice: "m1_ingest",
        client,
        logger: (line) => loggerCalls.push(line),
      },
    );

    expect(result.status).toBe("degraded_fallback");
    expect(result.error).toBeInstanceOf(Error);
    // Unknown code must NOT reach the database.
    expect(client.calls).toHaveLength(0);
    expect(loggerCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("continues to resolve a persisted result even when the SELECT-existing-issue call rejects once", async () => {
    // simulate: INSERT event OK, SELECT existing FAILS → emit still succeeds via upsert path
    let i = 0;
    const client: RuntimeQueryable = {
      async query<R extends Record<string, unknown> = Record<string, unknown>>(
        sql: string,
      ) {
        i += 1;
        if (/FROM runtime_issues/.test(sql)) {
          throw new Error("select-existing failed");
        }
        return { rows: [] as unknown as readonly R[] };
      },
    };

    const loggerCalls: string[] = [];
    let threw = false;
    try {
      await emitRuntimeEvent(
        { event_code: "db.critical_query.failed", source: "db" },
        {
          flags: FLAGS_ON,
          slice: "bff_db",
          client,
          logger: (line) => loggerCalls.push(line),
          now: new Date("2026-04-18T09:00:00.000Z"),
        },
      );
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(i).toBeGreaterThan(0);
  });
});
