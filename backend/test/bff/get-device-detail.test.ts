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

import { handler } from "../../src/bff/handlers/get-device-detail";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(
  assetId: string,
  authHeader: string,
): APIGatewayProxyEventV2 {
  const path = `/api/devices/${assetId}`;
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

describe("GET /api/devices/:assetId", () => {
  it("returns full device detail (device + state + telemetryExtra + config)", async () => {
    // Q1: asset + gateway
    mockQueryWithOrg.mockResolvedValueOnce({
      rows: [{
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
        retail_buy_rate_kwh: null,
        retail_sell_rate_kwh: null,
        gateway_id: "WKRD24070202100144F",
        gateway_name: "Casa Silva · Home-1",
        gateway_status: "online",
      }],
    });
    // Q2: device_state
    mockQueryWithOrg.mockResolvedValueOnce({
      rows: [{
        asset_id: "ASSET_SP_001",
        battery_soc: 65.0,
        bat_soh: 98.0,
        battery_power: -1.8,
        pv_power: 3.2,
        grid_power_kw: 0.0,
        load_power: 5.0,
        inverter_temp: 38.2,
        is_online: true,
        updated_at: "2026-03-10T12:00:00Z",
      }],
    });
    // Q3: telemetry_history (latest)
    mockQueryWithOrg.mockResolvedValueOnce({
      rows: [{
        battery_soh: 97.5,
        battery_voltage: 51.6,
        battery_current: -3.5,
        battery_temperature: 32.0,
        flload_power: 4.8,
        inverter_temp: 37.8,
        max_charge_current: 25.0,
        max_discharge_current: 25.0,
        telemetry_extra: {
          gridVoltageR: 220.5,
          gridCurrentR: 8.2,
          gridPf: 0.95,
          totalBuyKwh: 1234.5,
          totalSellKwh: 567.8,
        },
      }],
    });
    // Q4: vpp_strategies
    mockQueryWithOrg.mockResolvedValueOnce({
      rows: [{
        min_soc: 20,
        max_soc: 95,
        max_charge_rate_kw: 5.0,
      }],
    });

    const event = makeEvent("ASSET_SP_001", adminToken());
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    const body = parseBody(result);
    expect(body.success).toBe(true);

    // device
    const device = body.data.device as Record<string, unknown>;
    expect(device).toHaveProperty("assetId", "ASSET_SP_001");
    expect(device).toHaveProperty("gatewayId", "WKRD24070202100144F");
    expect(device).toHaveProperty("gatewayName", "Casa Silva · Home-1");
    expect(device).toHaveProperty("gatewayStatus", "online");

    // state — v5.18 telemetry fields
    const state = body.data.state as Record<string, unknown>;
    expect(state).toHaveProperty("batterySoc", 65.0);
    expect(state).toHaveProperty("batSoh", 97.5); // from telemetry_history
    expect(state).toHaveProperty("batteryVoltage", 51.6);
    expect(state).toHaveProperty("batteryCurrent", -3.5);
    expect(state).toHaveProperty("batteryTemperature", 32.0);
    expect(state).toHaveProperty("flloadPower", 4.8);
    expect(state).toHaveProperty("maxChargeCurrent", 25.0);
    expect(state).toHaveProperty("maxDischargeCurrent", 25.0);
    expect(state).toHaveProperty("isOnline", true);

    // telemetryExtra (energyFlow)
    const extra = body.data.telemetryExtra as Record<string, unknown>;
    expect(extra).toHaveProperty("gridVoltageR", 220.5);
    expect(extra).toHaveProperty("totalBuyKwh", 1234.5);
    expect(extra).toHaveProperty("totalSellKwh", 567.8);

    // config with defaults from vpp_strategies
    const config = body.data.config as Record<string, unknown>;
    expect(config).toHaveProperty("socMin", 20);
    expect(config).toHaveProperty("socMax", 95);
    expect(config).toHaveProperty("maxChargeRateKw", 5.0);
    const defaults = config.defaults as Record<string, unknown>;
    expect(defaults).toHaveProperty("socMin", 20);
    expect(defaults).toHaveProperty("socMax", 95);
    expect(defaults).toHaveProperty("source", "vpp_strategies");
  });

  it("returns 404 when asset does not exist", async () => {
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [] });

    const event = makeEvent("NONEXISTENT_ASSET", adminToken());
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(404);
  });

  it("returns default config when no vpp_strategies exist", async () => {
    // Q1: asset
    mockQueryWithOrg.mockResolvedValueOnce({
      rows: [{
        asset_id: "ASSET_SP_001",
        name: "Test",
        asset_type: "INVERTER_BATTERY",
        brand: "Growatt",
        model: "MIN 5000TL-XH",
        serial_number: null,
        capacidade_kw: 5.2,
        capacity_kwh: 13.5,
        operation_mode: "self_consumption",
        allow_export: null,
        retail_buy_rate_kwh: null,
        retail_sell_rate_kwh: null,
        gateway_id: "WKRD24070202100144F",
        gateway_name: "Casa Silva",
        gateway_status: "online",
      }],
    });
    // Q2: device_state — empty
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [] });
    // Q3: telemetry_history — empty
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [] });
    // Q4: vpp_strategies — empty
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [] });

    const event = makeEvent("ASSET_SP_001", adminToken());
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    const body = parseBody(result);

    const config = body.data.config as Record<string, unknown>;
    // Falls back to hardcoded defaults
    expect(config).toHaveProperty("socMin", 20);
    expect(config).toHaveProperty("socMax", 95);
    const defaults = config.defaults as Record<string, unknown>;
    expect(defaults).toHaveProperty("socMin", 20);
    expect(defaults).toHaveProperty("socMax", 95);
  });

  it("returns 401 with empty auth", async () => {
    const event = makeEvent("ASSET_SP_001", "");
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(401);
  });
});
