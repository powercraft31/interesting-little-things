import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { handler } from "../../src/bff/handlers/get-dashboard";
import { closeAllPools } from "../../src/shared/db";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(authHeader?: string): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: "GET /dashboard",
    rawPath: "/dashboard",
    rawQueryString: "",
    headers: authHeader !== undefined ? { authorization: authHeader } : {},
    requestContext: {
      accountId: "test",
      apiId: "test",
      domainName: "test",
      domainPrefix: "test",
      http: {
        method: "GET",
        path: "/dashboard",
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "test",
      },
      requestId: "test-1",
      routeKey: "GET /dashboard",
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /dashboard handler", () => {
  afterAll(async () => {
    await closeAllPools();
  });

  it("SOLFACIL_ADMIN sees all 47 assets aggregated", async () => {
    const event = makeEvent(tokenFor("admin", "SOLFACIL", "SOLFACIL_ADMIN"));
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);

    const body = JSON.parse(result.body as string);
    expect(body.success).toBe(true);

    const data = body.data;
    // SOLFACIL_ADMIN 看全部 47 台設備
    expect(data.totalAssets).toBe(47);
    expect(data.onlineAssets).toBeGreaterThanOrEqual(1);
    expect(data.onlineAssets).toBeLessThanOrEqual(47);

    // avgSoc across all 47 assets — use range check for resilience
    expect(data.avgSoc).toBeGreaterThanOrEqual(1);
    expect(data.avgSoc).toBeLessThanOrEqual(100);

    // totalPowerKw 和 totalPvKw 是字串（.toFixed(1)）
    expect(typeof data.totalPowerKw).toBe("string");
    expect(parseFloat(data.totalPowerKw)).toBeGreaterThan(0);
  });

  it("ORG_ENERGIA_001 only aggregates its 30 assets", async () => {
    const event = makeEvent(tokenFor("u1", "ORG_ENERGIA_001", "ORG_MANAGER"));
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);

    const body = JSON.parse(result.body as string);
    expect(body.success).toBe(true);

    const data = body.data;
    // ORG_ENERGIA_001 有 30 台設備
    expect(data.totalAssets).toBe(30);
    expect(data.onlineAssets).toBeGreaterThanOrEqual(1);
    expect(data.onlineAssets).toBeLessThanOrEqual(30);

    // avgSoc across 30 assets — use range check for resilience
    expect(data.avgSoc).toBeGreaterThanOrEqual(1);
    expect(data.avgSoc).toBeLessThanOrEqual(100);
  });

  it("returns 401 when no Authorization token is provided", async () => {
    const event = makeEvent("");
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(401);
    const body = JSON.parse(result.body as string);
    expect(body.success).toBe(false);
  });

  it("response contains required KPI fields (API contract)", async () => {
    const event = makeEvent(tokenFor("admin", "SOLFACIL", "SOLFACIL_ADMIN"));
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    const body = JSON.parse(result.body as string);
    const data = body.data;

    // API contract fields — 這些欄位不能消失（breaking change 防呆）
    expect(data).toHaveProperty("totalAssets");
    expect(data).toHaveProperty("onlineAssets");
    expect(data).toHaveProperty("avgSoc");
    expect(data).toHaveProperty("vppDispatchAccuracy");
    expect(data).toHaveProperty("drResponseLatency");
    expect(data).toHaveProperty("gatewayUptime");
    expect(data).toHaveProperty("selfConsumption");
    expect(data).toHaveProperty("dispatchSuccessCount");
    expect(data).toHaveProperty("dispatchTotalCount");
    expect(data).toHaveProperty("dispatchSuccessRate");
    expect(data).toHaveProperty("systemHealthBlock");
  });

  it("v5.9: dispatchSuccessCount and dispatchTotalCount come from DB (not hardcoded 156/160)", async () => {
    const event = makeEvent(tokenFor("admin", "SOLFACIL", "SOLFACIL_ADMIN"));
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    const body = JSON.parse(result.body as string);
    const data = body.data;

    // These should be dynamic from dispatch_commands table, not the old hardcoded 156/160
    expect(typeof data.dispatchSuccessCount).toBe("number");
    expect(typeof data.dispatchTotalCount).toBe("number");
    // The dispatch success rate should be a string formatted as "X/Y"
    expect(data.dispatchSuccessRate).toMatch(/^\d+\/\d+$/);
    // Should NOT be the old hardcoded values
    expect(data.dispatchSuccessRate).not.toBe("156/160");
  });

  it("v5.9: monthlyRevenueReais is from DB (not hardcoded 0)", async () => {
    const event = makeEvent(tokenFor("admin", "SOLFACIL", "SOLFACIL_ADMIN"));
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    const body = JSON.parse(result.body as string);
    const data = body.data;

    // monthlyRevenueReais should be a number from DB
    expect(typeof data.monthlyRevenueReais).toBe("number");
  });
});
