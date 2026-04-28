// ---------------------------------------------------------------------------
// P5 DB helpers — persistence contract tests
// ---------------------------------------------------------------------------

const mockQueryWithOrg = jest.fn();

jest.mock("../../src/shared/db", () => ({
  queryWithOrg: (...args: unknown[]) => mockQueryWithOrg(...args),
}));

import { upsertIntent } from "../../src/shared/p5-db";

const ORG_ID = "ORG_ENERGIA_001";

function makeIntent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    org_id: ORG_ID,
    family: "reserve_protection",
    status: "active",
    governance_mode: "auto_governed",
    urgency: "immediate",
    title: "Low reserve warning — SoC 0%",
    reason_summary: "Average SoC is below threshold.",
    evidence_snapshot: { average_soc: 0 },
    scope_gateway_ids: ["WKRD24070202100212P"],
    scope_summary: "Gateways: WKRD24070202100212P",
    constraints: null,
    suggested_playbook: "Force charge batteries.",
    handoff_snapshot: null,
    arbitration_note: null,
    actor: "platform",
    decided_at: null,
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    defer_until: null,
    deferred_by: null,
    ...overrides,
  };
}

describe("p5-db upsertIntent", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQueryWithOrg.mockResolvedValue({
      rows: [{ id: 42, ...makeIntent(), created_at: "now", updated_at: "now" }],
    });
  });

  it("uses business-key update-or-insert semantics instead of impossible ON CONFLICT(id)", async () => {
    await upsertIntent(ORG_ID, makeIntent() as never);

    expect(mockQueryWithOrg).toHaveBeenCalledTimes(1);
    const [sql, params, orgId] = mockQueryWithOrg.mock.calls[0];

    expect(orgId).toBe(ORG_ID);
    expect(params[0]).toBe(ORG_ID);
    expect(params[1]).toBe("reserve_protection");
    expect(params[8]).toBe(JSON.stringify(["WKRD24070202100212P"]));

    expect(sql).toContain("WITH existing AS");
    expect(sql).toContain("UPDATE strategy_intents");
    expect(sql).toContain("WHERE NOT EXISTS (SELECT 1 FROM updated)");
    expect(sql).toContain("scope_gateway_ids = $9::jsonb");
    expect(sql).not.toContain("ON CONFLICT (id)");
  });
});
