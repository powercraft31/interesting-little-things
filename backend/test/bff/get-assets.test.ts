import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { handler } from "../../src/bff/handlers/get-assets";
import { closeAllPools } from "../../src/shared/db";

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
  return makeEvent(tokenFor("admin", "SOLFACIL", "SOLFACIL_ADMIN"));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /assets handler", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    // Default: feature-flags unavailable → fall back → showRoiMetrics = false
    mockFetch.mockResolvedValue({ ok: false, status: 503 });
    global.fetch = mockFetch as any;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("SOLFACIL_ADMIN receives all assets (unfiltered)", async () => {
    const event = makeEvent(tokenFor("admin", "SOLFACIL", "SOLFACIL_ADMIN"));
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);

    const body = JSON.parse(result.body as string);
    expect(body.success).toBe(true);
    expect(body.data.assets).toHaveLength(4);

    // Verify all 4 asset IDs present
    const ids = body.data.assets.map((a: { id: string }) => a.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "ASSET_SP_001",
        "ASSET_RJ_002",
        "ASSET_MG_003",
        "ASSET_PR_004",
      ]),
    );

    // 向下相容性防呆：capacity_kwh 欄位必須存在且為數字（Stage 3 後改為讀取真實 DB）
    const firstAsset = body.data.assets[0];
    expect(firstAsset).toHaveProperty("capacity_kwh");
    expect(typeof firstAsset.capacity_kwh).toBe("number");
    expect(firstAsset.capacity_kwh).toBeGreaterThan(0);

    // 三層嵌套結構完整性（v5.3 API contract）
    expect(firstAsset).toHaveProperty("metering");
    expect(firstAsset).toHaveProperty("status");
    expect(firstAsset).toHaveProperty("config");
    expect(firstAsset.status).toHaveProperty("battery_soc");
    expect(firstAsset.status).toHaveProperty("is_online");

    // Deep assert: _tenant envelope reflects the caller's identity
    expect(body.data._tenant).toEqual({
      orgId: "SOLFACIL",
      role: "SOLFACIL_ADMIN",
    });
  });

  it("ORG_ENERGIA_001 only receives its own assets", async () => {
    const event = makeEvent(tokenFor("u1", "ORG_ENERGIA_001", "ORG_MANAGER"));
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);

    const body = JSON.parse(result.body as string);
    expect(body.success).toBe(true);
    expect(body.data.assets).toHaveLength(2);

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
    expect(ids).not.toContain("ASSET_MG_003");
    expect(ids).not.toContain("ASSET_PR_004");

    // RLS 驗證：每筆資料的 capacity_kwh 必須是合法數值（來自真實 DB）
    body.data.assets.forEach(
      (asset: { capacity_kwh: number; assetId: string }) => {
        expect(asset.capacity_kwh).toBeGreaterThan(0);
      },
    );
    // SP_001=13.5, RJ_002=10.0（來自 seed data）
    const capacities = body.data.assets
      .map((a: { capacity_kwh: number }) => a.capacity_kwh)
      .sort((x: number, y: number) => x - y);
    expect(capacities).toEqual([10, 13.5]);

    // Deep assert: _tenant envelope matches caller's orgId and role
    expect(body.data._tenant).toEqual({
      orgId: "ORG_ENERGIA_001",
      role: "ORG_MANAGER",
    });
  });

  it("ORG_SOLARBR_002 only receives its own assets", async () => {
    const event = makeEvent(tokenFor("u2", "ORG_SOLARBR_002", "ORG_OPERATOR"));
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
    expect(ids).toEqual(
      expect.arrayContaining(["ASSET_MG_003", "ASSET_PR_004"]),
    );
    expect(ids).not.toContain("ASSET_SP_001");
    expect(ids).not.toContain("ASSET_RJ_002");

    // Deep assert: _tenant envelope matches caller's orgId and role
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
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        "show-roi-metrics": { isEnabled: true, targetOrgIds: ["SOLFACIL"] },
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
    mockFetch.mockRejectedValueOnce(new Error("timeout"));

    const result = (await handler(
      makeAdminEvent(),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(200);
  });

  afterAll(async () => {
    await closeAllPools();
  });
});
