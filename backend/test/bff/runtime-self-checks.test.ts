// ---------------------------------------------------------------------------
// Tests: GET /api/runtime/self-checks (WS3 — v6.10 runtime governance)
// ---------------------------------------------------------------------------
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import type { RuntimeSelfCheckRow } from "../../src/shared/types/runtime";

const mockParseRuntimeFlags = jest.fn();
const mockRunWithServicePool = jest.fn();
const mockFetchLatestSelfChecks = jest.fn();

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
  fetchLatestSelfChecks: (c: unknown) => mockFetchLatestSelfChecks(c),
}));

import { handler } from "../../src/bff/handlers/get-runtime-self-checks";

function event(
  authHeader = JSON.stringify({
    userId: "u1",
    orgId: "ORG_X",
    role: "SOLFACIL_ADMIN",
  }),
): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: "GET /api/runtime/self-checks",
    rawPath: "/api/runtime/self-checks",
    rawQueryString: "",
    headers: { authorization: authHeader },
    requestContext: {
      accountId: "a",
      apiId: "b",
      domainName: "c",
      domainPrefix: "d",
      http: {
        method: "GET",
        path: "/api/runtime/self-checks",
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "jest",
      },
      requestId: "r",
      routeKey: "GET /api/runtime/self-checks",
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

describe("GET /api/runtime/self-checks", () => {
  it("rejects non-admin with 403", async () => {
    mockParseRuntimeFlags.mockReturnValue({
      governanceEnabled: true,
      slices: {},
    });
    const res = parse(
      await handler(
        event(
          JSON.stringify({
            userId: "u",
            orgId: "ORG_X",
            role: "ORG_MANAGER",
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
    expect(res.body.data.checks).toEqual([]);
    expect(mockFetchLatestSelfChecks).not.toHaveBeenCalled();
  });

  it("returns latest-state rows when feature on", async () => {
    mockParseRuntimeFlags.mockReturnValue({
      governanceEnabled: true,
      slices: {},
    });
    const row: RuntimeSelfCheckRow = {
      check_id: "db.app_pool.reachable",
      source: "db",
      run_host: null,
      cadence_seconds: 30,
      last_status: "pass",
      last_run_at: "2026-04-18T09:00:00.000Z",
      last_pass_at: "2026-04-18T09:00:00.000Z",
      last_duration_ms: 4,
      consecutive_failures: 0,
      latest_detail: null,
      updated_at: "2026-04-18T09:00:00.000Z",
    };
    mockFetchLatestSelfChecks.mockResolvedValue([row]);

    const res = parse(await handler(event()));
    expect(res.statusCode).toBe(200);
    expect(res.body.data.checks).toHaveLength(1);
    expect(res.body.data.checks[0].check_id).toBe("db.app_pool.reachable");
    expect(res.body.data.checks[0].last_status).toBe("pass");
  });
});
