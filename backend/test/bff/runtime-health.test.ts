// ---------------------------------------------------------------------------
// Tests: GET /api/runtime/health (WS3 — v6.10 runtime governance operator API)
// ---------------------------------------------------------------------------
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import type {
  RuntimeIssue,
  RuntimeSelfCheckRow,
} from "../../src/shared/types/runtime";

const mockParseRuntimeFlags = jest.fn();
const mockRunWithServicePool = jest.fn();
const mockFetchActiveRuntimeIssues = jest.fn();
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
  fetchActiveRuntimeIssues: (c: unknown) => mockFetchActiveRuntimeIssues(c),
  fetchLatestSelfChecks: (c: unknown) => mockFetchLatestSelfChecks(c),
}));

import { handler } from "../../src/bff/handlers/get-runtime-health";

function event(
  authHeader = JSON.stringify({
    userId: "u1",
    orgId: "ORG_X",
    role: "SOLFACIL_ADMIN",
  }),
): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: "GET /api/runtime/health",
    rawPath: "/api/runtime/health",
    rawQueryString: "",
    headers: { authorization: authHeader },
    requestContext: {
      accountId: "a",
      apiId: "b",
      domainName: "c",
      domainPrefix: "d",
      http: {
        method: "GET",
        path: "/api/runtime/health",
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "jest",
      },
      requestId: "r",
      routeKey: "GET /api/runtime/health",
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
  mockFetchActiveRuntimeIssues.mockResolvedValue([]);
  mockFetchLatestSelfChecks.mockResolvedValue([]);
});

describe("GET /api/runtime/health — auth gate", () => {
  it("rejects non-admin with 403", async () => {
    mockParseRuntimeFlags.mockReturnValue({
      governanceEnabled: true,
      slices: {},
    });
    const res = parse(
      await handler(
        event(
          JSON.stringify({
            userId: "u2",
            orgId: "ORG_X",
            role: "ORG_OPERATOR",
          }),
        ),
      ),
    );
    expect(res.statusCode).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it("rejects missing auth with 401", async () => {
    mockParseRuntimeFlags.mockReturnValue({
      governanceEnabled: true,
      slices: {},
    });
    const res = parse(await handler(event("")));
    expect(res.statusCode).toBe(401);
  });
});

describe("GET /api/runtime/health — disabled posture", () => {
  it("returns overall='disabled' when governance feature flag is off", async () => {
    mockParseRuntimeFlags.mockReturnValue({
      governanceEnabled: false,
      slices: {},
    });
    const res = parse(await handler(event()));
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.overall).toBe("disabled");
    expect(res.body.data.components).toEqual({});
    expect(res.body.data.criticalOpenCount).toBe(0);
    expect(mockFetchActiveRuntimeIssues).not.toHaveBeenCalled();
    expect(mockFetchLatestSelfChecks).not.toHaveBeenCalled();
  });
});

describe("GET /api/runtime/health — derived posture", () => {
  it("returns derived 'ok' posture when no active issues and all checks pass", async () => {
    mockParseRuntimeFlags.mockReturnValue({
      governanceEnabled: true,
      slices: {},
    });
    mockFetchActiveRuntimeIssues.mockResolvedValue([]);
    mockFetchLatestSelfChecks.mockResolvedValue([
      {
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
      } satisfies RuntimeSelfCheckRow,
    ]);

    const res = parse(await handler(event()));
    expect(res.statusCode).toBe(200);
    expect(res.body.data.overall).toBe("ok");
    expect(res.body.data.selfCheckAllPass).toBe(true);
    expect(res.body.data.components).toEqual({ db: "ok" });
  });

  it("escalates to 'critical' when an active issue has critical severity", async () => {
    mockParseRuntimeFlags.mockReturnValue({
      governanceEnabled: true,
      slices: {},
    });
    mockFetchActiveRuntimeIssues.mockResolvedValue([
      {
        fingerprint: "fp1",
        event_code: "db.critical_query.failed",
        source: "db",
        tenant_scope: null,
        cycle_count: 1,
        current_cycle_started_at: "2026-04-18T08:59:00.000Z",
        first_detected_at: "2026-04-18T08:59:00.000Z",
        last_observed_at: "2026-04-18T09:00:00.000Z",
        recovered_at: null,
        closed_at: null,
        suppressed_until: null,
        state: "ongoing",
        current_severity: "critical",
        observation_count: 2,
        summary: "boom",
        latest_detail: null,
        operator_note: null,
        operator_actor: null,
        updated_at: "2026-04-18T09:00:00.000Z",
      } satisfies RuntimeIssue,
    ]);
    mockFetchLatestSelfChecks.mockResolvedValue([]);

    const res = parse(await handler(event()));
    expect(res.statusCode).toBe(200);
    expect(res.body.data.overall).toBe("critical");
    expect(res.body.data.criticalOpenCount).toBe(1);
    expect(res.body.data.components.db).toBe("critical");
  });
});
