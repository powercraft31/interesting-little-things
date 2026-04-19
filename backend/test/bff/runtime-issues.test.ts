// ---------------------------------------------------------------------------
// Tests: GET /api/runtime/issues  +  GET /api/runtime/issues/:fingerprint
// WS3 — v6.10 runtime governance operator API
// ---------------------------------------------------------------------------
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import type {
  RuntimeEvent,
  RuntimeIssue,
} from "../../src/shared/types/runtime";

const mockParseRuntimeFlags = jest.fn();
const mockRunWithServicePool = jest.fn();
const mockFetchActiveRuntimeIssues = jest.fn();
const mockFetchRuntimeIssueByFingerprint = jest.fn();
const mockFetchRecentRuntimeEventsByFingerprint = jest.fn();

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
  fetchRuntimeIssueByFingerprint: (c: unknown, fp: string) =>
    mockFetchRuntimeIssueByFingerprint(c, fp),
  fetchRecentRuntimeEventsByFingerprint: (
    c: unknown,
    fp: string,
    limit: number,
  ) => mockFetchRecentRuntimeEventsByFingerprint(c, fp, limit),
}));

import { handler as listHandler } from "../../src/bff/handlers/get-runtime-issues";
import { handler as detailHandler } from "../../src/bff/handlers/get-runtime-issue-detail";

function event(
  path: string,
  authHeader = JSON.stringify({
    userId: "u1",
    orgId: "ORG_X",
    role: "SOLFACIL_ADMIN",
  }),
): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: `GET ${path}`,
    rawPath: path,
    rawQueryString: "",
    headers: { authorization: authHeader },
    requestContext: {
      accountId: "a",
      apiId: "b",
      domainName: "c",
      domainPrefix: "d",
      http: {
        method: "GET",
        path,
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "jest",
      },
      requestId: "r",
      routeKey: `GET ${path}`,
      stage: "$default",
      time: new Date().toISOString(),
      timeEpoch: Date.now(),
    },
    isBase64Encoded: false,
  };
}

function parse(res: Awaited<ReturnType<typeof listHandler>>) {
  const r = res as { statusCode: number; body: string };
  return { statusCode: r.statusCode, body: JSON.parse(r.body) };
}

const issueFixture: RuntimeIssue = {
  fingerprint: "fp-abc",
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
  latest_detail: { attempt: 3 },
  operator_note: null,
  operator_actor: null,
  updated_at: "2026-04-18T09:00:00.000Z",
};

beforeEach(() => {
  jest.clearAllMocks();
  mockRunWithServicePool.mockImplementation(
    async (fn: (c: unknown) => Promise<unknown>) => fn({}),
  );
});

describe("GET /api/runtime/issues", () => {
  it("rejects non-admin with 403", async () => {
    mockParseRuntimeFlags.mockReturnValue({
      governanceEnabled: true,
      slices: {},
    });
    const res = parse(
      await listHandler(
        event(
          "/api/runtime/issues",
          JSON.stringify({
            userId: "u2",
            orgId: "ORG_X",
            role: "ORG_VIEWER",
          }),
        ),
      ),
    );
    expect(res.statusCode).toBe(403);
  });

  it("returns empty list with disabled posture when feature flag off", async () => {
    mockParseRuntimeFlags.mockReturnValue({
      governanceEnabled: false,
      slices: {},
    });
    const res = parse(await listHandler(event("/api/runtime/issues")));
    expect(res.statusCode).toBe(200);
    expect(res.body.data.overall).toBe("disabled");
    expect(res.body.data.issues).toEqual([]);
    expect(mockFetchActiveRuntimeIssues).not.toHaveBeenCalled();
  });

  it("returns list of active/recovered issues when feature on", async () => {
    mockParseRuntimeFlags.mockReturnValue({
      governanceEnabled: true,
      slices: {},
    });
    mockFetchActiveRuntimeIssues.mockResolvedValue([issueFixture]);

    const res = parse(await listHandler(event("/api/runtime/issues")));
    expect(res.statusCode).toBe(200);
    expect(res.body.data.overall).not.toBe("disabled");
    expect(res.body.data.issues).toHaveLength(1);
    expect(res.body.data.issues[0].fingerprint).toBe("fp-abc");
    expect(res.body.data.issues[0].state).toBe("ongoing");
  });
});

describe("GET /api/runtime/issues/:fingerprint", () => {
  const path = "/api/runtime/issues/fp-abc";

  it("rejects non-admin with 403", async () => {
    mockParseRuntimeFlags.mockReturnValue({
      governanceEnabled: true,
      slices: {},
    });
    const res = parse(
      await detailHandler(
        event(
          path,
          JSON.stringify({
            userId: "u2",
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
    const res = parse(await detailHandler(event(path)));
    expect(res.statusCode).toBe(200);
    expect(res.body.data.overall).toBe("disabled");
    expect(res.body.data.issue).toBeNull();
    expect(res.body.data.events).toEqual([]);
    expect(mockFetchRuntimeIssueByFingerprint).not.toHaveBeenCalled();
  });

  it("returns 404 when issue not found", async () => {
    mockParseRuntimeFlags.mockReturnValue({
      governanceEnabled: true,
      slices: {},
    });
    mockFetchRuntimeIssueByFingerprint.mockResolvedValue(null);
    const res = parse(await detailHandler(event(path)));
    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it("returns issue + recent events tail when found", async () => {
    mockParseRuntimeFlags.mockReturnValue({
      governanceEnabled: true,
      slices: {},
    });
    mockFetchRuntimeIssueByFingerprint.mockResolvedValue(issueFixture);
    const evt: RuntimeEvent = {
      event_id: "evt-1",
      event_code: "db.critical_query.failed",
      source: "db",
      severity: "critical",
      lifecycle_hint: "detect",
      occurred_at: "2026-04-18T09:00:00.000Z",
      observed_at: "2026-04-18T09:00:00.000Z",
      fingerprint: "fp-abc",
      correlation_id: null,
      tenant_scope: null,
      summary: "boom",
      detail: null,
    };
    mockFetchRecentRuntimeEventsByFingerprint.mockResolvedValue([evt]);

    const res = parse(await detailHandler(event(path)));
    expect(res.statusCode).toBe(200);
    expect(res.body.data.issue.fingerprint).toBe("fp-abc");
    expect(res.body.data.events).toHaveLength(1);
    expect(res.body.data.events[0].event_id).toBe("evt-1");
    expect(mockFetchRecentRuntimeEventsByFingerprint).toHaveBeenCalledWith(
      expect.anything(),
      "fp-abc",
      expect.any(Number),
    );
  });
});
