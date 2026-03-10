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

import { handler } from "../../src/bff/handlers/put-device-schedule";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(
  assetId: string,
  authHeader: string,
  body?: string,
): APIGatewayProxyEventV2 {
  const path = `/api/devices/${assetId}/schedule`;
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
    orgId: "SOLFACIL",
    role: "SOLFACIL_ADMIN",
  });
}

function managerToken(): string {
  return JSON.stringify({
    userId: "u1",
    orgId: "ORG_ENERGIA_001",
    role: "ORG_MANAGER",
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

const validSchedule = JSON.stringify({
  slots: [
    { startHour: 0, endHour: 6, mode: "self_consumption" },
    { startHour: 6, endHour: 17, mode: "peak_valley_arbitrage" },
    { startHour: 17, endHour: 24, mode: "peak_shaving" },
  ],
});

describe("PUT /api/devices/:assetId/schedule", () => {
  it("202 Accepted — valid schedule creates pending_dispatch record", async () => {
    // Q1: get gateway_id from asset
    mockQueryWithOrg.mockResolvedValueOnce({
      rows: [{ gateway_id: "WKRD24070202100144F" }],
    });
    // Q2: insert command log
    mockQueryWithOrg.mockResolvedValueOnce({
      rows: [{ id: 42 }],
    });

    const event = makeEvent("ASSET_SP_001", managerToken(), validSchedule);
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(202);
    const body = parseBody(result);
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty("commandId", 42);
    expect(body.data).toHaveProperty("status", "pending_dispatch");

    // Verify INSERT was called with correct params
    const insertCall = mockQueryWithOrg.mock.calls[1];
    expect(insertCall[0]).toContain("INSERT INTO device_command_logs");
    expect(insertCall[1][0]).toBe("WKRD24070202100144F");
    // payload should contain the slots
    const payload = JSON.parse(insertCall[1][1]);
    expect(payload.slots).toHaveLength(3);
  });

  it("400 — schedule with gap (not starting at 0)", async () => {
    const gapSchedule = JSON.stringify({
      slots: [
        { startHour: 1, endHour: 12, mode: "self_consumption" },
        { startHour: 12, endHour: 24, mode: "peak_shaving" },
      ],
    });

    const event = makeEvent("ASSET_SP_001", adminToken(), gapSchedule);
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
  });

  it("400 — schedule with gap between slots", async () => {
    const gapSchedule = JSON.stringify({
      slots: [
        { startHour: 0, endHour: 6, mode: "self_consumption" },
        { startHour: 8, endHour: 24, mode: "peak_shaving" },
      ],
    });

    const event = makeEvent("ASSET_SP_001", adminToken(), gapSchedule);
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
  });

  it("400 — schedule not ending at 24", async () => {
    const shortSchedule = JSON.stringify({
      slots: [{ startHour: 0, endHour: 12, mode: "self_consumption" }],
    });

    const event = makeEvent("ASSET_SP_001", adminToken(), shortSchedule);
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
  });

  it("400 — invalid mode", async () => {
    const badMode = JSON.stringify({
      slots: [{ startHour: 0, endHour: 24, mode: "turbo_mode" }],
    });

    const event = makeEvent("ASSET_SP_001", adminToken(), badMode);
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
  });

  it("400 — non-integer hours", async () => {
    const nonInt = JSON.stringify({
      slots: [{ startHour: 0.5, endHour: 24, mode: "self_consumption" }],
    });

    const event = makeEvent("ASSET_SP_001", adminToken(), nonInt);
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
  });

  it("400 — empty slots array", async () => {
    const empty = JSON.stringify({ slots: [] });

    const event = makeEvent("ASSET_SP_001", adminToken(), empty);
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
  });

  it("403 — rejects ORG_VIEWER", async () => {
    const viewerToken = JSON.stringify({
      userId: "u1",
      orgId: "ORG_ENERGIA_001",
      role: "ORG_VIEWER",
    });
    const event = makeEvent("ASSET_SP_001", viewerToken, validSchedule);
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(403);
  });

  it("403 — rejects ORG_OPERATOR", async () => {
    const operatorToken = JSON.stringify({
      userId: "u1",
      orgId: "ORG_ENERGIA_001",
      role: "ORG_OPERATOR",
    });
    const event = makeEvent("ASSET_SP_001", operatorToken, validSchedule);
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(403);
  });

  it("returns 401 with empty auth", async () => {
    const event = makeEvent("ASSET_SP_001", "");
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(401);
  });
});
