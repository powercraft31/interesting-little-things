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

import { handler } from "../../src/bff/handlers/get-gateways";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(
  authHeader: string,
): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: "GET /api/gateways",
    rawPath: "/api/gateways",
    rawQueryString: "",
    headers: { authorization: authHeader },
    requestContext: {
      accountId: "test",
      apiId: "test",
      domainName: "test",
      domainPrefix: "test",
      http: {
        method: "GET",
        path: "/api/gateways",
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "test",
      },
      requestId: "test-1",
      routeKey: "GET /api/gateways",
      stage: "$default",
      time: new Date().toISOString(),
      timeEpoch: Date.now(),
    },
    isBase64Encoded: false,
  };
}

function adminToken(): string {
  return JSON.stringify({ userId: "admin", orgId: "SOLFACIL", role: "SOLFACIL_ADMIN" });
}

function orgToken(orgId = "ORG_ENERGIA_001", role = "ORG_MANAGER"): string {
  return JSON.stringify({ userId: "u1", orgId, role });
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

describe("GET /api/gateways", () => {
  it("returns gateway list with device count and emsHealth (admin)", async () => {
    mockQueryWithOrg.mockResolvedValueOnce({
      rows: [
        {
          gateway_id: "WKRD24070202100144F",
          name: "Casa Silva · Home-1",
          org_id: "ORG_ENERGIA_001",
          org_name: "Solfacil Pilot Corp",
          status: "online",
          last_seen_at: "2026-03-10T12:00:00Z",
          ems_health: { cpu: 45, mem: 62 },
          contracted_demand_kw: 15.0,
          device_count: 13,
        },
        {
          gateway_id: "WKRD24070202100228G",
          name: "Casa Santos · Home-2",
          org_id: "ORG_ENERGIA_001",
          org_name: "Solfacil Pilot Corp",
          status: "online",
          last_seen_at: "2026-03-10T12:00:00Z",
          ems_health: {},
          contracted_demand_kw: 12.0,
          device_count: 15,
        },
      ],
    });

    const event = makeEvent(adminToken());
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    const body = parseBody(result);
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty("gateways");

    const gateways = (body.data as Record<string, unknown>).gateways as Array<Record<string, unknown>>;
    expect(gateways).toHaveLength(2);
    expect(gateways[0]).toHaveProperty("gatewayId", "WKRD24070202100144F");
    expect(gateways[0]).toHaveProperty("name", "Casa Silva · Home-1");
    expect(gateways[0]).toHaveProperty("status", "online");
    expect(gateways[0]).toHaveProperty("deviceCount", 13);
    expect(gateways[0]).toHaveProperty("emsHealth");
    expect(gateways[0]).toHaveProperty("contractedDemandKw", 15.0);
  });

  it("RLS: non-admin org only sees its own gateways", async () => {
    mockQueryWithOrg.mockResolvedValueOnce({
      rows: [
        {
          gateway_id: "WKRD24070202100144F",
          name: "Casa Silva · Home-1",
          org_id: "ORG_ENERGIA_001",
          org_name: "Solfacil Pilot Corp",
          status: "online",
          last_seen_at: null,
          ems_health: {},
          contracted_demand_kw: null,
          device_count: 13,
        },
      ],
    });

    const event = makeEvent(orgToken("ORG_ENERGIA_001"));
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    const body = parseBody(result);
    const gateways = (body.data as Record<string, unknown>).gateways as Array<Record<string, unknown>>;
    expect(gateways).toHaveLength(1);

    // Verify queryWithOrg was called with orgId for RLS
    expect(mockQueryWithOrg).toHaveBeenCalledWith(
      expect.any(String),
      [],
      "ORG_ENERGIA_001",
    );
  });

  it("returns 401 with empty auth", async () => {
    const event = makeEvent("");
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(401);
  });
});
