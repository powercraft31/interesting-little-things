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

import { handler } from "../../src/bff/handlers/get-hems-batch-history";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(
  authHeader: string,
  queryParams?: Record<string, string>,
): APIGatewayProxyEventV2 {
  const path = "/api/hems/batch-history";
  return {
    version: "2.0",
    routeKey: `GET ${path}`,
    rawPath: path,
    rawQueryString: "",
    headers: { authorization: authHeader },
    queryStringParameters: queryParams,
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
  return JSON.stringify({
    userId: "admin",
    orgId: "ORG_ENERGIA_001",
    role: "SOLFACIL_ADMIN",
  });
}

function viewerToken(): string {
  return JSON.stringify({
    userId: "u1",
    orgId: "ORG_ENERGIA_001",
    role: "ORG_VIEWER",
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

describe("GET /api/hems/batch-history", () => {
  it("returns grouped batch history", async () => {
    mockQueryWithOrg.mockResolvedValueOnce({
      rows: [
        {
          batch_id: "batch-123-abcd",
          source: "p4",
          dispatched_at: "2026-03-10T14:30:00Z",
          total: "3",
          success_count: "2",
          failed_count: "0",
          gateways: [
            { gatewayId: "GW-1", result: "accepted" },
            { gatewayId: "GW-2", result: "accepted" },
            { gatewayId: "GW-3", result: "pending" },
          ],
          sample_payload: {
            socMinLimit: 20,
            socMaxLimit: 95,
            slots: [
              { mode: "self_consumption", startMinute: 0, endMinute: 1440 },
            ],
          },
        },
      ],
    });

    const event = makeEvent(adminToken());
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    const body = parseBody(result);
    expect(body.success).toBe(true);
    const batches = (body.data as Record<string, unknown>).batches as Array<
      Record<string, unknown>
    >;
    expect(batches).toHaveLength(1);
    expect(batches[0].batchId).toBe("batch-123-abcd");
    expect(batches[0].source).toBe("p4");
    expect(batches[0].total).toBe(3);
    expect(batches[0].successCount).toBe(2);
    expect(batches[0].failedCount).toBe(0);
    expect(batches[0].gateways).toHaveLength(3);
    expect(batches[0].samplePayload).toHaveProperty("socMinLimit", 20);
  });

  it("limit parameter is used", async () => {
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [] });

    const event = makeEvent(adminToken(), { limit: "5" });
    await handler(event);

    const sql = mockQueryWithOrg.mock.calls[0][0] as string;
    expect(sql).toContain("LIMIT $1");
    const params = mockQueryWithOrg.mock.calls[0][1] as unknown[];
    expect(params[0]).toBe(5);
  });

  it("limit > 100 is capped to 100", async () => {
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [] });

    const event = makeEvent(adminToken(), { limit: "500" });
    await handler(event);

    const params = mockQueryWithOrg.mock.calls[0][1] as unknown[];
    expect(params[0]).toBe(100);
  });

  it("no batch records — returns empty array", async () => {
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [] });

    const event = makeEvent(adminToken());
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    const body = parseBody(result);
    const batches = (body.data as Record<string, unknown>).batches as Array<
      Record<string, unknown>
    >;
    expect(batches).toHaveLength(0);
  });

  it("org filtering — non-admin passes orgId", async () => {
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [] });

    const event = makeEvent(viewerToken());
    await handler(event);

    const params = mockQueryWithOrg.mock.calls[0][1] as unknown[];
    expect(params[1]).toBe("ORG_ENERGIA_001");
  });

  it("org filtering — admin is tenant-scoped (no bypass)", async () => {
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [] });

    const event = makeEvent(adminToken());
    await handler(event);

    const params = mockQueryWithOrg.mock.calls[0][1] as unknown[];
    expect(params[1]).toBe("ORG_ENERGIA_001");
  });

  it("401 — empty auth header", async () => {
    const event = makeEvent("");
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(401);
  });

  it("SQL contains JOIN gateways for org filtering", async () => {
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [] });

    const event = makeEvent(adminToken());
    await handler(event);

    const sql = mockQueryWithOrg.mock.calls[0][0] as string;
    expect(sql).toContain("JOIN gateways");
    expect(sql).toContain("batch_id IS NOT NULL");
    expect(sql).toContain("GROUP BY dcl.batch_id");
    expect(sql).toContain("ORDER BY MIN(dcl.created_at) DESC");
  });
});
