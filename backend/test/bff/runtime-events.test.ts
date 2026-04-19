// ---------------------------------------------------------------------------
// Tests: GET /api/runtime/events (WS3 — v6.10 runtime governance)
// ---------------------------------------------------------------------------
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import type { RuntimeEvent } from "../../src/shared/types/runtime";

const mockParseRuntimeFlags = jest.fn();
const mockRunWithServicePool = jest.fn();
const mockFetchRecentRuntimeEvents = jest.fn();

jest.mock("../../src/shared/runtime/flags", () => {
  const actual = jest.requireActual("../../src/shared/runtime/flags");
  return {
    ...actual,
    parseRuntimeFlags: (env: NodeJS.ProcessEnv) => mockParseRuntimeFlags(env),
  };
});

jest.mock("../../src/shared/runtime/persistence", () => ({
  runWithServicePool: (fn: (c: unknown) => Promise<unknown>) =>
    mockRunWithServicePool(fn),
  fetchRecentRuntimeEvents: (c: unknown, limit: number) =>
    mockFetchRecentRuntimeEvents(c, limit),
}));

import { handler } from "../../src/bff/handlers/get-runtime-events";

function event(
  query = "",
  authHeader = JSON.stringify({
    userId: "u1",
    orgId: "ORG_X",
    role: "SOLFACIL_ADMIN",
  }),
): APIGatewayProxyEventV2 {
  const qsParams: Record<string, string> = {};
  if (query) {
    for (const p of query.split("&")) {
      const [k, v] = p.split("=");
      if (k) qsParams[k] = v ?? "";
    }
  }
  return {
    version: "2.0",
    routeKey: "GET /api/runtime/events",
    rawPath: "/api/runtime/events",
    rawQueryString: query,
    queryStringParameters: Object.keys(qsParams).length > 0 ? qsParams : undefined,
    headers: { authorization: authHeader },
    requestContext: {
      accountId: "a",
      apiId: "b",
      domainName: "c",
      domainPrefix: "d",
      http: {
        method: "GET",
        path: "/api/runtime/events",
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "jest",
      },
      requestId: "r",
      routeKey: "GET /api/runtime/events",
      stage: "$default",
      time: new Date().toISOString(),
      timeEpoch: Date.now(),
    },
    isBase64Encoded: false,
  };
}

function parse(res: Awaited<ReturnType<typeof handler>>) {
  const r = res as { statusCode: number; body: string };
  return { statusCode: r.statusCode, body: JSON.parse(r.body) };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRunWithServicePool.mockImplementation(
    async (fn: (c: unknown) => Promise<unknown>) => fn({}),
  );
});

describe("GET /api/runtime/events", () => {
  it("rejects non-admin with 403", async () => {
    mockParseRuntimeFlags.mockReturnValue({
      governanceEnabled: true,
      slices: {},
    });
    const res = parse(
      await handler(
        event(
          "",
          JSON.stringify({
            userId: "u",
            orgId: "ORG_X",
            role: "ORG_OPERATOR",
          }),
        ),
      ),
    );
    expect(res.statusCode).toBe(403);
  });

  it("returns disabled posture when feature flag off", async () => {
    mockParseRuntimeFlags.mockReturnValue({
      governanceEnabled: false,
      slices: {},
    });
    const res = parse(await handler(event()));
    expect(res.statusCode).toBe(200);
    expect(res.body.data.overall).toBe("disabled");
    expect(res.body.data.events).toEqual([]);
    expect(mockFetchRecentRuntimeEvents).not.toHaveBeenCalled();
  });

  it("returns recent events with default limit", async () => {
    mockParseRuntimeFlags.mockReturnValue({
      governanceEnabled: true,
      slices: {},
    });
    const evt: RuntimeEvent = {
      event_id: "evt-1",
      event_code: "bff.boot.started",
      source: "bff",
      severity: "info",
      lifecycle_hint: "ongoing",
      occurred_at: "2026-04-18T09:00:00.000Z",
      observed_at: "2026-04-18T09:00:00.000Z",
      fingerprint: "fp-bff",
      correlation_id: null,
      tenant_scope: null,
      summary: null,
      detail: null,
    };
    mockFetchRecentRuntimeEvents.mockResolvedValue([evt]);

    const res = parse(await handler(event()));
    expect(res.statusCode).toBe(200);
    expect(res.body.data.events).toHaveLength(1);
    expect(res.body.data.events[0].event_id).toBe("evt-1");
    expect(mockFetchRecentRuntimeEvents).toHaveBeenCalledTimes(1);
    const limit = mockFetchRecentRuntimeEvents.mock.calls[0][1];
    expect(typeof limit).toBe("number");
    expect(limit).toBeGreaterThan(0);
  });

  it("clamps oversize limit param", async () => {
    mockParseRuntimeFlags.mockReturnValue({
      governanceEnabled: true,
      slices: {},
    });
    mockFetchRecentRuntimeEvents.mockResolvedValue([]);

    const res = parse(await handler(event("limit=99999")));
    expect(res.statusCode).toBe(200);
    const limit = mockFetchRecentRuntimeEvents.mock.calls[0][1];
    expect(limit).toBeLessThanOrEqual(500);
  });
});
