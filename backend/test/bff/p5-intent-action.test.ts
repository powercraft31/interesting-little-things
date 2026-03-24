// ---------------------------------------------------------------------------
// Tests: POST /api/p5/intents/:intentId/:action
// ---------------------------------------------------------------------------

import type { APIGatewayProxyEventV2 } from "aws-lambda";

// ── Mocks ───────────────────────────────────────────────────────────────

const mockGetIntentById = jest.fn();
const mockUpdateIntentStatus = jest.fn();

jest.mock("../../src/shared/p5-db", () => ({
  getIntentById: mockGetIntentById,
  updateIntentStatus: mockUpdateIntentStatus,
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

import { handler } from "../../src/bff/handlers/post-p5-intent-action";
import type { StrategyIntent } from "../../src/shared/types/p5";

function parse(result: Awaited<ReturnType<typeof handler>>) {
  const r = result as { statusCode: number; body: string };
  return { statusCode: r.statusCode, body: JSON.parse(r.body) };
}

function makeEvent(
  intentId: number,
  action: string,
  body?: Record<string, unknown>,
): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: `POST /api/p5/intents/${intentId}/${action}`,
    rawPath: `/api/p5/intents/${intentId}/${action}`,
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
        path: `/api/p5/intents/${intentId}/${action}`,
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "test",
      },
      requestId: "test",
      routeKey: `POST /api/p5/intents/${intentId}/${action}`,
      stage: "$default",
      time: new Date().toISOString(),
      timeEpoch: Date.now(),
    },
    isBase64Encoded: false,
  };
}

function makeIntent(overrides: Partial<StrategyIntent> = {}): StrategyIntent {
  return {
    id: 1,
    org_id: "org-1",
    family: "peak_shaving",
    status: "active",
    governance_mode: "approval_required",
    urgency: "soon",
    title: "Peak demand risk",
    reason_summary: "Grid import at 85%",
    evidence_snapshot: {},
    scope_gateway_ids: ["gw-1"],
    scope_summary: "Gateways: gw-1",
    constraints: null,
    suggested_playbook: "Discharge batteries",
    handoff_snapshot: null,
    arbitration_note: null,
    actor: "platform",
    decided_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    expires_at: null,
    defer_until: null,
    deferred_by: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("POST /api/p5/intents/:intentId/:action", () => {
  it("approves a valid intent", async () => {
    const intent = makeIntent();
    mockGetIntentById.mockResolvedValue(intent);
    mockUpdateIntentStatus.mockResolvedValue({
      ...intent,
      status: "approved",
      actor: "operator:user-1",
    });

    const { statusCode, body } = parse(await handler(makeEvent(1, "approve")));
    expect(statusCode).toBe(200);
    expect(body.data.intent.status).toBe("approved");
    expect(mockUpdateIntentStatus).toHaveBeenCalledWith(
      "org-1",
      1,
      "approved",
      "operator:user-1",
      undefined,
      undefined, // defer_until
      undefined, // deferred_by
    );
  });

  it("rejects suppress without reason", async () => {
    const intent = makeIntent();
    mockGetIntentById.mockResolvedValue(intent);

    const { statusCode, body } = parse(await handler(makeEvent(1, "suppress")));
    expect(statusCode).toBe(400);
    expect(body.error).toContain("Reason is required");
  });

  it("rejects action on terminal intent", async () => {
    const intent = makeIntent({ status: "approved" });
    mockGetIntentById.mockResolvedValue(intent);

    const { statusCode, body } = parse(await handler(makeEvent(1, "approve")));
    expect(statusCode).toBe(400);
    expect(body.error).toContain("not allowed");
  });

  it("escalate builds correct status", async () => {
    const intent = makeIntent({
      governance_mode: "approval_required",
      status: "active",
    });
    mockGetIntentById.mockResolvedValue(intent);
    mockUpdateIntentStatus.mockResolvedValue({
      ...intent,
      status: "escalated",
      actor: "operator:user-1",
    });

    const { statusCode, body } = parse(
      await handler(
        makeEvent(1, "escalate", { reason: "Need manager review" }),
      ),
    );
    expect(statusCode).toBe(200);
    expect(body.data.intent.status).toBe("escalated");
    expect(mockUpdateIntentStatus).toHaveBeenCalledWith(
      "org-1",
      1,
      "escalated",
      "operator:user-1",
      "Need manager review",
      undefined, // defer_until
      undefined, // deferred_by
    );
  });

  it("returns 404 for unknown intent", async () => {
    mockGetIntentById.mockResolvedValue(null);

    const { statusCode } = parse(await handler(makeEvent(999, "approve")));
    expect(statusCode).toBe(404);
  });

  // ── Deferred intent resume tests ────────────────────────────────────

  it("resumes a deferred intent via escalate", async () => {
    const intent = makeIntent({
      status: "deferred",
      governance_mode: "escalate",
    });
    mockGetIntentById.mockResolvedValue(intent);
    mockUpdateIntentStatus.mockResolvedValue({
      ...intent,
      status: "escalated",
      actor: "operator:user-1",
    });

    const { statusCode, body } = parse(
      await handler(makeEvent(1, "escalate", { reason: "Retomar agora" })),
    );
    expect(statusCode).toBe(200);
    expect(body.data.intent.status).toBe("escalated");
  });

  it("rejects approve on a deferred intent", async () => {
    const intent = makeIntent({
      status: "deferred",
      governance_mode: "escalate",
    });
    mockGetIntentById.mockResolvedValue(intent);

    const { statusCode } = parse(await handler(makeEvent(1, "approve")));
    expect(statusCode).toBe(400);
  });

  it("rejects re-defer on a deferred intent", async () => {
    const intent = makeIntent({
      status: "deferred",
      governance_mode: "escalate",
    });
    mockGetIntentById.mockResolvedValue(intent);

    const { statusCode } = parse(
      await handler(
        makeEvent(1, "defer", {
          reason: "test",
          defer_until: new Date(Date.now() + 3600000).toISOString(),
        }),
      ),
    );
    expect(statusCode).toBe(400);
  });
});
