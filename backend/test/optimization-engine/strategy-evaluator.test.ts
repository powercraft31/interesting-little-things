// ---------------------------------------------------------------------------
// P5 Strategy Evaluator — Unit Tests
// ---------------------------------------------------------------------------
// Mocks DB layer to test evaluation logic in isolation.
// ---------------------------------------------------------------------------

// ── Mock DB modules ──────────────────────────────────────────────────────

const mockPoolQuery = jest.fn();

jest.mock("../../src/shared/db", () => ({
  getServicePool: () => ({ query: mockPoolQuery }),
}));

const mockUpsertIntent = jest.fn();
const mockExpireStaleIntents = jest.fn();
const mockGetActiveIntents = jest.fn();

jest.mock("../../src/shared/p5-db", () => ({
  upsertIntent: (...args: unknown[]) => mockUpsertIntent(...args),
  expireStaleIntents: (...args: unknown[]) => mockExpireStaleIntents(...args),
  getActiveIntents: (...args: unknown[]) => mockGetActiveIntents(...args),
}));

// Import after mocks are set up
import {
  evaluateStrategies,
  _internal,
} from "../../src/optimization-engine/services/strategy-evaluator";

// ── Helpers ──────────────────────────────────────────────────────────────

const ORG_ID = "org-test-01";

function makeGatewayRow(overrides: Record<string, unknown> = {}) {
  return {
    gateway_id: "GW-001",
    contracted_demand_kw: 100,
    ...overrides,
  };
}

function makeAssetRow(overrides: Record<string, unknown> = {}) {
  return {
    asset_id: "ASSET-001",
    battery_soc: 65,
    pv_power: 3.5,
    battery_power: 0,
    grid_power_kw: 10,
    load_power: 12,
    is_online: true,
    telemetry_age_minutes: 2,
    capacidade_kw: 10,
    ...overrides,
  };
}

function makeTariffRow(overrides: Record<string, unknown> = {}) {
  return {
    peak_start: "18:00:00",
    peak_end: "21:00:00",
    peak_rate: 0.85,
    offpeak_rate: 0.35,
    ...overrides,
  };
}

function makeVppStrategyRow(overrides: Record<string, unknown> = {}) {
  return {
    min_soc: 20,
    max_soc: 95,
    target_mode: "arbitrage",
    is_active: true,
    ...overrides,
  };
}

/**
 * Set up mockPoolQuery to return proper results for each sequential call:
 * 1st: gateways query
 * 2nd+: asset queries (one per gateway)
 * N+1: tariff query
 * N+2: vpp_strategies query
 */
function setupPoolMock(opts: {
  gateways?: Record<string, unknown>[];
  assetsByGateway?: Record<string, unknown>[][];
  tariff?: Record<string, unknown> | null;
  vppStrategies?: Record<string, unknown>[];
}) {
  const gateways = opts.gateways ?? [makeGatewayRow()];
  const assetsByGateway = opts.assetsByGateway ?? [[makeAssetRow()]];
  const tariff = opts.tariff === undefined ? makeTariffRow() : opts.tariff;
  const vppStrategies = opts.vppStrategies ?? [makeVppStrategyRow()];

  let callIndex = 0;
  mockPoolQuery.mockImplementation(() => {
    const idx = callIndex++;
    if (idx === 0) {
      // Gateways
      return { rows: gateways };
    }
    if (idx <= gateways.length) {
      // Assets for each gateway
      return { rows: assetsByGateway[idx - 1] ?? [] };
    }
    if (idx === gateways.length + 1) {
      // Tariff
      return { rows: tariff ? [tariff] : [] };
    }
    if (idx === gateways.length + 2) {
      // VPP strategies
      return { rows: vppStrategies };
    }
    return { rows: [] };
  });
}

function setupUpsertMock() {
  let idCounter = 1;
  mockUpsertIntent.mockImplementation(
    (_orgId: string, intent: Record<string, unknown>) => ({
      id: idCounter++,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...intent,
    }),
  );
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("strategy-evaluator", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExpireStaleIntents.mockResolvedValue(0);
    mockGetActiveIntents.mockResolvedValue([]);
    setupUpsertMock();
  });

  // 1. Calm state
  it("returns empty intents when all gateways are healthy and no conditions triggered", async () => {
    setupPoolMock({
      gateways: [makeGatewayRow({ contracted_demand_kw: 100 })],
      assetsByGateway: [
        [makeAssetRow({ battery_soc: 65, grid_power_kw: 30 })], // 30% of 100 → no peak risk
      ],
      tariff: null, // no tariff → no arbitrage
    });

    await evaluateStrategies(ORG_ID);
    // No conditions triggered → no upserts, returns active intents from DB
    expect(mockUpsertIntent).not.toHaveBeenCalled();
    expect(mockExpireStaleIntents).toHaveBeenCalledWith(ORG_ID);
  });

  // 2. Single peak intent
  it("produces peak_shaving intent when grid at 85% of contracted demand", async () => {
    setupPoolMock({
      gateways: [makeGatewayRow({ contracted_demand_kw: 100 })],
      assetsByGateway: [
        [makeAssetRow({ battery_soc: 65, grid_power_kw: 85 })], // 85% → soon
      ],
      tariff: null,
    });

    await evaluateStrategies(ORG_ID);

    expect(mockUpsertIntent).toHaveBeenCalledTimes(1);
    const call = mockUpsertIntent.mock.calls[0];
    expect(call[0]).toBe(ORG_ID);
    expect(call[1]).toMatchObject({
      family: "peak_shaving",
      urgency: "soon",
      governance_mode: "approval_required",
      status: "active",
    });
    expect(call[1].title).toContain("Peak demand risk");
    expect(call[1].suggested_playbook).toContain("Discharge batteries");
  });

  // 3. Reserve protection emergency
  it("produces reserve_protection with auto_governed for SoC < 15%", async () => {
    setupPoolMock({
      gateways: [makeGatewayRow({ contracted_demand_kw: null })],
      assetsByGateway: [
        [makeAssetRow({ battery_soc: 10, grid_power_kw: 5 })], // SoC 10% < 15% emergency
      ],
      tariff: null,
    });

    await evaluateStrategies(ORG_ID);

    expect(mockUpsertIntent).toHaveBeenCalledTimes(1);
    const intent = mockUpsertIntent.mock.calls[0][1];
    expect(intent).toMatchObject({
      family: "reserve_protection",
      urgency: "immediate",
      governance_mode: "auto_governed",
    });
    expect(intent.title).toContain("Low reserve warning");
    expect(intent.suggested_playbook).toContain("Force charge");
  });

  // 4. Tariff opportunity (off-peak charge)
  it("produces tariff_arbitrage with soon urgency during off-peak with low SoC", async () => {
    // We need to test the tariff evaluation logic directly since time-of-day
    // varies. Test the internal function.
    const gw = {
      gateway_id: "GW-001",
      contracted_demand_kw: null,
      assets: [
        {
          asset_id: "ASSET-001",
          battery_soc: 40,
          pv_power: 0,
          battery_power: 0,
          grid_power_kw: 5,
          load_power: 5,
          is_online: true,
          telemetry_age_minutes: 2,
          capacidade_kw: 10,
        },
      ],
      aggregate: {
        total_soc_avg: 40,
        total_grid_kw: 5,
        total_load_kw: 5,
        total_pv_kw: 0,
        online_asset_ratio: 1.0,
        max_telemetry_age: 2,
      },
    };

    // Set tariff peak to a time window that ensures current time is off-peak
    // Use 03:00-04:00 as peak (very unlikely to be current time for most test runs)
    const tariff = {
      peak_start: "03:00:00",
      peak_end: "04:00:00",
      peak_rate: 0.85,
      offpeak_rate: 0.35,
    };

    const now = new Date();
    const currentHour = now.getHours();
    // If we happen to be in 03:00-04:00, use a different window
    const adjustedTariff =
      currentHour >= 3 && currentHour < 4
        ? { ...tariff, peak_start: "01:00:00", peak_end: "02:00:00" }
        : tariff;

    const conditions = _internal.evaluateTariffArbitrage([gw], adjustedTariff);

    expect(conditions.length).toBeGreaterThanOrEqual(1);
    const chargeCondition = conditions.find((c) => c.title.includes("charge"));
    expect(chargeCondition).toBeDefined();
    expect(chargeCondition!.urgency).toBe("soon");
    expect(chargeCondition!.family).toBe("tariff_arbitrage");
  });

  // 5. Stale telemetry demotion
  it("demotes governance to observe when telemetry is stale", async () => {
    setupPoolMock({
      gateways: [makeGatewayRow({ contracted_demand_kw: 100 })],
      assetsByGateway: [
        [
          makeAssetRow({
            battery_soc: 65,
            grid_power_kw: 85,
            telemetry_age_minutes: 20,
          }),
        ],
      ],
      tariff: null,
    });

    await evaluateStrategies(ORG_ID);

    expect(mockUpsertIntent).toHaveBeenCalledTimes(1);
    const intent = mockUpsertIntent.mock.calls[0][1];
    expect(intent.governance_mode).toBe("observe");
  });

  // 6. Scope collision → escalate
  it("escalates when two intents from different families share gateway scope", async () => {
    // Gateway with both peak risk AND low reserve
    setupPoolMock({
      gateways: [makeGatewayRow({ contracted_demand_kw: 100 })],
      assetsByGateway: [
        [makeAssetRow({ battery_soc: 25, grid_power_kw: 85 })], // 25% SoC < 30% + 85% demand
      ],
      tariff: null,
    });

    await evaluateStrategies(ORG_ID);

    // Both peak_shaving and reserve_protection should be triggered
    expect(mockUpsertIntent).toHaveBeenCalledTimes(2);

    const families = mockUpsertIntent.mock.calls.map(
      (c: unknown[]) => (c[1] as Record<string, unknown>).family,
    );
    expect(families).toContain("peak_shaving");
    expect(families).toContain("reserve_protection");

    // Reserve protection (protective) should dominate peak_shaving (economic)
    const peakCall = mockUpsertIntent.mock.calls.find(
      (c: unknown[]) =>
        (c[1] as Record<string, unknown>).family === "peak_shaving",
    );
    expect(peakCall).toBeDefined();
    const peakIntent = peakCall![1] as Record<string, unknown>;
    expect(peakIntent.arbitration_note).toContain(
      "Dominated by reserve_protection",
    );
  });

  // 7. Protective dominates economic
  it("marks peak_shaving with arbitration note when reserve_protection is active on same gateway", async () => {
    setupPoolMock({
      gateways: [makeGatewayRow({ contracted_demand_kw: 100 })],
      assetsByGateway: [
        [makeAssetRow({ battery_soc: 20, grid_power_kw: 85 })], // Both triggered
      ],
      tariff: null,
    });

    await evaluateStrategies(ORG_ID);

    const peakCall = mockUpsertIntent.mock.calls.find(
      (c: unknown[]) =>
        (c[1] as Record<string, unknown>).family === "peak_shaving",
    );
    expect(peakCall).toBeDefined();
    expect(
      (peakCall![1] as Record<string, unknown>).arbitration_note,
    ).toContain("Dominated by reserve_protection");

    // reserve_protection should NOT have a domination note
    const reserveCall = mockUpsertIntent.mock.calls.find(
      (c: unknown[]) =>
        (c[1] as Record<string, unknown>).family === "reserve_protection",
    );
    expect(reserveCall).toBeDefined();
    expect(
      (reserveCall![1] as Record<string, unknown>).arbitration_note,
    ).toBeNull();
  });
});

// ── Internal function unit tests ─────────────────────────────────────────

describe("strategy-evaluator internals", () => {
  describe("computeAggregate", () => {
    it("computes correct aggregates for mixed assets", () => {
      const assets = [
        {
          asset_id: "A1",
          battery_soc: 60,
          pv_power: 5,
          battery_power: 0,
          grid_power_kw: 10,
          load_power: 15,
          is_online: true,
          telemetry_age_minutes: 2,
          capacidade_kw: 10,
        },
        {
          asset_id: "A2",
          battery_soc: 40,
          pv_power: 3,
          battery_power: 0,
          grid_power_kw: 8,
          load_power: 10,
          is_online: false,
          telemetry_age_minutes: 20,
          capacidade_kw: 5,
        },
      ];
      const agg = _internal.computeAggregate(assets);
      expect(agg.total_soc_avg).toBe(50);
      expect(agg.total_grid_kw).toBe(18);
      expect(agg.total_load_kw).toBe(25);
      expect(agg.total_pv_kw).toBe(8);
      expect(agg.online_asset_ratio).toBe(0.5);
      expect(agg.max_telemetry_age).toBe(20);
    });

    it("returns zero aggregate for empty assets", () => {
      const agg = _internal.computeAggregate([]);
      expect(agg.total_soc_avg).toBe(0);
      expect(agg.online_asset_ratio).toBe(0);
      expect(agg.max_telemetry_age).toBe(999);
    });
  });

  describe("parseTimeToMinutes", () => {
    it("parses HH:MM:SS correctly", () => {
      expect(_internal.parseTimeToMinutes("18:00:00")).toBe(1080);
      expect(_internal.parseTimeToMinutes("21:30:00")).toBe(1290);
      expect(_internal.parseTimeToMinutes("00:00:00")).toBe(0);
    });
  });

  describe("evaluatePeakShaving", () => {
    it("does not trigger below 80% threshold", () => {
      const gw = {
        gateway_id: "GW-001",
        contracted_demand_kw: 100,
        assets: [],
        aggregate: {
          total_soc_avg: 50,
          total_grid_kw: 79,
          total_load_kw: 80,
          total_pv_kw: 5,
          online_asset_ratio: 1,
          max_telemetry_age: 2,
        },
      };
      const conditions = _internal.evaluatePeakShaving([gw]);
      expect(conditions).toHaveLength(0);
    });

    it("triggers immediate above 90%", () => {
      const gw = {
        gateway_id: "GW-001",
        contracted_demand_kw: 100,
        assets: [],
        aggregate: {
          total_soc_avg: 50,
          total_grid_kw: 95,
          total_load_kw: 80,
          total_pv_kw: 5,
          online_asset_ratio: 1,
          max_telemetry_age: 2,
        },
      };
      const conditions = _internal.evaluatePeakShaving([gw]);
      expect(conditions).toHaveLength(1);
      expect(conditions[0].urgency).toBe("immediate");
    });

    it("skips gateways without contracted_demand_kw", () => {
      const gw = {
        gateway_id: "GW-001",
        contracted_demand_kw: null,
        assets: [],
        aggregate: {
          total_soc_avg: 50,
          total_grid_kw: 95,
          total_load_kw: 80,
          total_pv_kw: 5,
          online_asset_ratio: 1,
          max_telemetry_age: 2,
        },
      };
      const conditions = _internal.evaluatePeakShaving([gw]);
      expect(conditions).toHaveLength(0);
    });
  });

  describe("evaluateReserveProtection", () => {
    it("triggers immediate for SoC < 15%", () => {
      const gw = {
        gateway_id: "GW-001",
        contracted_demand_kw: null,
        assets: [
          {
            asset_id: "A1",
            battery_soc: 10,
            pv_power: 0,
            battery_power: 0,
            grid_power_kw: 0,
            load_power: 0,
            is_online: true,
            telemetry_age_minutes: 1,
            capacidade_kw: 10,
          },
        ],
        aggregate: {
          total_soc_avg: 10,
          total_grid_kw: 0,
          total_load_kw: 0,
          total_pv_kw: 0,
          online_asset_ratio: 1,
          max_telemetry_age: 1,
        },
      };
      const conditions = _internal.evaluateReserveProtection([gw]);
      expect(conditions).toHaveLength(1);
      expect(conditions[0].urgency).toBe("immediate");
    });

    it("triggers soon for SoC between 15-30%", () => {
      const gw = {
        gateway_id: "GW-001",
        contracted_demand_kw: null,
        assets: [],
        aggregate: {
          total_soc_avg: 25,
          total_grid_kw: 0,
          total_load_kw: 0,
          total_pv_kw: 0,
          online_asset_ratio: 1,
          max_telemetry_age: 1,
        },
      };
      const conditions = _internal.evaluateReserveProtection([gw]);
      expect(conditions).toHaveLength(1);
      expect(conditions[0].urgency).toBe("soon");
    });

    it("does not trigger for SoC >= 30%", () => {
      const gw = {
        gateway_id: "GW-001",
        contracted_demand_kw: null,
        assets: [],
        aggregate: {
          total_soc_avg: 50,
          total_grid_kw: 0,
          total_load_kw: 0,
          total_pv_kw: 0,
          online_asset_ratio: 1,
          max_telemetry_age: 1,
        },
      };
      const conditions = _internal.evaluateReserveProtection([gw]);
      expect(conditions).toHaveLength(0);
    });
  });

  describe("arbitrate", () => {
    it("protective dominates economic on same scope", () => {
      const governed = [
        {
          family: "reserve_protection" as const,
          triggered: true,
          urgency: "immediate" as const,
          title: "Reserve low",
          reason_summary: "SoC low",
          scope_gateway_ids: ["GW-001"],
          evidence_snapshot: {},
          constraints: null,
          suggested_playbook: "Charge",
          confidence: 0.9,
          governance_mode: "auto_governed" as const,
        },
        {
          family: "peak_shaving" as const,
          triggered: true,
          urgency: "soon" as const,
          title: "Peak risk",
          reason_summary: "Grid high",
          scope_gateway_ids: ["GW-001"],
          evidence_snapshot: {},
          constraints: null,
          suggested_playbook: "Discharge",
          confidence: 0.8,
          governance_mode: "approval_required" as const,
        },
      ];

      const result = _internal.arbitrate(governed);
      expect(result).toHaveLength(2);

      const reserve = result.find((r) => r.family === "reserve_protection");
      const peak = result.find((r) => r.family === "peak_shaving");

      expect(reserve!.arbitration_note).toBeNull();
      expect(peak!.arbitration_note).toContain(
        "Dominated by reserve_protection",
      );
    });

    it("same family same scope → both escalated", () => {
      const governed = [
        {
          family: "peak_shaving" as const,
          triggered: true,
          urgency: "immediate" as const,
          title: "Peak A",
          reason_summary: "A",
          scope_gateway_ids: ["GW-001"],
          evidence_snapshot: {},
          constraints: null,
          suggested_playbook: "X",
          confidence: 0.9,
          governance_mode: "approval_required" as const,
        },
        {
          family: "peak_shaving" as const,
          triggered: true,
          urgency: "soon" as const,
          title: "Peak B",
          reason_summary: "B",
          scope_gateway_ids: ["GW-001"],
          evidence_snapshot: {},
          constraints: null,
          suggested_playbook: "Y",
          confidence: 0.8,
          governance_mode: "approval_required" as const,
        },
      ];

      const result = _internal.arbitrate(governed);
      expect(result[0].governance_mode).toBe("escalate");
      expect(result[1].governance_mode).toBe("escalate");
    });
  });
});
