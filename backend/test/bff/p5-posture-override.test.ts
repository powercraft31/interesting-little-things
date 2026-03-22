// ---------------------------------------------------------------------------
// Tests: POST /api/p5/posture-override
// ---------------------------------------------------------------------------

import type { APIGatewayProxyEventV2 } from "aws-lambda";

// ── Mocks ───────────────────────────────────────────────────────────────

const mockCreatePostureOverride = jest.fn();
const mockCancelOverride = jest.fn();

jest.mock("../../src/shared/p5-db", () => ({
  createPostureOverride: mockCreatePostureOverride,
  cancelOverride: mockCancelOverride,
}));

jest.mock("../../src/bff/middleware/auth", () => ({
  extractTenantContext: () => ({
    userId: "user-1",
    orgId: "org-1",
    role: "ORG_OPERATOR",
  }),
  requireRole: jest.fn(),
  apiError: (code: number, msg: string) => ({
    statusCode: code,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ success: false, data: null, error: msg }),
  }),
}));

import { handler } from "../../src/bff/handlers/post-p5-posture-override";

function parse(result: Awaited<ReturnType<typeof handler>>) {
  const r = result as { statusCode: number; body: string };
  return { statusCode: r.statusCode, body: JSON.parse(r.body) };
}

function makeEvent(
  path: string,
  body?: Record<string, unknown>,
): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: `POST ${path}`,
    rawPath: path,
    rawQueryString: "",
    headers: { authorization: "test" },
    body: body ? JSON.stringify(body) : undefined,
    requestContext: {
      accountId: "test",
      apiId: "test",
      domainName: "test",
      domainPrefix: "test",
      http: {
        method: "POST",
        path,
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "test",
      },
      requestId: "test",
      routeKey: `POST ${path}`,
      stage: "$default",
      time: new Date().toISOString(),
      timeEpoch: Date.now(),
    },
    isBase64Encoded: false,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("POST /api/p5/posture-override (create)", () => {
  it("creates a valid override", async () => {
    const fakeOverride = {
      id: 1,
      org_id: "org-1",
      override_type: "force_protective",
      reason: "Maintenance window",
      scope_gateway_ids: [],
      actor: "operator:user-1",
      active: true,
      starts_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      cancelled_at: null,
      cancelled_by: null,
      created_at: new Date().toISOString(),
    };
    mockCreatePostureOverride.mockResolvedValue(fakeOverride);

    const result = await handler(
      makeEvent("/api/p5/posture-override", {
        override_type: "force_protective",
        reason: "Maintenance window",
        duration_minutes: 60,
      }),
    );

    const { statusCode, body } = parse(result);
    expect(statusCode).toBe(200);
    expect(body.data.success).toBe(true);
    expect(body.data.override.override_type).toBe("force_protective");
  });

  it("rejects invalid override_type", async () => {
    const { statusCode, body } = parse(
      await handler(
        makeEvent("/api/p5/posture-override", {
          override_type: "invalid_type",
          reason: "Test",
          duration_minutes: 60,
        }),
      ),
    );

    expect(statusCode).toBe(400);
    expect(body.error).toContain("override_type must be one of");
  });

  it("rejects duration > 480 minutes", async () => {
    const { statusCode, body } = parse(
      await handler(
        makeEvent("/api/p5/posture-override", {
          override_type: "force_protective",
          reason: "Test",
          duration_minutes: 600,
        }),
      ),
    );

    expect(statusCode).toBe(400);
    expect(body.error).toContain("duration_minutes");
  });
});

describe("POST /api/p5/posture-override/:id/cancel", () => {
  it("cancels an active override", async () => {
    const fakeOverride = {
      id: 1,
      org_id: "org-1",
      override_type: "force_protective",
      reason: "Maintenance window",
      scope_gateway_ids: [],
      actor: "operator:user-1",
      active: false,
      starts_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      cancelled_at: new Date().toISOString(),
      cancelled_by: "operator:user-1",
      created_at: new Date().toISOString(),
    };
    mockCancelOverride.mockResolvedValue(fakeOverride);

    const { statusCode, body } = parse(
      await handler(
        makeEvent("/api/p5/posture-override/1/cancel", { reason: "Done" }),
      ),
    );

    expect(statusCode).toBe(200);
    expect(body.data.success).toBe(true);
    expect(body.data.override.active).toBe(false);
  });

  it("returns 404 for non-existent override", async () => {
    mockCancelOverride.mockResolvedValue(null);

    const { statusCode } = parse(
      await handler(makeEvent("/api/p5/posture-override/999/cancel")),
    );

    expect(statusCode).toBe(404);
  });
});
