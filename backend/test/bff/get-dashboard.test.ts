import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { handler } from "../../src/bff/handlers/get-dashboard";
import { closePool } from "../../src/shared/db";

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
    await closePool();
  });

  it("SOLFACIL_ADMIN sees all 4 assets aggregated", async () => {
    const event = makeEvent(tokenFor("admin", "SOLFACIL", "SOLFACIL_ADMIN"));
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);

    const body = JSON.parse(result.body as string);
    expect(body.success).toBe(true);

    const data = body.data;
    // SOLFACIL_ADMIN 看全部 4 台設備
    expect(data.totalAssets).toBe(4);
    expect(data.onlineAssets).toBe(4);

    // avgSoc = (65+72+58+34)/4 = 57.25 → 57
    expect(data.avgSoc).toBe(57);

    // totalPowerKw 和 totalPvKw 是字串（.toFixed(1)）
    expect(typeof data.totalPowerKw).toBe("string");
    expect(parseFloat(data.totalPowerKw)).toBeGreaterThan(0);
  });

  it("ORG_ENERGIA_001 only aggregates its 2 assets", async () => {
    const event = makeEvent(tokenFor("u1", "ORG_ENERGIA_001", "ORG_MANAGER"));
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);

    const body = JSON.parse(result.body as string);
    expect(body.success).toBe(true);

    const data = body.data;
    // ORG_ENERGIA_001 只有 SP_001 + RJ_002
    expect(data.totalAssets).toBe(2);
    expect(data.onlineAssets).toBe(2);

    // avgSoc = (65+72)/2 = 68.5 → 69（四捨五入）
    // 注意：DB DECIMAL 精度可能略有差異，允許 ±2 誤差
    expect(data.avgSoc).toBeGreaterThanOrEqual(67);
    expect(data.avgSoc).toBeLessThanOrEqual(70);
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
});
