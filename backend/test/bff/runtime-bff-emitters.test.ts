/**
 * WS4 — BFF boot / unhandled-exception / auth-anomaly runtime emitters.
 *
 * Contract under test:
 *  - bff.boot.started / bff.boot.ready / bff.boot.failed emit exactly the
 *    codes registered in the contract, using the canonical source "bff".
 *  - bff.handler.unhandled_exception is emitted with the route folded into
 *    dedup_keys so repeated exceptions at the same route collapse to one
 *    issue row.
 *  - All emit wrappers are strictly best-effort: they never throw to the
 *    caller, and they neutralize when the governance flag is off.
 *  - The unhandled-exception wrapHandler decorator preserves the underlying
 *    handler's response contract: a handler that throws still returns a 500
 *    JSON envelope, and a handler that succeeds is pass-through.
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { parseRuntimeFlags } from "../../src/shared/runtime/flags";
import type { RuntimeQueryable } from "../../src/shared/runtime/persistence";
import {
  emitBffBootFailed,
  emitBffBootReady,
  emitBffBootStarted,
  emitBffAuthAnomalyBurst,
  emitBffUnhandledException,
  wrapHandlerWithRuntimeBoundary,
} from "../../src/shared/runtime/bff-emitters";

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
  RUNTIME_EMIT_BFF_DB: "true",
});

const FLAGS_OFF = parseRuntimeFlags({});

function extractEventCodes(calls: QueryCall[]): string[] {
  return calls
    .filter((c) => /INSERT INTO runtime_events/.test(c.sql))
    .map((c) => String(c.params[1]));
}

describe("emitBffBootStarted / emitBffBootReady / emitBffBootFailed", () => {
  it("emits bff.boot.started when the flag is on", async () => {
    const client = makeRecordingClient();
    const result = await emitBffBootStarted({ flags: FLAGS_ON, client });
    expect(result.status).toBe("persisted");
    expect(extractEventCodes(client.calls)).toContain("bff.boot.started");
  });

  it("emits bff.boot.ready with the registered event code", async () => {
    const client = makeRecordingClient();
    await emitBffBootReady({ flags: FLAGS_ON, client });
    expect(extractEventCodes(client.calls)).toContain("bff.boot.ready");
  });

  it("emits bff.boot.failed including the error message in detail", async () => {
    const client = makeRecordingClient();
    await emitBffBootFailed(
      { flags: FLAGS_ON, client },
      new Error("listen-EADDRINUSE"),
    );
    const insert = client.calls.find((c) =>
      /INSERT INTO runtime_events/.test(c.sql),
    );
    expect(insert).toBeDefined();
    expect(insert?.params[1]).toBe("bff.boot.failed");
    const detailJson = insert?.params[11];
    expect(typeof detailJson).toBe("string");
    expect(String(detailJson)).toMatch(/listen-EADDRINUSE/);
  });

  it("is a no-op when governance flag is off", async () => {
    const client = makeRecordingClient();
    const a = await emitBffBootStarted({ flags: FLAGS_OFF, client });
    const b = await emitBffBootReady({ flags: FLAGS_OFF, client });
    const c = await emitBffBootFailed(
      { flags: FLAGS_OFF, client },
      new Error("boom"),
    );
    expect(a.status).toBe("disabled");
    expect(b.status).toBe("disabled");
    expect(c.status).toBe("disabled");
    expect(client.calls).toHaveLength(0);
  });
});

describe("emitBffUnhandledException", () => {
  it("emits bff.handler.unhandled_exception with route folded into dedup_keys", async () => {
    const client = makeRecordingClient();
    const result = await emitBffUnhandledException(
      { flags: FLAGS_ON, client },
      { route: "GET /api/dashboard", error: new Error("blew up") },
    );
    expect(result.status).toBe("persisted");
    const codes = extractEventCodes(client.calls);
    expect(codes).toContain("bff.handler.unhandled_exception");

    // Exceptions at the same route share a fingerprint; different routes do not.
    const client2 = makeRecordingClient();
    const resA = await emitBffUnhandledException(
      { flags: FLAGS_ON, client: client2 },
      { route: "GET /api/foo", error: new Error("x") },
    );
    const resB = await emitBffUnhandledException(
      { flags: FLAGS_ON, client: client2 },
      { route: "GET /api/bar", error: new Error("x") },
    );
    expect(resA.event?.fingerprint).not.toBe(resB.event?.fingerprint);
  });

  it("never throws even when the emit call rejects internally", async () => {
    const failing: RuntimeQueryable = {
      async query() {
        throw new Error("persist-died");
      },
    };
    let threw = false;
    try {
      await emitBffUnhandledException(
        { flags: FLAGS_ON, client: failing, logger: () => {} },
        { route: "GET /api/anything", error: new Error("x") },
      );
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });
});

describe("wrapHandlerWithRuntimeBoundary", () => {
  const ok: APIGatewayProxyResultV2 = {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: true }),
  };
  const baseEvent = {
    routeKey: "GET /api/demo",
    rawPath: "/api/demo",
  } as unknown as APIGatewayProxyEventV2;

  it("passes through the handler result when no error is thrown", async () => {
    const client = makeRecordingClient();
    const wrapped = wrapHandlerWithRuntimeBoundary(
      async () => ok,
      { flags: FLAGS_ON, client },
    );
    const result = await wrapped(baseEvent);
    expect(result).toEqual(ok);
    // Pass-through should not emit any runtime event.
    expect(extractEventCodes(client.calls)).toHaveLength(0);
  });

  it("catches handler exceptions, emits bff.handler.unhandled_exception, and returns a 500 envelope", async () => {
    const client = makeRecordingClient();
    const wrapped = wrapHandlerWithRuntimeBoundary(
      async () => {
        throw new Error("handler-crash");
      },
      { flags: FLAGS_ON, client },
    );
    const result = (await wrapped(baseEvent)) as {
      statusCode?: number;
      body?: string;
    };
    expect(result.statusCode).toBe(500);
    expect(String(result.body)).toMatch(/Internal server error/);
    expect(extractEventCodes(client.calls)).toContain(
      "bff.handler.unhandled_exception",
    );
  });

  it("still returns 500 even when the runtime emitter itself fails (response contract preserved)", async () => {
    const failing: RuntimeQueryable = {
      async query() {
        throw new Error("runtime-ded");
      },
    };
    const wrapped = wrapHandlerWithRuntimeBoundary(
      async () => {
        throw new Error("handler-crash");
      },
      { flags: FLAGS_ON, client: failing, logger: () => {} },
    );
    const result = (await wrapped(baseEvent)) as { statusCode?: number };
    expect(result.statusCode).toBe(500);
  });
});

describe("emitBffAuthAnomalyBurst — bounded anomaly emission", () => {
  it("emits bff.auth.anomaly_burst with tenant_scope from the caller's context", async () => {
    const client = makeRecordingClient();
    const result = await emitBffAuthAnomalyBurst(
      { flags: FLAGS_ON, client },
      { tenantScope: "ip:10.0.0.1", reason: "ip_threshold_exceeded" },
    );
    expect(result.status).toBe("persisted");
    const insert = client.calls.find((c) =>
      /INSERT INTO runtime_events/.test(c.sql),
    );
    expect(insert?.params[1]).toBe("bff.auth.anomaly_burst");
    expect(insert?.params[9]).toBe("ip:10.0.0.1"); // tenant_scope column
  });

  it("produces one fingerprint per tenant_scope so per-IP/email bursts stay distinct", async () => {
    const clientA = makeRecordingClient();
    const clientB = makeRecordingClient();
    const a = await emitBffAuthAnomalyBurst(
      { flags: FLAGS_ON, client: clientA },
      { tenantScope: "ip:1.1.1.1", reason: "ip_threshold_exceeded" },
    );
    const b = await emitBffAuthAnomalyBurst(
      { flags: FLAGS_ON, client: clientB },
      { tenantScope: "ip:2.2.2.2", reason: "ip_threshold_exceeded" },
    );
    expect(a.event?.fingerprint).not.toBe(b.event?.fingerprint);
  });

  it("is a full no-op when governance flag is off", async () => {
    const client = makeRecordingClient();
    const result = await emitBffAuthAnomalyBurst(
      { flags: FLAGS_OFF, client },
      { tenantScope: "ip:x", reason: "ip_threshold_exceeded" },
    );
    expect(result.status).toBe("disabled");
    expect(client.calls).toHaveLength(0);
  });
});
