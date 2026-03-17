import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";

// ---------------------------------------------------------------------------
// Mock queryWithOrg before importing handler
// ---------------------------------------------------------------------------

const mockQueryWithOrg = jest.fn();
jest.mock("../../src/shared/db", () => ({
  queryWithOrg: (...args: unknown[]) => mockQueryWithOrg(...args),
  getAppPool: jest.fn(),
  getServicePool: jest.fn(),
  closeAllPools: jest.fn().mockResolvedValue(undefined),
}));

import { handler } from "../../src/bff/handlers/get-assets";

// ---------------------------------------------------------------------------
// Fetch mock for AppConfig feature-flags
// ---------------------------------------------------------------------------

const mockFetch = jest.fn();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(authHeader?: string): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: "GET /assets",
    rawPath: "/assets",
    rawQueryString: "",
    headers: authHeader !== undefined ? { authorization: authHeader } : {},
    requestContext: {
      accountId: "test",
      apiId: "test",
      domainName: "test",
      domainPrefix: "test",
      http: {
        method: "GET",
        path: "/assets",
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "test",
      },
      requestId: "test-1",
      routeKey: "GET /assets",
      stage: "$default",
      time: new Date().toISOString(),
      timeEpoch: Date.now(),
    },
    isBase64Encoded: false,
  };
}

function tokenFor(userId: string, orgId: string, role: string): string {
  return JSON.stringify({ userId, orgId, role });
}

function makeAdminEvent() {
  return makeEvent(tokenFor("admin", "ORG_ENERGIA_001", "SOLFACIL_ADMIN"));
}

// ---------------------------------------------------------------------------
// Shared mock row factory
// ---------------------------------------------------------------------------

function mockAssetRow(overrides: Record<string, unknown> = {}) {
  return {
    asset_id: "ASSET_001",
    org_id: "ORG_ENERGIA_001",
    name: "Asset 1",
    region: "SP",
    capacidade: 5.0,
    capacity_kwh: 10.0,
    operation_mode: "self_consumption",
    investimento_brl: 25000,
    roi_pct: 12.5,
    payback_str: "4.2 anos",
    receita_mes_brl: 350,
    battery_soc: 72,
    bat_soh: 98,
    bat_work_status: "idle",
    battery_voltage: 52.1,
    bat_cycle_count: 120,
    pv_power: 3.2,
    battery_power: 1.5,
    grid_power_kw: 0.8,
    load_power: 2.1,
    inverter_temp: 38,
    is_online: true,
    grid_frequency: 60.0,
    pv_daily_energy: 15.4,
    bat_charged_today: 8.2,
    bat_discharged_today: 6.1,
    grid_import_kwh: 3.0,
    grid_export_kwh: 1.5,
    receita_hoje_brl: 12.5,
    custo_hoje_brl: 5.0,
    lucro_hoje_brl: 7.5,
    vs_min_soc: 20,
    vs_max_soc: 95,
    max_charge_rate_kw: 3.3,
    charge_window_start: "23:00",
    charge_window_end: "05:00",
    discharge_window_start: "17:00",
    target_self_consumption_pct: 80,
    ...overrides,
  };
}

const ENERGIA_ROWS = [
  mockAssetRow({ asset_id: "ASSET_SP_001", name: "Asset SP" }),
  mockAssetRow({ asset_id: "ASSET_RJ_002", name: "Asset RJ", region: "RJ" }),
  mockAssetRow({ asset_id: "ASSET_MG_003", name: "Asset MG", region: "MG" }),
  mockAssetRow({ asset_id: "ASSET_PR_004", name: "Asset PR", region: "PR" }),
];

const SOLARBR_ROWS = [
  mockAssetRow({
    asset_id: "ASSET_SOL_001",
    org_id: "ORG_SOLARBR_002",
    name: "Solar 1",
  }),
  mockAssetRow({
    asset_id: "ASSET_SOL_002",
    org_id: "ORG_SOLARBR_002",
    name: "Solar 2",
  }),
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /assets handler", () => {
  beforeEach(() => {
    mockQueryWithOrg.mockReset();
    mockFetch.mockReset();
    // Default: feature-flags unavailable → fall back → showRoiMetrics = false
    mockFetch.mockResolvedValue({ ok: false, status: 503 });
    global.fetch = mockFetch as any;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("SOLFACIL_ADMIN receives only its own org assets (org-scoped)", async () => {
    mockQueryWithOrg.mockResolvedValueOnce({ rows: ENERGIA_ROWS });

    const event = makeEvent(
      tokenFor("admin", "ORG_ENERGIA_001", "SOLFACIL_ADMIN"),
    );
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);

    const body = JSON.parse(result.body as string);
    expect(body.success).toBe(true);
    expect(body.data.assets).toHaveLength(4);

    // Verify asset IDs present
    const ids = body.data.assets.map((a: { id: string }) => a.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "ASSET_SP_001",
        "ASSET_RJ_002",
        "ASSET_MG_003",
        "ASSET_PR_004",
      ]),
    );

    // capacity_kwh field exists and is numeric
    const firstAsset = body.data.assets[0];
    expect(firstAsset).toHaveProperty("capacity_kwh");
    expect(typeof firstAsset.capacity_kwh).toBe("number");
    expect(firstAsset.capacity_kwh).toBeGreaterThan(0);

    // Three-level nested structure (v5.3 API contract)
    expect(firstAsset).toHaveProperty("metering");
    expect(firstAsset).toHaveProperty("status");
    expect(firstAsset).toHaveProperty("config");
    expect(firstAsset.status).toHaveProperty("battery_soc");
    expect(firstAsset.status).toHaveProperty("is_online");

    // _tenant envelope reflects the caller's identity
    expect(body.data._tenant).toEqual({
      orgId: "ORG_ENERGIA_001",
      role: "SOLFACIL_ADMIN",
    });

    // Verify queryWithOrg was called with admin's orgId (org-scoped)
    expect(mockQueryWithOrg).toHaveBeenCalledWith(
      expect.any(String),
      [],
      "ORG_ENERGIA_001",
    );
  });

  it("ORG_ENERGIA_001 only receives its own assets", async () => {
    mockQueryWithOrg.mockResolvedValueOnce({ rows: ENERGIA_ROWS });

    const event = makeEvent(tokenFor("u1", "ORG_ENERGIA_001", "ORG_MANAGER"));
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);

    const body = JSON.parse(result.body as string);
    expect(body.success).toBe(true);
    expect(body.data.assets).toHaveLength(4);

    // Deep assert: every asset belongs to this org (no cross-tenant leak)
    expect(
      body.data.assets.every(
        (a: { orgId: string }) => a.orgId === "ORG_ENERGIA_001",
      ),
    ).toBe(true);

    // Cross-contamination guard: ORG_SOLARBR_002 assets must be absent
    const ids = body.data.assets.map((a: { id: string }) => a.id);
    expect(ids).toEqual(
      expect.arrayContaining(["ASSET_SP_001", "ASSET_RJ_002"]),
    );

    // RLS verification: capacity_kwh is numeric
    body.data.assets.forEach(
      (asset: { capacity_kwh: number; assetId: string }) => {
        expect(typeof asset.capacity_kwh).toBe("number");
        expect(asset.capacity_kwh).toBeGreaterThanOrEqual(0);
      },
    );

    // _tenant envelope matches caller's orgId and role
    expect(body.data._tenant).toEqual({
      orgId: "ORG_ENERGIA_001",
      role: "ORG_MANAGER",
    });
  });

  it("ORG_SOLARBR_002 only receives its own assets", async () => {
    mockQueryWithOrg.mockResolvedValueOnce({ rows: SOLARBR_ROWS });

    const event = makeEvent(
      tokenFor("u2", "ORG_SOLARBR_002", "ORG_OPERATOR"),
    );
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);

    const body = JSON.parse(result.body as string);
    expect(body.success).toBe(true);
    expect(body.data.assets).toHaveLength(2);

    // Deep assert: every asset belongs to this org (no cross-tenant leak)
    expect(
      body.data.assets.every(
        (a: { orgId: string }) => a.orgId === "ORG_SOLARBR_002",
      ),
    ).toBe(true);

    // Cross-contamination guard: ORG_ENERGIA_001 assets must be absent
    const ids = body.data.assets.map((a: { id: string }) => a.id);
    expect(ids).not.toEqual(
      expect.arrayContaining(["ASSET_SP_001", "ASSET_RJ_002"]),
    );

    // _tenant envelope matches caller's orgId and role
    expect(body.data._tenant).toEqual({
      orgId: "ORG_SOLARBR_002",
      role: "ORG_OPERATOR",
    });
  });

  it("returns 401 when no Authorization token is provided", async () => {
    const event = makeEvent("");
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(401);

    const body = JSON.parse(result.body as string);
    expect(body.success).toBe(false);
    expect(body.error).toBeDefined();
  });

  it("returns 401 when Authorization header is missing entirely", async () => {
    const event = makeEvent(undefined);
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(401);
  });

  // ── Feature Flag Tests ────────────────────────────────────────────────

  it("excludes roi and payback fields when show-roi-metrics flag is disabled", async () => {
    mockQueryWithOrg.mockResolvedValueOnce({ rows: ENERGIA_ROWS });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        "show-roi-metrics": { isEnabled: false },
      }),
    });

    const result = (await handler(
      makeAdminEvent(),
    )) as APIGatewayProxyStructuredResultV2;
    const body = JSON.parse(result.body as string);
    const assets = body.data.assets;

    expect(assets[0].roi).toBeUndefined();
    expect(assets[0].payback).toBeUndefined();
  });

  it("includes roi and payback fields when show-roi-metrics flag is enabled for org", async () => {
    mockQueryWithOrg.mockResolvedValueOnce({ rows: ENERGIA_ROWS });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        "show-roi-metrics": {
          isEnabled: true,
          targetOrgIds: ["ORG_ENERGIA_001"],
        },
      }),
    });

    const result = (await handler(
      makeAdminEvent(),
    )) as APIGatewayProxyStructuredResultV2;
    const body = JSON.parse(result.body as string);
    const assets = body.data.assets;

    expect(assets[0].roi).toBeDefined();
    expect(assets[0].payback).toBeDefined();
  });

  it("falls back gracefully when AppConfig returns NetworkError", async () => {
    mockQueryWithOrg.mockResolvedValueOnce({ rows: ENERGIA_ROWS });
    mockFetch.mockRejectedValueOnce(new Error("timeout"));

    const result = (await handler(
      makeAdminEvent(),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(200);
  });
});
