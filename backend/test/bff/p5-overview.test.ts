// ---------------------------------------------------------------------------
// Tests: GET /api/p5/overview
// ---------------------------------------------------------------------------

import type { APIGatewayProxyEventV2 } from "aws-lambda";

// ── Mocks (must be before imports) ──────────────────────────────────────

const mockEvaluateStrategies = jest.fn();
const mockResolvePosture = jest.fn();
const mockGetActiveOverrides = jest.fn();
const mockQueryWithOrg = jest.fn();

jest.mock("../../src/optimization-engine/services/strategy-evaluator", () => ({
  evaluateStrategies: mockEvaluateStrategies,
}));

jest.mock("../../src/optimization-engine/services/posture-resolver", () => ({
  resolvePosture: mockResolvePosture,
}));

jest.mock("../../src/shared/p5-db", () => ({
  getActiveOverrides: mockGetActiveOverrides,
  getActiveIntents: jest.fn().mockResolvedValue([]),
}));

jest.mock("../../src/shared/db", () => ({
  queryWithOrg: mockQueryWithOrg,
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

import { handler } from "../../src/bff/handlers/get-p5-overview";
import type {
  StrategyIntent,
  PostureOverride,
} from "../../src/shared/types/p5";

// APIGatewayProxyResultV2 is string | { statusCode, body, ... }
// Our handlers always return the object form.
function parse(result: Awaited<ReturnType<typeof handler>>) {
  const r = result as { statusCode: number; body: string };
  return { statusCode: r.statusCode, body: JSON.parse(r.body) };
}

function makeEvent(): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: "GET /api/p5/overview",
    rawPath: "/api/p5/overview",
    rawQueryString: "",
    headers: { authorization: "test" },
    requestContext: {
      accountId: "test",
      apiId: "test",
      domainName: "test",
      domainPrefix: "test",
      http: {
        method: "GET",
        path: "/api/p5/overview",
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "test",
      },
      requestId: "test",
      routeKey: "GET /api/p5/overview",
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
    expires_at: new Date(Date.now() + 7200000).toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockQueryWithOrg.mockResolvedValue({ rows: [] });
  mockGetActiveOverrides.mockResolvedValue([]);
});

describe("GET /api/p5/overview", () => {
  it("returns calm posture when no intents exist", async () => {
    mockEvaluateStrategies.mockResolvedValue([]);
    mockResolvePosture.mockResolvedValue([]);

    const { statusCode, body } = parse(await handler(makeEvent()));
    expect(statusCode).toBe(200);
    expect(body.data.hero.posture).toBe("calm");
    expect(body.data.hero.dominant_driver).toBe("No active conditions");
    expect(body.data.hero.operator_action_needed).toBe(false);
    expect(body.data.calm_explanation).not.toBeNull();
    expect(body.data.calm_explanation.reason).toBe("no_conditions_detected");
    expect(body.data.need_decision_now).toHaveLength(0);
    expect(body.data.platform_acting).toHaveLength(0);
  });

  it("returns approval_gated posture for peak shaving intent", async () => {
    const intent = makeIntent({
      governance_mode: "approval_required",
      status: "active",
    });
    mockEvaluateStrategies.mockResolvedValue([intent]);
    mockResolvePosture.mockResolvedValue([intent]);

    const { body } = parse(await handler(makeEvent()));
    expect(body.data.hero.posture).toBe("approval_gated");
    expect(body.data.hero.operator_action_needed).toBe(true);
    expect(body.data.need_decision_now).toHaveLength(1);
    expect(body.data.calm_explanation).toBeNull();
  });

  it("returns protective posture for auto_governed intent", async () => {
    const intent = makeIntent({
      family: "reserve_protection",
      governance_mode: "auto_governed",
      urgency: "immediate",
      title: "Low reserve warning",
    });
    mockEvaluateStrategies.mockResolvedValue([intent]);
    mockResolvePosture.mockResolvedValue([intent]);

    const { body } = parse(await handler(makeEvent()));
    expect(body.data.hero.posture).toBe("protective");
    expect(body.data.platform_acting).toHaveLength(1);
    expect(body.data.platform_acting[0].family).toBe("reserve_protection");
  });

  it("returns escalation posture for escalated intent", async () => {
    const intent = makeIntent({
      governance_mode: "escalate",
      status: "active",
      title: "Scope collision detected",
    });
    mockEvaluateStrategies.mockResolvedValue([intent]);
    mockResolvePosture.mockResolvedValue([intent]);

    const { body } = parse(await handler(makeEvent()));
    expect(body.data.hero.posture).toBe("escalation");
    expect(body.data.hero.conflict_active).toBe(true);
    expect(body.data.hero.operator_action_needed).toBe(true);
  });

  it("reflects active override in hero", async () => {
    mockEvaluateStrategies.mockResolvedValue([]);
    mockResolvePosture.mockResolvedValue([]);
    mockGetActiveOverrides.mockResolvedValue([
      {
        id: 1,
        org_id: "org-1",
        override_type: "force_protective",
        reason: "Maintenance",
        scope_gateway_ids: [],
        actor: "operator:user-1",
        active: true,
        starts_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 3600000).toISOString(),
        cancelled_at: null,
        cancelled_by: null,
        created_at: new Date().toISOString(),
      } as PostureOverride,
    ]);

    const { body } = parse(await handler(makeEvent()));
    expect(body.data.hero.override_active).toBe(true);
    expect(body.data.context.operating_posture.active_overrides).toBe(1);
    expect(body.data.context.operating_posture.dominant_override_type).toBe(
      "force_protective",
    );
    expect(body.data.calm_explanation?.reason).toBe("override_suppressing");
  });

  // ── T1: escalation posture → calm_explanation is null ──────────────────
  it("escalation posture does not produce calm_explanation", async () => {
    const intents = [
      makeIntent({
        id: 10,
        family: "peak_shaving",
        governance_mode: "escalate",
        status: "active",
        title: "Scope collision A",
        scope_gateway_ids: ["gw-1"],
      }),
      makeIntent({
        id: 11,
        family: "tariff_arbitrage",
        governance_mode: "escalate",
        status: "active",
        title: "Scope collision B",
        scope_gateway_ids: ["gw-1"],
      }),
    ];
    mockEvaluateStrategies.mockResolvedValue(intents);
    mockResolvePosture.mockResolvedValue(intents);

    const { body } = parse(await handler(makeEvent()));
    expect(body.data.hero.posture).toBe("escalation");
    expect(body.data.calm_explanation).toBeNull();
    expect(body.data.hero.operator_action_needed).toBe(true);
  });

  // ── T2: escalation posture → governance_summary is meaningful ─────────
  it("escalation posture produces meaningful governance_summary", async () => {
    const intents = [
      makeIntent({
        id: 20,
        family: "peak_shaving",
        governance_mode: "escalate",
        status: "active",
        title: "Scope collision A",
        scope_gateway_ids: ["gw-1"],
      }),
      makeIntent({
        id: 21,
        family: "tariff_arbitrage",
        governance_mode: "escalate",
        status: "active",
        title: "Scope collision B",
        scope_gateway_ids: ["gw-1"],
      }),
    ];
    mockEvaluateStrategies.mockResolvedValue(intents);
    mockResolvePosture.mockResolvedValue(intents);

    const { body } = parse(await handler(makeEvent()));
    expect(body.data.hero.governance_summary).toContain(
      "requiring operator arbitration",
    );
    expect(body.data.hero.governance_summary).not.toBe(
      "No active strategy intents",
    );
  });

  // ── T3: escalate+active intents appear in need_decision_now ───────────
  it("escalate active intents appear in need_decision_now lane", async () => {
    const intent = makeIntent({
      id: 30,
      governance_mode: "escalate",
      status: "active",
      title: "Scope collision detected",
      scope_gateway_ids: ["gw-1"],
    });
    mockEvaluateStrategies.mockResolvedValue([intent]);
    mockResolvePosture.mockResolvedValue([intent]);

    const { body } = parse(await handler(makeEvent()));
    expect(body.data.need_decision_now.length).toBeGreaterThanOrEqual(1);
    expect(body.data.need_decision_now[0].governance_mode).toBe("escalate");
  });

  // ── T4: mixed escalation + approval both in need_decision_now ─────────
  it("mixed escalation and approval intents both in need_decision_now", async () => {
    const intents = [
      makeIntent({
        id: 40,
        family: "peak_shaving",
        governance_mode: "escalate",
        status: "active",
        title: "Scope collision",
        scope_gateway_ids: ["gw-1"],
      }),
      makeIntent({
        id: 41,
        family: "tariff_arbitrage",
        governance_mode: "approval_required",
        status: "active",
        title: "Tariff arbitrage opportunity",
        scope_gateway_ids: ["gw-2"],
      }),
    ];
    mockEvaluateStrategies.mockResolvedValue(intents);
    mockResolvePosture.mockResolvedValue(intents);

    const { body } = parse(await handler(makeEvent()));
    expect(body.data.need_decision_now).toHaveLength(2);
    expect(body.data.hero.posture).toBe("escalation");
    expect(body.data.hero.operator_action_needed).toBe(true);
  });

  // ── T5: dominated deferred intent appears in watch_next ───────────────
  it("dominated economic intent appears in watch_next as deferred", async () => {
    const intents = [
      makeIntent({
        id: 50,
        family: "reserve_protection",
        governance_mode: "auto_governed",
        status: "active",
        urgency: "immediate",
        title: "Low reserve warning",
        scope_gateway_ids: ["gw-1"],
      }),
      makeIntent({
        id: 51,
        family: "peak_shaving",
        governance_mode: "approval_required",
        status: "deferred",
        title: "Peak demand risk",
        arbitration_note:
          "Dominated by reserve_protection (protective > economic). Deferred.",
        scope_gateway_ids: ["gw-1"],
      }),
    ];
    mockEvaluateStrategies.mockResolvedValue(intents);
    mockResolvePosture.mockResolvedValue(intents);

    const { body } = parse(await handler(makeEvent()));
    expect(body.data.platform_acting).toHaveLength(1);
    expect(body.data.watch_next).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ family: "peak_shaving" }),
      ]),
    );
    expect(body.data.need_decision_now).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ family: "peak_shaving" }),
      ]),
    );
    expect(body.data.hero.posture).toBe("protective");
  });

  // ── T6: protective dominance → platform_acting visible ────────────────
  it("auto_governed protective intent appears in platform_acting", async () => {
    const intents = [
      makeIntent({
        id: 60,
        family: "reserve_protection",
        governance_mode: "auto_governed",
        status: "active",
        urgency: "immediate",
        title: "Low reserve warning",
        scope_gateway_ids: ["gw-1"],
      }),
      makeIntent({
        id: 61,
        family: "tariff_arbitrage",
        governance_mode: "approval_required",
        status: "deferred",
        title: "Tariff arbitrage opportunity",
        arbitration_note:
          "Dominated by reserve_protection (protective > economic). Deferred.",
        scope_gateway_ids: ["gw-1"],
      }),
    ];
    mockEvaluateStrategies.mockResolvedValue(intents);
    mockResolvePosture.mockResolvedValue(intents);

    const { body } = parse(await handler(makeEvent()));
    expect(body.data.platform_acting).toHaveLength(1);
    expect(body.data.platform_acting[0].family).toBe("reserve_protection");
    expect(body.data.context.dominant_protector).not.toBeNull();
    expect(body.data.hero.posture).toBe("protective");
    expect(body.data.calm_explanation).toBeNull();
  });

  // ── T7: approval_gated posture → calm_explanation is null ─────────────
  it("approval_gated posture does not produce calm_explanation", async () => {
    const intent = makeIntent({
      id: 70,
      governance_mode: "approval_required",
      status: "active",
      title: "Peak demand risk",
    });
    mockEvaluateStrategies.mockResolvedValue([intent]);
    mockResolvePosture.mockResolvedValue([intent]);

    const { body } = parse(await handler(makeEvent()));
    expect(body.data.hero.posture).toBe("approval_gated");
    expect(body.data.calm_explanation).toBeNull();
  });

  // ── T8: protective posture → calm_explanation is null ─────────────────
  it("protective posture does not produce calm_explanation", async () => {
    const intent = makeIntent({
      id: 80,
      family: "reserve_protection",
      governance_mode: "auto_governed",
      status: "active",
      urgency: "immediate",
      title: "Low reserve warning",
    });
    mockEvaluateStrategies.mockResolvedValue([intent]);
    mockResolvePosture.mockResolvedValue([intent]);

    const { body } = parse(await handler(makeEvent()));
    expect(body.data.hero.posture).toBe("protective");
    expect(body.data.calm_explanation).toBeNull();
  });
});
