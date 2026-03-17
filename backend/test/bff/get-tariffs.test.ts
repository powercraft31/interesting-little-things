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

import { handler } from "../../src/bff/handlers/get-tariffs";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(authHeader: string): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: "GET /api/tariffs",
    rawPath: "/api/tariffs",
    rawQueryString: "",
    headers: { authorization: authHeader },
    requestContext: {
      accountId: "test",
      apiId: "test",
      domainName: "test",
      domainPrefix: "test",
      http: {
        method: "GET",
        path: "/api/tariffs",
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "test",
      },
      requestId: "test-1",
      routeKey: "GET /api/tariffs",
      stage: "$default",
      time: new Date().toISOString(),
      timeEpoch: Date.now(),
    },
    isBase64Encoded: false,
  };
}

function adminToken(): string {
  return JSON.stringify({ userId: "admin", orgId: "ORG_ENERGIA_001", role: "SOLFACIL_ADMIN" });
}

function parseBody(result: APIGatewayProxyStructuredResultV2): {
  success: boolean;
  data: Record<string, unknown>;
} {
  return JSON.parse(result.body as string);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockQueryWithOrg.mockReset();
});

describe("GET /api/tariffs", () => {
  it("returns tariff schedule with CEMIG rates", async () => {
    mockQueryWithOrg.mockResolvedValueOnce({
      rows: [{
        disco: "CEMIG",
        peak_rate: 0.89,
        offpeak_rate: 0.41,
        intermediate_rate: 0.62,
        feed_in_rate: 0.25,
        peak_start: "17:00:00",
        peak_end: "20:00:00",
        intermediate_start: "16:00:00",
        intermediate_end: "21:00:00",
        effective_from: "2026-01-01",
        demand_charge_rate_per_kva: 5.50,
        billing_power_factor: 0.92,
      }],
    });

    const event = makeEvent(adminToken());
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    const body = parseBody(result);
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty("disco", "CEMIG");
    expect(body.data).toHaveProperty("peakRate", 0.89);
    expect(body.data).toHaveProperty("intermediateRate", 0.62);
    expect(body.data).toHaveProperty("offPeakRate", 0.41);
    expect(body.data).toHaveProperty("feedInRate", 0.25);
    expect(body.data).toHaveProperty("peakStart", "17:00");
    expect(body.data).toHaveProperty("peakEnd", "20:00");
    expect(body.data).toHaveProperty("demandChargeRate", 5.50);
    expect(body.data).toHaveProperty("billingPowerFactor", 0.92);
  });

  it("returns empty object when no tariff exists", async () => {
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [] });

    const event = makeEvent(adminToken());
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    const body = parseBody(result);
    expect(body.success).toBe(true);
    // Empty data — no rates
    expect(body.data).not.toHaveProperty("disco");
  });

  it("returns 401 with empty auth", async () => {
    const event = makeEvent("");
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(401);
  });
});
