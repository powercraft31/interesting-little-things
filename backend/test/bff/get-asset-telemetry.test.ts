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

import { handler } from "../../src/bff/handlers/get-asset-telemetry";

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
  const path = `/api/assets/${assetId}/telemetry`;
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
    orgId: "SOLFACIL",
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

/** Generate N 5-min data points starting from `from` */
function generate5minRows(from: string, count: number) {
  const start = new Date(from);
  const rows = [];
  for (let i = 0; i < count; i++) {
    const t = new Date(start.getTime() + i * 5 * 60 * 1000);
    rows.push({
      t: t.toISOString(),
      pv_power: 2.5,
      load_power: 1.8,
      battery_power: 0.3,
      grid_power_kw: -0.4,
      battery_soc: 65.0,
      grid_import_kwh: 0.02,
      grid_export_kwh: 0.01,
    });
  }
  return rows;
}

const defaultTariff = {
  peak_rate: "0.95",
  offpeak_rate: "0.55",
  feed_in_rate: "0.25",
  intermediate_rate: "0.72",
  peak_start: "18:00",
  peak_end: "21:00",
  intermediate_start: "17:00",
  intermediate_end: "22:00",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockQueryWithOrg.mockReset();
});

describe("GET /api/assets/:assetId/telemetry", () => {
  it("returns 288 points for 5min resolution (one day)", async () => {
    const rows = generate5minRows("2026-01-21T00:00:00-03:00", 288);
    // Q1: points (5min)
    mockQueryWithOrg.mockResolvedValueOnce({ rows });
    // Q2: summary
    mockQueryWithOrg.mockResolvedValueOnce({
      rows: [
        {
          pv_total: "19.94",
          load_total: "32.5",
          grid_import_total: "15.2",
          grid_export_total: "2.7",
          peak_demand: "3.14",
        },
      ],
    });
    // Q3: tariff
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [defaultTariff] });
    // Q4: raw for savings
    mockQueryWithOrg.mockResolvedValueOnce({
      rows: rows.map((r) => ({
        recorded_at: r.t,
        load_power: r.pv_power,
        grid_import_kwh: r.grid_import_kwh,
        grid_export_kwh: r.grid_export_kwh,
      })),
    });

    const event = makeEvent("ASSET_001", adminToken(), {
      from: "2026-01-21T00:00:00-03:00",
      to: "2026-01-22T00:00:00-03:00",
      resolution: "5min",
    });
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    const body = parseBody(result);
    expect(body.success).toBe(true);
    const data = body.data as Record<string, unknown>;
    const points = data.points as unknown[];
    expect(points).toHaveLength(288);
  });

  it("returns 24 points for hour resolution", async () => {
    const hourRows = Array.from({ length: 24 }, (_, i) => ({
      t: `2026-01-21T${String(i).padStart(2, "0")}:00:00-03:00`,
      pv_power: "2.5",
      load_power: "1.8",
      battery_power: "0.3",
      grid_power_kw: "-0.4",
      battery_soc: "65.0",
      grid_import_kwh: "0.24",
      grid_export_kwh: "0.12",
    }));
    mockQueryWithOrg.mockResolvedValueOnce({ rows: hourRows });
    mockQueryWithOrg.mockResolvedValueOnce({
      rows: [
        {
          pv_total: "19.94",
          load_total: "32.5",
          grid_import_total: "15.2",
          grid_export_total: "2.7",
          peak_demand: "3.14",
        },
      ],
    });
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [defaultTariff] });
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [] });

    const event = makeEvent("ASSET_001", adminToken(), {
      from: "2026-01-21T00:00:00-03:00",
      to: "2026-01-22T00:00:00-03:00",
      resolution: "hour",
    });
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    const data = parseBody(result).data as Record<string, unknown>;
    const points = data.points as unknown[];
    expect(points).toHaveLength(24);
  });

  it("returns 7 points for day resolution (7 days)", async () => {
    const dayRows = Array.from({ length: 7 }, (_, i) => ({
      t: `2026-01-${String(21 + i).padStart(2, "0")}T00:00:00-03:00`,
      pv_total: "19.94",
      load_total: "32.5",
      grid_import: "15.2",
      grid_export: "2.7",
      charge: "5.0",
      discharge: "4.5",
      avg_soc: "60.0",
    }));
    mockQueryWithOrg.mockResolvedValueOnce({ rows: dayRows });
    mockQueryWithOrg.mockResolvedValueOnce({
      rows: [
        {
          pv_total: "139.58",
          load_total: "227.5",
          grid_import_total: "106.4",
          grid_export_total: "18.9",
          peak_demand: "3.14",
        },
      ],
    });
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [defaultTariff] });
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [] });

    const event = makeEvent("ASSET_001", adminToken(), {
      from: "2026-01-21T00:00:00-03:00",
      to: "2026-01-28T00:00:00-03:00",
      resolution: "day",
    });
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    const data = parseBody(result).data as Record<string, unknown>;
    const points = data.points as unknown[];
    expect(points).toHaveLength(7);
    // Day resolution should have pvTotal, loadTotal etc
    const pt = points[0] as Record<string, unknown>;
    expect(pt).toHaveProperty("pvTotal", 19.94);
    expect(pt).toHaveProperty("avgSoc", 60.0);
  });

  it("returns 3 points for month resolution", async () => {
    const monthRows = [
      {
        t: "2025-12-01T00:00:00-03:00",
        pv_total: "500",
        load_total: "600",
        grid_import: "200",
        grid_export: "100",
        charge: "150",
        discharge: "140",
      },
      {
        t: "2026-01-01T00:00:00-03:00",
        pv_total: "480",
        load_total: "580",
        grid_import: "190",
        grid_export: "90",
        charge: "140",
        discharge: "130",
      },
      {
        t: "2026-02-01T00:00:00-03:00",
        pv_total: "450",
        load_total: "550",
        grid_import: "180",
        grid_export: "80",
        charge: "130",
        discharge: "120",
      },
    ];
    mockQueryWithOrg.mockResolvedValueOnce({ rows: monthRows });
    mockQueryWithOrg.mockResolvedValueOnce({
      rows: [
        {
          pv_total: "1430",
          load_total: "1730",
          grid_import_total: "570",
          grid_export_total: "270",
          peak_demand: "4.2",
        },
      ],
    });
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [defaultTariff] });
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [] });

    const event = makeEvent("ASSET_001", adminToken(), {
      from: "2025-12-01T00:00:00-03:00",
      to: "2026-03-01T00:00:00-03:00",
      resolution: "month",
    });
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    const data = parseBody(result).data as Record<string, unknown>;
    const points = data.points as unknown[];
    expect(points).toHaveLength(3);
  });

  it("computes summary selfConsumption correctly (0-100%)", async () => {
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [] });
    mockQueryWithOrg.mockResolvedValueOnce({
      rows: [
        {
          pv_total: "20",
          load_total: "30",
          grid_import_total: "12",
          grid_export_total: "3",
          peak_demand: "3.14",
        },
      ],
    });
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [defaultTariff] });
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [] });
    // asset exists check
    mockQueryWithOrg.mockResolvedValueOnce({
      rows: [{ asset_id: "ASSET_001" }],
    });

    const event = makeEvent("ASSET_001", adminToken(), {
      from: "2026-01-21T00:00:00-03:00",
      to: "2026-01-22T00:00:00-03:00",
    });
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;
    const data = parseBody(result).data as Record<string, unknown>;
    const summary = data.summary as Record<string, unknown>;

    // selfConsumption = (20 - 3) / 20 * 100 = 85%
    expect(summary.selfConsumption).toBe(85);
    // selfSufficiency = (30 - 12) / 30 * 100 = 60%
    expect(summary.selfSufficiency).toBe(60);
    expect(summary.peakDemand).toBe(3.14);
    expect(summary.currency).toBe("BRL");
  });

  it("returns empty points array when no data exists", async () => {
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [] });
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [] });
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [] });
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [] });
    // asset exists check
    mockQueryWithOrg.mockResolvedValueOnce({
      rows: [{ asset_id: "ASSET_001" }],
    });

    const event = makeEvent("ASSET_001", adminToken(), {
      from: "2026-01-21T00:00:00-03:00",
      to: "2026-01-22T00:00:00-03:00",
    });
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    const data = parseBody(result).data as Record<string, unknown>;
    const points = data.points as unknown[];
    expect(points).toHaveLength(0);
    const summary = data.summary as Record<string, unknown>;
    expect(summary.selfConsumption).toBeNull();
  });

  it("returns 400 when from/to are missing", async () => {
    const event = makeEvent("ASSET_001", adminToken(), {});
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
    const body = parseBody(result);
    expect(body.error).toBe("from and to are required (ISO datetime)");
  });

  it("returns 400 for invalid resolution", async () => {
    const event = makeEvent("ASSET_001", adminToken(), {
      from: "2026-01-21T00:00:00-03:00",
      to: "2026-01-22T00:00:00-03:00",
      resolution: "10min",
    });
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
    const body = parseBody(result);
    expect(body.error).toBe(
      "resolution must be one of: 5min, hour, day, month",
    );
  });

  it("returns 400 when date range exceeds 400 days", async () => {
    const event = makeEvent("ASSET_001", adminToken(), {
      from: "2025-01-01T00:00:00-03:00",
      to: "2026-06-01T00:00:00-03:00",
    });
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
    const body = parseBody(result);
    expect(body.error).toBe("Date range must not exceed 400 days");
  });

  it("returns 404 when asset does not exist (RLS isolation)", async () => {
    // All queries return empty
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [] });
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [] });
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [] });
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [] });
    // asset check also empty (not in this org)
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [] });

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
