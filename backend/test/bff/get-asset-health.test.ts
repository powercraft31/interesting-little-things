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

import { handler } from "../../src/bff/handlers/get-asset-health";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(
  assetId: string,
  authHeader: string,
  params: Record<string, string> = {},
): APIGatewayProxyEventV2 {
  const qsParts = Object.entries(params).map(
    ([k, v]) => `${k}=${encodeURIComponent(v)}`,
  );
  const qs = qsParts.join("&");
  const path = `/api/assets/${assetId}/health`;
  return {
    version: "2.0",
    routeKey: `GET ${path}`,
    rawPath: path,
    rawQueryString: qs,
    headers: { authorization: authHeader },
    queryStringParameters: Object.keys(params).length > 0 ? params : undefined,
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

function orgToken(orgId: string = "ORG_001"): string {
  return JSON.stringify({
    userId: "user1",
    orgId,
    role: "ORG_VIEWER",
  });
}

function parseBody(result: APIGatewayProxyStructuredResultV2): {
  success: boolean;
  data: Record<string, unknown>;
  error: string | null;
} {
  return JSON.parse(result.body as string);
}

/**
 * Set up the standard 8-query mock responses.
 * Returns the mock setup for customization.
 */
function setupStandardMocks(overrides: {
  current?: Record<string, unknown>[];
  soc?: Record<string, unknown>[];
  soh?: Record<string, unknown>[];
  temp?: Record<string, unknown>[];
  cycles?: Record<string, unknown>[];
  doEvents?: Record<string, unknown>[];
  asset?: Record<string, unknown>[];
  voltage?: Record<string, unknown>[];
} = {}) {
  // Q1: current state
  mockQueryWithOrg.mockResolvedValueOnce({
    rows: overrides.current ?? [
      {
        battery_soc: 39.9,
        battery_soh: 97.0,
        battery_temperature: 31.2,
        inverter_temp: 42.5,
        bat_work_status: "standby",
      },
    ],
  });
  // Q2: SOC history
  mockQueryWithOrg.mockResolvedValueOnce({
    rows: overrides.soc ?? [
      { t: "2026-01-21T00:00:00-03:00", soc: 50.0 },
      { t: "2026-01-21T00:05:00-03:00", soc: 49.8 },
    ],
  });
  // Q3: SOH trend
  mockQueryWithOrg.mockResolvedValueOnce({
    rows: overrides.soh ?? [
      { day: "2026-01-20", soh: 98.5 },
      { day: "2026-01-21", soh: 98.4 },
    ],
  });
  // Q4: temperature
  mockQueryWithOrg.mockResolvedValueOnce({
    rows: overrides.temp ?? [
      { t: "2026-01-21T00:00:00-03:00", bat_temp: 30.0, inv_temp: 40.0 },
    ],
  });
  // Q5: battery cycles
  mockQueryWithOrg.mockResolvedValueOnce({
    rows: overrides.cycles ?? [{ total_discharge: "450" }],
  });
  // Q6: DO events
  mockQueryWithOrg.mockResolvedValueOnce({
    rows: overrides.doEvents ?? [],
  });
  // Q7: asset capacity
  mockQueryWithOrg.mockResolvedValueOnce({
    rows: overrides.asset ?? [{ capacity_kwh: "10" }],
  });
  // Q8: voltage/current
  mockQueryWithOrg.mockResolvedValueOnce({
    rows: overrides.voltage ?? [
      { t: "2026-01-21T00:00:00-03:00", voltage: 51.2, current: -10.5 },
    ],
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockQueryWithOrg.mockReset();
});

describe("GET /api/assets/:assetId/health", () => {
  it("returns correct current state", async () => {
    setupStandardMocks();

    const event = makeEvent("ASSET_001", adminToken(), {
      from: "2026-01-21T00:00:00-03:00",
      to: "2026-01-22T00:00:00-03:00",
    });
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    const data = parseBody(result).data as Record<string, unknown>;
    const current = data.current as Record<string, unknown>;
    expect(current.soc).toBe(39.9);
    expect(current.soh).toBe(97.0);
    expect(current.batTemp).toBe(31.2);
    expect(current.invTemp).toBe(42.5);
    expect(current.status).toBe("standby");
  });

  it("returns SOC history data", async () => {
    const socRows = Array.from({ length: 10 }, (_, i) => ({
      t: `2026-01-21T${String(i).padStart(2, "0")}:00:00-03:00`,
      soc: 50 - i * 2,
    }));
    setupStandardMocks({ soc: socRows });

    const event = makeEvent("ASSET_001", adminToken(), {
      from: "2026-01-21T00:00:00-03:00",
      to: "2026-01-22T00:00:00-03:00",
    });
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    const data = parseBody(result).data as Record<string, unknown>;
    const socHistory = data.socHistory as unknown[];
    expect(socHistory).toHaveLength(10);
  });

  it("returns SOH trend data", async () => {
    const sohRows = Array.from({ length: 30 }, (_, i) => ({
      day: `2026-01-${String(i + 1).padStart(2, "0")}`,
      soh: 99.0 - i * 0.05,
    }));
    setupStandardMocks({ soh: sohRows });

    const event = makeEvent("ASSET_001", adminToken(), {
      from: "2026-01-01T00:00:00-03:00",
      to: "2026-02-01T00:00:00-03:00",
    });
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    const data = parseBody(result).data as Record<string, unknown>;
    const sohTrend = data.sohTrend as Record<string, unknown>[];
    expect(sohTrend).toHaveLength(30);
    // Decreasing trend
    expect((sohTrend[0] as Record<string, unknown>).soh).toBeGreaterThan(
      (sohTrend[29] as Record<string, unknown>).soh as number,
    );
  });

  it("detects DO events correctly (GW-3 pattern)", async () => {
    const doEvents = [
      {
        event_start: "2026-01-15T18:10:00-03:00",
        event_end: "2026-01-15T20:25:00-03:00",
      },
      {
        event_start: "2026-01-16T18:00:00-03:00",
        event_end: "2026-01-16T19:30:00-03:00",
      },
      {
        event_start: "2026-01-17T18:05:00-03:00",
        event_end: "2026-01-17T20:00:00-03:00",
      },
    ];
    setupStandardMocks({ doEvents });

    const event = makeEvent("ASSET_001", adminToken(), {
      from: "2026-01-15T00:00:00-03:00",
      to: "2026-01-18T00:00:00-03:00",
    });
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    const data = parseBody(result).data as Record<string, unknown>;
    const events = data.doEvents as Record<string, unknown>[];
    expect(events).toHaveLength(3);

    // First event: 18:10 → 20:25 = 135 minutes
    expect(events[0].durationMin).toBe(135);
    // Second event: 18:00 → 19:30 = 90 minutes
    expect(events[1].durationMin).toBe(90);
    // Third event: 18:05 → 20:00 = 115 minutes
    expect(events[2].durationMin).toBe(115);
  });

  it("returns empty doEvents when no DO events exist", async () => {
    setupStandardMocks({ doEvents: [] });

    const event = makeEvent("ASSET_001", adminToken(), {
      from: "2026-01-21T00:00:00-03:00",
      to: "2026-01-22T00:00:00-03:00",
    });
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    const data = parseBody(result).data as Record<string, unknown>;
    expect(data.doEvents).toEqual([]);
  });

  it("calculates battery cycles correctly", async () => {
    // totalDischarge = 450, capacity = 10 → cycles = 45.0
    setupStandardMocks({
      cycles: [{ total_discharge: "450" }],
      asset: [{ capacity_kwh: "10" }],
    });

    const event = makeEvent("ASSET_001", adminToken(), {
      from: "2026-01-01T00:00:00-03:00",
      to: "2026-04-01T00:00:00-03:00",
    });
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    const data = parseBody(result).data as Record<string, unknown>;
    expect(data.batteryCycles).toBe(45.0);
  });

  it("returns 400 when from/to are missing", async () => {
    const event = makeEvent("ASSET_001", adminToken(), {});
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(400);
    const body = parseBody(result);
    expect(body.error).toBe("from and to are required (ISO datetime)");
  });

  it("returns 404 when asset does not exist (RLS isolation)", async () => {
    // All queries return data except Q7 (asset) which returns empty
    setupStandardMocks({ asset: [] });

    const event = makeEvent("ASSET_OTHER_ORG", orgToken("ORG_002"), {
      from: "2026-01-21T00:00:00-03:00",
      to: "2026-01-22T00:00:00-03:00",
    });
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(404);
    const body = parseBody(result);
    expect(body.error).toBe("Asset not found");
  });
});
