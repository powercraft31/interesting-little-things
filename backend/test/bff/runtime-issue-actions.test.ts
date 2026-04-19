// ---------------------------------------------------------------------------
// Tests: POST /api/runtime/issues/:fingerprint/{close,suppress,note}
// WS3 — v6.10 runtime governance operator actions
// ---------------------------------------------------------------------------
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import type { RuntimeIssue } from "../../src/shared/types/runtime";

const mockParseRuntimeFlags = jest.fn();
const mockExecuteOperatorClose = jest.fn();
const mockExecuteOperatorSuppress = jest.fn();
const mockExecuteOperatorNote = jest.fn();

jest.mock("../../src/shared/runtime/flags", () => {
  const actual = jest.requireActual("../../src/shared/runtime/flags");
  return {
    ...actual,
    parseRuntimeFlags: (env: NodeJS.ProcessEnv) => mockParseRuntimeFlags(env),
  };
});

jest.mock("../../src/shared/runtime/operator-actions", () => ({
  executeOperatorClose: (fp: string, input: unknown) =>
    mockExecuteOperatorClose(fp, input),
  executeOperatorSuppress: (fp: string, input: unknown) =>
    mockExecuteOperatorSuppress(fp, input),
  executeOperatorNote: (fp: string, input: unknown) =>
    mockExecuteOperatorNote(fp, input),
}));

import { handler as closeHandler } from "../../src/bff/handlers/post-runtime-issue-close";
import { handler as suppressHandler } from "../../src/bff/handlers/post-runtime-issue-suppress";
import { handler as noteHandler } from "../../src/bff/handlers/post-runtime-issue-note";

function makeEvent(
  path: string,
  body: Record<string, unknown> | null,
  authHeader = JSON.stringify({
    userId: "u1",
    orgId: "ORG_X",
    role: "SOLFACIL_ADMIN",
  }),
): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: `POST ${path}`,
    rawPath: path,
    rawQueryString: "",
    headers: {
      authorization: authHeader,
      "content-type": "application/json",
    },
    body: body === null ? undefined : JSON.stringify(body),
    requestContext: {
      accountId: "a",
      apiId: "b",
      domainName: "c",
      domainPrefix: "d",
      http: {
        method: "POST",
        path,
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "jest",
      },
      requestId: "r",
      routeKey: `POST ${path}`,
      stage: "$default",
      time: new Date().toISOString(),
      timeEpoch: Date.now(),
    },
    isBase64Encoded: false,
  };
}

function parse(res: Awaited<ReturnType<typeof closeHandler>>) {
  const r = res as { statusCode: number; body: string };
  return { statusCode: r.statusCode, body: JSON.parse(r.body) };
}

const closedIssue: RuntimeIssue = {
  fingerprint: "fp-abc",
  event_code: "db.critical_query.failed",
  source: "db",
  tenant_scope: null,
  cycle_count: 1,
  current_cycle_started_at: "2026-04-18T08:59:00.000Z",
  first_detected_at: "2026-04-18T08:59:00.000Z",
  last_observed_at: "2026-04-18T09:00:00.000Z",
  recovered_at: null,
  closed_at: "2026-04-18T09:10:00.000Z",
  suppressed_until: null,
  state: "closed",
  current_severity: "critical",
  observation_count: 2,
  summary: "boom",
  latest_detail: null,
  operator_note: "manual close",
  operator_actor: "operator:u1",
  updated_at: "2026-04-18T09:10:00.000Z",
};

beforeEach(() => {
  jest.clearAllMocks();
  mockParseRuntimeFlags.mockReturnValue({
    governanceEnabled: true,
    slices: {},
  });
});

describe("POST /api/runtime/issues/:fingerprint/close", () => {
  const path = "/api/runtime/issues/fp-abc/close";

  it("rejects non-admin with 403", async () => {
    const res = parse(
      await closeHandler(
        makeEvent(
          path,
          { note: "x" },
          JSON.stringify({
            userId: "u2",
            orgId: "ORG_X",
            role: "ORG_OPERATOR",
          }),
        ),
      ),
    );
    expect(res.statusCode).toBe(403);
    expect(mockExecuteOperatorClose).not.toHaveBeenCalled();
  });

  it("returns 503 disabled when feature flag off", async () => {
    mockParseRuntimeFlags.mockReturnValue({
      governanceEnabled: false,
      slices: {},
    });
    const res = parse(await closeHandler(makeEvent(path, { note: "x" })));
    expect(res.statusCode).toBe(503);
    expect(res.body.success).toBe(false);
    expect(mockExecuteOperatorClose).not.toHaveBeenCalled();
  });

  it("closes an existing issue through the shared-layer mutation helper", async () => {
    mockExecuteOperatorClose.mockResolvedValue({
      status: "applied",
      issue: closedIssue,
    });
    const res = parse(
      await closeHandler(makeEvent(path, { note: "manual close" })),
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.issue.state).toBe("closed");
    expect(mockExecuteOperatorClose).toHaveBeenCalledWith(
      "fp-abc",
      expect.objectContaining({
        actor: "operator:u1",
        note: "manual close",
      }),
    );
  });

  it("returns 404 when fingerprint is unknown", async () => {
    mockExecuteOperatorClose.mockResolvedValue({ status: "not_found" });
    const res = parse(await closeHandler(makeEvent(path, {})));
    expect(res.statusCode).toBe(404);
  });
});

describe("POST /api/runtime/issues/:fingerprint/suppress", () => {
  const path = "/api/runtime/issues/fp-abc/suppress";

  it("rejects non-admin with 403", async () => {
    const res = parse(
      await suppressHandler(
        makeEvent(
          path,
          { until: "2099-01-01T00:00:00.000Z" },
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

  it("rejects missing 'until' with 400", async () => {
    const res = parse(await suppressHandler(makeEvent(path, {})));
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/until/i);
    expect(mockExecuteOperatorSuppress).not.toHaveBeenCalled();
  });

  it("rejects invalid/past 'until' with 400", async () => {
    const res = parse(
      await suppressHandler(
        makeEvent(path, { until: "1999-01-01T00:00:00.000Z" }),
      ),
    );
    expect(res.statusCode).toBe(400);
  });

  it("suppresses through shared-layer mutation helper", async () => {
    mockExecuteOperatorSuppress.mockResolvedValue({
      status: "applied",
      issue: { ...closedIssue, state: "suppressed" },
    });
    const until = new Date(Date.now() + 3600_000).toISOString();
    const res = parse(
      await suppressHandler(
        makeEvent(path, { until, note: "noisy parser" }),
      ),
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.data.issue.state).toBe("suppressed");
    expect(mockExecuteOperatorSuppress).toHaveBeenCalledWith(
      "fp-abc",
      expect.objectContaining({
        actor: "operator:u1",
        until,
        note: "noisy parser",
      }),
    );
  });

  it("returns 404 when fingerprint is unknown", async () => {
    mockExecuteOperatorSuppress.mockResolvedValue({ status: "not_found" });
    const until = new Date(Date.now() + 3600_000).toISOString();
    const res = parse(
      await suppressHandler(makeEvent(path, { until })),
    );
    expect(res.statusCode).toBe(404);
  });
});

describe("POST /api/runtime/issues/:fingerprint/note", () => {
  const path = "/api/runtime/issues/fp-abc/note";

  it("rejects non-admin with 403", async () => {
    const res = parse(
      await noteHandler(
        makeEvent(
          path,
          { note: "hi" },
          JSON.stringify({
            userId: "u2",
            orgId: "ORG_X",
            role: "ORG_OPERATOR",
          }),
        ),
      ),
    );
    expect(res.statusCode).toBe(403);
  });

  it("rejects missing or empty note with 400", async () => {
    const res1 = parse(await noteHandler(makeEvent(path, {})));
    expect(res1.statusCode).toBe(400);

    const res2 = parse(await noteHandler(makeEvent(path, { note: "" })));
    expect(res2.statusCode).toBe(400);
    expect(mockExecuteOperatorNote).not.toHaveBeenCalled();
  });

  it("writes the note via shared-layer mutation helper", async () => {
    mockExecuteOperatorNote.mockResolvedValue({
      status: "applied",
      issue: { ...closedIssue, operator_note: "investigating" },
    });
    const res = parse(
      await noteHandler(makeEvent(path, { note: "investigating" })),
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.data.issue.operator_note).toBe("investigating");
    expect(mockExecuteOperatorNote).toHaveBeenCalledWith(
      "fp-abc",
      expect.objectContaining({
        actor: "operator:u1",
        note: "investigating",
      }),
    );
  });

  it("returns 404 when fingerprint is unknown", async () => {
    mockExecuteOperatorNote.mockResolvedValue({ status: "not_found" });
    const res = parse(await noteHandler(makeEvent(path, { note: "x" })));
    expect(res.statusCode).toBe(404);
  });
});
