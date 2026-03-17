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

import { handler } from "../../src/bff/handlers/put-device";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(
  assetId: string,
  authHeader: string,
  body?: string,
): APIGatewayProxyEventV2 {
  const path = `/api/devices/${assetId}`;
  return {
    version: "2.0",
    routeKey: `PUT ${path}`,
    rawPath: path,
    rawQueryString: "",
    headers: { authorization: authHeader },
    body: body ?? undefined,
    requestContext: {
      accountId: "test",
      apiId: "test",
      domainName: "test",
      domainPrefix: "test",
      http: {
        method: "PUT",
        path,
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "test",
      },
      requestId: "test-1",
      routeKey: `PUT ${path}`,
      stage: "$default",
      time: new Date().toISOString(),
      timeEpoch: Date.now(),
    },
    isBase64Encoded: false,
  };
}

function adminToken(): string {
  return JSON.stringify({
    userId: "admin",
    orgId: "ORG_ENERGIA_001",
    role: "SOLFACIL_ADMIN",
  });
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

describe("PUT /api/devices/:assetId", () => {
  it("200 — updates device config successfully", async () => {
    mockQueryWithOrg.mockResolvedValueOnce({
      rows: [{ asset_id: "ASSET_SP_001" }],
    });

    const event = makeEvent(
      "ASSET_SP_001",
      adminToken(),
      JSON.stringify({ operationMode: "self_consumption", capacidadeKw: 5.0 }),
    );
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    const body = parseBody(result);
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty("assetId", "ASSET_SP_001");
    expect(body.data).toHaveProperty("updated", true);
  });

  it("400 — rejects socMin >= socMax", async () => {
    const event = makeEvent(
      "ASSET_SP_001",
      adminToken(),
      JSON.stringify({ socMin: 80, socMax: 50 }),
    );
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
  });

  it("400 — rejects capacidadeKw <= 0", async () => {
    const event = makeEvent(
      "ASSET_SP_001",
      adminToken(),
      JSON.stringify({ capacidadeKw: -1 }),
    );
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
  });

  it("400 — rejects invalid operationMode", async () => {
    const event = makeEvent(
      "ASSET_SP_001",
      adminToken(),
      JSON.stringify({ operationMode: "turbo_mode" }),
    );
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
  });

  it("403 — rejects ORG_VIEWER role", async () => {
    const viewerToken = JSON.stringify({
      userId: "u1",
      orgId: "ORG_ENERGIA_001",
      role: "ORG_VIEWER",
    });
    const event = makeEvent(
      "ASSET_SP_001",
      viewerToken,
      JSON.stringify({ operationMode: "self_consumption" }),
    );
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(403);
  });

  it("403 — rejects ORG_OPERATOR role", async () => {
    const operatorToken = JSON.stringify({
      userId: "u1",
      orgId: "ORG_ENERGIA_001",
      role: "ORG_OPERATOR",
    });
    const event = makeEvent(
      "ASSET_SP_001",
      operatorToken,
      JSON.stringify({ operationMode: "self_consumption" }),
    );
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(403);
  });

  it("404 — device not found", async () => {
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [] });

    const event = makeEvent(
      "NONEXISTENT",
      adminToken(),
      JSON.stringify({ operationMode: "self_consumption" }),
    );
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(404);
  });

  it("returns 401 with empty auth", async () => {
    const event = makeEvent("ASSET_SP_001", "");
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(401);
  });
});
