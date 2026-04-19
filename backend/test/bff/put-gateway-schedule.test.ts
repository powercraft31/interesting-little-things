import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";

const mockQueryWithOrg = jest.fn();
jest.mock("../../src/shared/db", () => ({
  queryWithOrg: (...args: unknown[]) => mockQueryWithOrg(...args),
  getAppPool: jest.fn(),
  getServicePool: jest.fn(),
  closeAllPools: jest.fn().mockResolvedValue(undefined),
}));

import { handler } from "../../src/bff/handlers/put-gateway-schedule";

function makeEvent(
  gatewayId: string,
  authHeader: string,
  body?: string,
): APIGatewayProxyEventV2 {
  const path = `/api/gateways/${gatewayId}/schedule`;
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

function managerToken(): string {
  return JSON.stringify({
    userId: "u1",
    orgId: "ORG_ENERGIA_001",
    role: "ORG_MANAGER",
  });
}

function parseBody(result: APIGatewayProxyStructuredResultV2): {
  success: boolean;
  data: Record<string, unknown> | null;
  error?: string;
} {
  return JSON.parse(result.body as string);
}

const validSchedule = JSON.stringify({
  socMinLimit: 20,
  socMaxLimit: 95,
  maxChargeCurrent: 50,
  maxDischargeCurrent: 50,
  gridImportLimitKw: 30,
  slots: [
    { startMinute: 0, endMinute: 720, purpose: "self_consumption" },
    {
      startMinute: 720,
      endMinute: 1440,
      purpose: "tariff",
      direction: "charge",
    },
  ],
});

beforeEach(() => {
  mockQueryWithOrg.mockReset();
});

describe("PUT /api/gateways/:gatewayId/schedule", () => {
  it("202 Accepted — inserts a hot-table pending command", async () => {
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [] });
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [{ gateway_id: "GW-1" }] });
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [] });
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [{ id: 42 }] });

    const result = (await handler(
      makeEvent("GW-1", managerToken(), validSchedule),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(202);
    const body = parseBody(result);
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty("commandId", 42);
    expect(body.data).toHaveProperty("status", "pending");

    const activeCheckCall = mockQueryWithOrg.mock.calls[2];
    expect(activeCheckCall[0]).toContain("FROM device_command_logs");
    expect(activeCheckCall[0]).toContain(
      "result IN ('pending', 'dispatched', 'accepted')",
    );
    expect(activeCheckCall[0]).not.toContain("device_command_logs_archive");

    const insertCall = mockQueryWithOrg.mock.calls[3];
    expect(insertCall[0]).toContain("INSERT INTO device_command_logs");
    expect(insertCall[0]).toContain("'pending'");
    expect(insertCall[0]).not.toContain("device_command_logs_archive");
    const payload = JSON.parse(insertCall[1][1]);
    expect(payload.slots).toHaveLength(2);
  });

  it("409 — accepted command is still treated as active, not terminal", async () => {
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [] });
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [{ gateway_id: "GW-1" }] });
    mockQueryWithOrg.mockResolvedValueOnce({
      rows: [{ id: 9, result: "accepted" }],
    });

    const result = (await handler(
      makeEvent("GW-1", managerToken(), validSchedule),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(409);
    const body = parseBody(result);
    expect(body.success).toBe(false);
    expect(body.error).toContain("status=accepted");
    expect(mockQueryWithOrg).toHaveBeenCalledTimes(3);
  });
});
