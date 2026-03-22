// ---------------------------------------------------------------------------
// P5 Posture Resolver — Unit Tests
// ---------------------------------------------------------------------------

import type {
  StrategyIntent,
  PostureOverride,
} from "../../src/shared/types/p5";

// ── Mock p5-db ───────────────────────────────────────────────────────────

const mockGetActiveOverrides = jest.fn();

jest.mock("../../src/shared/p5-db", () => ({
  getActiveOverrides: (...args: unknown[]) => mockGetActiveOverrides(...args),
}));

import { resolvePosture } from "../../src/optimization-engine/services/posture-resolver";

// ── Helpers ──────────────────────────────────────────────────────────────

const ORG_ID = "org-test-01";

function makeIntent(overrides: Partial<StrategyIntent> = {}): StrategyIntent {
  return {
    id: 1,
    org_id: ORG_ID,
    family: "peak_shaving",
    status: "active",
    governance_mode: "approval_required",
    urgency: "soon",
    title: "Peak demand risk",
    reason_summary: "Grid at 85% of contracted demand",
    evidence_snapshot: {},
    scope_gateway_ids: ["GW-001"],
    scope_summary: "Gateways: GW-001",
    constraints: null,
    suggested_playbook: "Discharge batteries",
    handoff_snapshot: null,
    arbitration_note: null,
    actor: "platform",
    decided_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    expires_at: null,
    ...overrides,
  };
}

function makeOverride(overrides: Partial<PostureOverride> = {}): PostureOverride {
  return {
    id: 1,
    org_id: ORG_ID,
    override_type: "force_protective",
    reason: "Maintenance window",
    scope_gateway_ids: [],
    actor: "operator:admin",
    active: true,
    starts_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 3600000).toISOString(),
    cancelled_at: null,
    cancelled_by: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("posture-resolver", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // 1. No overrides → unchanged
  it("returns intents unchanged when no active overrides", async () => {
    mockGetActiveOverrides.mockResolvedValue([]);

    const intents = [
      makeIntent({ family: "peak_shaving" }),
      makeIntent({ id: 2, family: "reserve_protection", governance_mode: "auto_governed" }),
    ];

    const result = await resolvePosture(ORG_ID, intents);
    expect(result).toEqual(intents);
  });

  // 2. force_protective → economic intents get observe, protective untouched
  it("force_protective sets non-protective intents to observe", async () => {
    mockGetActiveOverrides.mockResolvedValue([
      makeOverride({ override_type: "force_protective" }),
    ]);

    const intents = [
      makeIntent({ id: 1, family: "peak_shaving", governance_mode: "approval_required" }),
      makeIntent({ id: 2, family: "tariff_arbitrage", governance_mode: "approval_required" }),
      makeIntent({ id: 3, family: "reserve_protection", governance_mode: "auto_governed" }),
    ];

    const result = await resolvePosture(ORG_ID, intents);

    // Economic intents → observe
    expect(result[0].governance_mode).toBe("observe");
    expect(result[0].arbitration_note).toContain("force_protective");
    expect(result[1].governance_mode).toBe("observe");

    // Protective intent → unchanged
    expect(result[2].governance_mode).toBe("auto_governed");
    expect(result[2].arbitration_note).toBeNull();
  });

  // 3. suppress_economic → peak_shaving + tariff_arbitrage suppressed
  it("suppress_economic suppresses economic intents", async () => {
    mockGetActiveOverrides.mockResolvedValue([
      makeOverride({ override_type: "suppress_economic" }),
    ]);

    const intents = [
      makeIntent({ id: 1, family: "peak_shaving" }),
      makeIntent({ id: 2, family: "tariff_arbitrage" }),
      makeIntent({ id: 3, family: "reserve_protection", governance_mode: "auto_governed" }),
    ];

    const result = await resolvePosture(ORG_ID, intents);

    expect(result[0].status).toBe("suppressed");
    expect(result[0].arbitration_note).toContain("suppress_economic");
    expect(result[1].status).toBe("suppressed");

    // Protective untouched
    expect(result[2].status).toBe("active");
  });

  // 4. force_approval_gate → auto_governed downgraded
  it("force_approval_gate downgrades auto_governed to approval_required", async () => {
    mockGetActiveOverrides.mockResolvedValue([
      makeOverride({ override_type: "force_approval_gate" }),
    ]);

    const intents = [
      makeIntent({ id: 1, family: "reserve_protection", governance_mode: "auto_governed" }),
      makeIntent({ id: 2, family: "peak_shaving", governance_mode: "approval_required" }),
    ];

    const result = await resolvePosture(ORG_ID, intents);

    // auto_governed → approval_required
    expect(result[0].governance_mode).toBe("approval_required");
    expect(result[0].arbitration_note).toContain("force_approval_gate");

    // Already approval_required → unchanged
    expect(result[1].governance_mode).toBe("approval_required");
    expect(result[1].arbitration_note).toBeNull();
  });

  // 5. Scoped override → only affects matching gateways
  it("scoped override only affects intents with matching gateway scope", async () => {
    mockGetActiveOverrides.mockResolvedValue([
      makeOverride({
        override_type: "suppress_economic",
        scope_gateway_ids: ["GW-002"], // only GW-002
      }),
    ]);

    const intents = [
      makeIntent({ id: 1, family: "peak_shaving", scope_gateway_ids: ["GW-001"] }),
      makeIntent({ id: 2, family: "peak_shaving", scope_gateway_ids: ["GW-002"] }),
      makeIntent({ id: 3, family: "tariff_arbitrage", scope_gateway_ids: ["GW-001", "GW-002"] }),
    ];

    const result = await resolvePosture(ORG_ID, intents);

    // GW-001 only → not affected
    expect(result[0].status).toBe("active");

    // GW-002 → suppressed
    expect(result[1].status).toBe("suppressed");

    // GW-001 + GW-002 overlap → suppressed
    expect(result[2].status).toBe("suppressed");
  });

  // Extra: manual_escalation_note adds context without changing mode
  it("manual_escalation_note adds note without changing governance", async () => {
    mockGetActiveOverrides.mockResolvedValue([
      makeOverride({
        override_type: "manual_escalation_note",
        reason: "Operator requested review before dispatch",
      }),
    ]);

    const intents = [
      makeIntent({ family: "reserve_protection", governance_mode: "auto_governed" }),
    ];

    const result = await resolvePosture(ORG_ID, intents);

    expect(result[0].governance_mode).toBe("auto_governed");
    expect(result[0].status).toBe("active");
    expect(result[0].arbitration_note).toContain("Operator requested review");
  });
});
