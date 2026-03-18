import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";

// ---------------------------------------------------------------------------
// Mock queryWithOrg before importing handlers
// ---------------------------------------------------------------------------

const mockQueryWithOrg = jest.fn();
jest.mock("../../src/shared/db", () => ({
  queryWithOrg: (...args: unknown[]) => mockQueryWithOrg(...args),
  getAppPool: jest.fn(),
  getServicePool: jest.fn(),
  closeAllPools: jest.fn().mockResolvedValue(undefined),
}));

import { handler as getGatewaysHandler } from "../../src/bff/handlers/get-gateways";
import { handler as patchHomeAliasHandler } from "../../src/bff/handlers/patch-gateway-home-alias";
import { handler as getGatewayDetailHandler } from "../../src/bff/handlers/get-gateway-detail";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(
  method: string,
  path: string,
  authHeader: string,
  opts?: { body?: string },
): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: `${method} ${path}`,
    rawPath: path,
    rawQueryString: "",
    headers: { authorization: authHeader },
    body: opts?.body,
    requestContext: {
      accountId: "test",
      apiId: "test",
      domainName: "test",
      domainPrefix: "test",
      http: {
        method,
        path,
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "test",
      },
      requestId: "test-1",
      routeKey: `${method} ${path}`,
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
    orgId: "ORG_001",
    role: "SOLFACIL_ADMIN",
  });
}

function managerToken(orgId = "ORG_001"): string {
  return JSON.stringify({ userId: "u1", orgId, role: "ORG_MANAGER" });
}

function operatorToken(orgId = "ORG_001"): string {
  return JSON.stringify({ userId: "u2", orgId, role: "ORG_OPERATOR" });
}

function viewerToken(orgId = "ORG_001"): string {
  return JSON.stringify({ userId: "u3", orgId, role: "ORG_VIEWER" });
}

function parseBody(result: unknown): {
  success: boolean;
  data: Record<string, unknown>;
  error?: string;
} {
  const r = result as { body: string };
  return JSON.parse(r.body);
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockQueryWithOrg.mockReset();
});

// ===========================================================================
// GET /api/gateways — homeAlias + batterySoc extensions
// ===========================================================================

describe("GET /api/gateways (v6.2 extensions)", () => {
  const baseRow = {
    gateway_id: "GW-001",
    name: "Casa Silva",
    org_id: "ORG_001",
    org_name: "Pilot Corp",
    status: "online",
    last_seen_at: "2026-03-10T12:00:00Z",
    ems_health: {},
    contracted_demand_kw: 15.0,
    device_count: 3,
  };

  it("returns homeAlias from home_alias when set", async () => {
    mockQueryWithOrg.mockResolvedValueOnce({
      rows: [{ ...baseRow, home_alias: "Minha Casa", battery_soc: 85.5 }],
    });

    const event = makeEvent("GET", "/api/gateways", adminToken());
    const result = (await getGatewaysHandler(
      event,
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    const body = parseBody(result);
    const gateways = body.data.gateways as Array<Record<string, unknown>>;
    expect(gateways).toHaveLength(1);
    expect(gateways[0]).toHaveProperty("homeAlias", "Minha Casa");
    expect(gateways[0]).toHaveProperty("batterySoc", 85.5);
    expect(gateways[0]).toHaveProperty("name", "Casa Silva");
  });

  it("falls back homeAlias to gateway name when home_alias is null", async () => {
    mockQueryWithOrg.mockResolvedValueOnce({
      rows: [{ ...baseRow, home_alias: null, battery_soc: null }],
    });

    const event = makeEvent("GET", "/api/gateways", adminToken());
    const result = (await getGatewaysHandler(
      event,
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    const body = parseBody(result);
    const gateways = body.data.gateways as Array<Record<string, unknown>>;
    expect(gateways[0]).toHaveProperty("homeAlias", "Casa Silva");
  });

  it("returns batterySoc as null when offline (no device_state)", async () => {
    mockQueryWithOrg.mockResolvedValueOnce({
      rows: [
        { ...baseRow, status: "offline", home_alias: null, battery_soc: null },
      ],
    });

    const event = makeEvent("GET", "/api/gateways", adminToken());
    const result = (await getGatewaysHandler(
      event,
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    const body = parseBody(result);
    const gateways = body.data.gateways as Array<Record<string, unknown>>;
    expect(gateways[0]).toHaveProperty("batterySoc", null);
    expect(gateways[0]).toHaveProperty("status", "offline");
  });

  it("returns complete gateway list for client-side filtering", async () => {
    mockQueryWithOrg.mockResolvedValueOnce({
      rows: [
        {
          ...baseRow,
          gateway_id: "GW-001",
          home_alias: "Casa A",
          battery_soc: 80,
        },
        {
          ...baseRow,
          gateway_id: "GW-002",
          name: "Casa B",
          home_alias: null,
          battery_soc: 60,
        },
        {
          ...baseRow,
          gateway_id: "GW-003",
          name: "Casa C",
          home_alias: "Meu Lar",
          battery_soc: null,
        },
      ],
    });

    const event = makeEvent("GET", "/api/gateways", adminToken());
    const result = (await getGatewaysHandler(
      event,
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    const body = parseBody(result);
    const gateways = body.data.gateways as Array<Record<string, unknown>>;
    expect(gateways).toHaveLength(3);
    // Each gateway has the required fields for the object locator
    for (const gw of gateways) {
      expect(gw).toHaveProperty("gatewayId");
      expect(gw).toHaveProperty("name");
      expect(gw).toHaveProperty("homeAlias");
      expect(gw).toHaveProperty("status");
      expect(gw).toHaveProperty("batterySoc");
    }
  });
});

// ===========================================================================
// PATCH /api/gateways/:id/home-alias
// ===========================================================================

describe("PATCH /api/gateways/:id/home-alias", () => {
  it("successfully updates home_alias (admin)", async () => {
    // gwCheck
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [{ "1": 1 }] });
    // UPDATE
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [] });

    const event = makeEvent(
      "PATCH",
      "/api/gateways/GW-001/home-alias",
      adminToken(),
      { body: JSON.stringify({ homeAlias: "Casa Nova" }) },
    );
    const result = (await patchHomeAliasHandler(
      event,
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(204);
    expect(mockQueryWithOrg).toHaveBeenCalledTimes(2);
    // Second call should be the UPDATE
    expect(mockQueryWithOrg.mock.calls[1][0]).toContain(
      "UPDATE gateways SET home_alias",
    );
    expect(mockQueryWithOrg.mock.calls[1][1]).toEqual(["Casa Nova", "GW-001"]);
  });

  it("successfully updates home_alias (manager)", async () => {
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [{ "1": 1 }] });
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [] });

    const event = makeEvent(
      "PATCH",
      "/api/gateways/GW-001/home-alias",
      managerToken(),
      { body: JSON.stringify({ homeAlias: "Minha Casa" }) },
    );
    const result = (await patchHomeAliasHandler(
      event,
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(204);
  });

  it("returns 400 for empty homeAlias", async () => {
    const event = makeEvent(
      "PATCH",
      "/api/gateways/GW-001/home-alias",
      adminToken(),
      { body: JSON.stringify({ homeAlias: "   " }) },
    );
    const result = (await patchHomeAliasHandler(
      event,
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(400);
    const body = parseBody(result);
    expect(body.error).toContain("empty");
  });

  it("returns 400 for homeAlias exceeding 100 characters", async () => {
    const event = makeEvent(
      "PATCH",
      "/api/gateways/GW-001/home-alias",
      adminToken(),
      { body: JSON.stringify({ homeAlias: "A".repeat(101) }) },
    );
    const result = (await patchHomeAliasHandler(
      event,
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(400);
    const body = parseBody(result);
    expect(body.error).toContain("100");
  });

  it("returns 400 for non-string homeAlias", async () => {
    const event = makeEvent(
      "PATCH",
      "/api/gateways/GW-001/home-alias",
      adminToken(),
      { body: JSON.stringify({ homeAlias: 123 }) },
    );
    const result = (await patchHomeAliasHandler(
      event,
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(400);
  });

  it("returns 403 for ORG_OPERATOR role", async () => {
    const event = makeEvent(
      "PATCH",
      "/api/gateways/GW-001/home-alias",
      operatorToken(),
      { body: JSON.stringify({ homeAlias: "Test" }) },
    );
    const result = (await patchHomeAliasHandler(
      event,
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(403);
  });

  it("returns 403 for ORG_VIEWER role", async () => {
    const event = makeEvent(
      "PATCH",
      "/api/gateways/GW-001/home-alias",
      viewerToken(),
      { body: JSON.stringify({ homeAlias: "Test" }) },
    );
    const result = (await patchHomeAliasHandler(
      event,
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(403);
  });

  it("returns 404 for non-existent gateway", async () => {
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [] });

    const event = makeEvent(
      "PATCH",
      "/api/gateways/GW-NONEXIST/home-alias",
      adminToken(),
      { body: JSON.stringify({ homeAlias: "Test" }) },
    );
    const result = (await patchHomeAliasHandler(
      event,
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(404);
  });

  it("trims whitespace from homeAlias", async () => {
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [{ "1": 1 }] });
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [] });

    const event = makeEvent(
      "PATCH",
      "/api/gateways/GW-001/home-alias",
      adminToken(),
      { body: JSON.stringify({ homeAlias: "  Casa Limpa  " }) },
    );
    const result = (await patchHomeAliasHandler(
      event,
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(204);
    expect(mockQueryWithOrg.mock.calls[1][1]).toEqual(["Casa Limpa", "GW-001"]);
  });
});

// ===========================================================================
// syncStatus normalization parity
// ===========================================================================

describe("syncStatus normalization parity (detail vs schedule)", () => {
  // Helper to build a detail event and mock data for syncStatus testing
  async function getDetailSyncStatus(commandResult: string): Promise<string> {
    const gatewayRow = {
      gateway_id: "GW-001",
      name: "Test GW",
      status: "online",
      last_seen_at: "2026-03-10T12:00:00Z",
      contracted_demand_kw: null,
      ems_health: null,
      asset_id: null,
      device_name: null,
      asset_type: null,
      brand: null,
      model: null,
      serial_number: null,
      capacidade_kw: null,
      capacity_kwh: null,
      operation_mode: null,
      allow_export: null,
      rated_max_power_kw: null,
      battery_soc: null,
      bat_soh: null,
      battery_voltage: null,
      battery_power: null,
      pv_power: null,
      grid_power_kw: null,
      load_power: null,
      inverter_temp: null,
      is_online: null,
      updated_at: null,
    };

    // Q1: gateway + devices
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [gatewayRow] });
    // Q2: telemetry extras
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [] });
    // Q4: latest set command
    mockQueryWithOrg.mockResolvedValueOnce({
      rows: [
        {
          id: 1,
          payload_json: { slots: [] },
          result: commandResult,
          resolved_at: null,
          created_at: "2026-03-10T12:00:00Z",
        },
      ],
    });

    const event = makeEvent("GET", "/api/gateways/GW-001/detail", adminToken());
    const result = (await getGatewayDetailHandler(
      event,
    )) as APIGatewayProxyStructuredResultV2;
    const body = parseBody(result);
    const schedule = (body.data as Record<string, unknown>).schedule as Record<
      string,
      unknown
    >;
    return schedule.syncStatus as string;
  }

  it.each([
    ["success", "synced"],
    ["pending", "pending"],
    ["pending_dispatch", "pending"],
    ["dispatched", "pending"],
    ["accepted", "pending"],
    ["failed", "failed"],
    ["timeout", "failed"],
    ["some_random_value", "unknown"],
  ])(
    "detail handler maps result=%s to syncStatus=%s (matching schedule handler)",
    async (commandResult, expectedSyncStatus) => {
      const actual = await getDetailSyncStatus(commandResult);
      expect(actual).toBe(expectedSyncStatus);
    },
  );
});
