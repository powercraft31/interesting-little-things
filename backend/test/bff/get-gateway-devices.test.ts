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

import { handler } from "../../src/bff/handlers/get-gateway-devices";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(
  gatewayId: string,
  authHeader: string,
): APIGatewayProxyEventV2 {
  const path = `/api/gateways/${gatewayId}/devices`;
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

describe("GET /api/gateways/:gatewayId/devices", () => {
  it("returns gateway meta + devices with device_state", async () => {
    // Q1: gateway info
    mockQueryWithOrg.mockResolvedValueOnce({
      rows: [{ gateway_id: "WKRD24070202100144F", name: "Casa Silva · Home-1", status: "online" }],
    });
    // Q2: devices
    mockQueryWithOrg.mockResolvedValueOnce({
      rows: [
        {
          asset_id: "ASSET_SP_001",
          name: "São Paulo - Casa Verde",
          asset_type: "INVERTER_BATTERY",
          brand: "Growatt",
          model: "MIN 5000TL-XH",
          serial_number: "GW-SP001-2024",
          capacidade_kw: 5.2,
          capacity_kwh: 13.5,
          operation_mode: "peak_valley_arbitrage",
          allow_export: null,
          is_active: true,
          battery_soc: 65.0,
          battery_power: -1.8,
          pv_power: 3.2,
          grid_power_kw: 0.0,
          load_power: 5.0,
          inverter_temp: 38.2,
          bat_soh: 98.0,
          telemetry_json: {},
          is_online: true,
        },
        {
          asset_id: "DEV-007",
          name: "Casa Silva - Smart Meter 1",
          asset_type: "SMART_METER",
          brand: "Landis+Gyr",
          model: "E450",
          serial_number: "LG-007",
          capacidade_kw: 0.0,
          capacity_kwh: 0.0,
          operation_mode: "self_consumption",
          allow_export: null,
          is_active: true,
          battery_soc: null,
          battery_power: 0,
          pv_power: 0,
          grid_power_kw: 0,
          load_power: 3.2,
          inverter_temp: null,
          bat_soh: null,
          telemetry_json: { consumption: 3.2, voltage: 220, current: 14.5, powerFactor: 0.92 },
          is_online: true,
        },
      ],
    });

    const event = makeEvent("WKRD24070202100144F", adminToken());
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    const body = parseBody(result);
    expect(body.success).toBe(true);

    // Gateway meta
    expect(body.data).toHaveProperty("gateway");
    const gw = body.data.gateway as Record<string, unknown>;
    expect(gw).toHaveProperty("gatewayId", "WKRD24070202100144F");
    expect(gw).toHaveProperty("status", "online");

    // Devices
    expect(body.data).toHaveProperty("devices");
    const devices = body.data.devices as Array<Record<string, unknown>>;
    expect(devices).toHaveLength(2);
    expect(devices[0]).toHaveProperty("assetId", "ASSET_SP_001");
    expect(devices[0]).toHaveProperty("assetType", "INVERTER_BATTERY");

    // v5.18 device_state fields
    const state = devices[0].state as Record<string, unknown>;
    expect(state).toHaveProperty("batterySoc", 65.0);
    expect(state).toHaveProperty("batSoh", 98.0);
    expect(state).toHaveProperty("isOnline", true);
  });

  it("returns empty device list for Test Gateway (no devices)", async () => {
    mockQueryWithOrg
      .mockResolvedValueOnce({
        rows: [{ gateway_id: "WKRD24070202100141I", name: "Test Gateway", status: "online" }],
      })
      .mockResolvedValueOnce({ rows: [] });

    const event = makeEvent("WKRD24070202100141I", adminToken());
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    const body = parseBody(result);
    const devices = body.data.devices as Array<unknown>;
    expect(devices).toHaveLength(0);
  });

  it("returns 404 when gateway does not exist", async () => {
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [] });

    const event = makeEvent("NONEXISTENT_GW", adminToken());
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(404);
  });

  it("RLS: non-admin gets orgId passed to queryWithOrg", async () => {
    mockQueryWithOrg
      .mockResolvedValueOnce({
        rows: [{ gateway_id: "WKRD24070202100144F", name: "Casa Silva", status: "online" }],
      })
      .mockResolvedValueOnce({ rows: [] });

    const event = makeEvent("WKRD24070202100144F", orgToken("ORG_ENERGIA_001"));
    await handler(event);

    // Both calls should have orgId for RLS
    expect(mockQueryWithOrg.mock.calls[0][2]).toBe("ORG_ENERGIA_001");
    expect(mockQueryWithOrg.mock.calls[1][2]).toBe("ORG_ENERGIA_001");
  });

  it("returns 401 with empty auth", async () => {
    const event = makeEvent("WKRD24070202100144F", "");
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(401);
  });
});
