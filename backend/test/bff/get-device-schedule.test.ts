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

import { handler } from "../../src/bff/handlers/get-device-schedule";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(
  assetId: string,
  authHeader: string,
): APIGatewayProxyEventV2 {
  const path = `/api/devices/${assetId}/schedule`;
  return {
    version: "2.0",
    routeKey: `GET ${path}`,
    rawPath: path,
    rawQueryString: "",
    headers: { authorization: authHeader },
    requestContext: {
      accountId: "test",
      apiId: "test",
      domainName: "test",
      domainPrefix: "test",
      http: {
        method: "GET",
        path,
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "test",
      },
      requestId: "test-1",
      routeKey: `GET ${path}`,
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

describe("GET /api/devices/:assetId/schedule", () => {
  it("returns synced schedule with slots when success record exists", async () => {
    mockQueryWithOrg.mockResolvedValueOnce({
      rows: [{
        payload_json: {
          slots: [
            { startHour: 0, endHour: 6, mode: "self_consumption" },
            { startHour: 6, endHour: 17, mode: "peak_valley_arbitrage" },
            { startHour: 17, endHour: 24, mode: "peak_shaving" },
          ],
        },
        created_at: "2026-03-10T10:00:00Z",
        result: "success",
      }],
    });

    const event = makeEvent("ASSET_SP_001", adminToken());
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    const body = parseBody(result);
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty("syncStatus", "synced");
    expect(body.data).toHaveProperty("lastAckAt");
    expect(body.data.lastAckAt).toBeTruthy();

    const slots = body.data.slots as Array<Record<string, unknown>>;
    expect(slots).toHaveLength(3);
    expect(slots[0]).toHaveProperty("startHour", 0);
    expect(slots[0]).toHaveProperty("mode", "self_consumption");
  });

  it("returns empty slots with unknown status when no records exist", async () => {
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [] });

    const event = makeEvent("ASSET_SP_001", adminToken());
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    const body = parseBody(result);
    expect(body.data).toHaveProperty("syncStatus", "unknown");
    expect(body.data).toHaveProperty("lastAckAt", null);
    expect(body.data.slots).toEqual([]);
  });

  it("returns pending status for pending_dispatch record", async () => {
    mockQueryWithOrg.mockResolvedValueOnce({
      rows: [{
        payload_json: {
          slots: [{ startHour: 0, endHour: 24, mode: "self_consumption" }],
        },
        created_at: "2026-03-10T15:00:00Z",
        result: "pending_dispatch",
      }],
    });

    const event = makeEvent("ASSET_SP_001", adminToken());
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    const body = parseBody(result);
    expect(body.data).toHaveProperty("syncStatus", "pending");
    expect(body.data).toHaveProperty("lastAckAt", null);
    expect((body.data.slots as Array<unknown>)).toHaveLength(1);
  });

  it("returns 401 with empty auth", async () => {
    const event = makeEvent("ASSET_SP_001", "");
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(401);
  });
});
