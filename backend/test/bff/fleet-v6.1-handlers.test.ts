import type { APIGatewayProxyEventV2 } from "aws-lambda";

// ─── Mock queryWithOrg BEFORE importing handlers ────────────────────────────
const mockQueryWithOrg = jest.fn();
jest.mock("../../src/shared/db", () => ({
  queryWithOrg: (...args: unknown[]) => mockQueryWithOrg(...args),
  getAppPool: jest.fn(),
  getServicePool: jest.fn(),
  closeAllPools: jest.fn().mockResolvedValue(undefined),
}));

// Import handlers AFTER mock setup
import { handler as fleetOverviewHandler } from "../../src/bff/handlers/get-fleet-overview";
import { handler as fleetIntegradoresHandler } from "../../src/bff/handlers/get-fleet-integradores";
import { handler as fleetOfflineEventsHandler } from "../../src/bff/handlers/get-fleet-offline-events";
import { handler as fleetChartsHandler } from "../../src/bff/handlers/get-fleet-charts";

// ─── Helpers ────────────────────────────────────────────────────────────────
function makeEvent(
  method: string,
  path: string,
  authHeader: string,
  opts?: { queryStringParameters?: Record<string, string> },
): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: `${method} ${path}`,
    rawPath: path,
    rawQueryString: "",
    headers: { authorization: authHeader },
    queryStringParameters: opts?.queryStringParameters,
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

function orgToken(orgId = "ORG_001", role = "ORG_MANAGER"): string {
  return JSON.stringify({ userId: "u1", orgId, role });
}

function parseBody(result: unknown): {
  success: boolean;
  data: Record<string, unknown>;
} {
  const r = result as { body: string };
  return JSON.parse(r.body);
}

// ─── Setup ──────────────────────────────────────────────────────────────────
beforeEach(() => {
  mockQueryWithOrg.mockReset();
});

// ─── EP-1: GET /api/fleet/overview ──────────────────────────────────────────
describe("GET /api/fleet/overview (v6.1 gateway-first)", () => {
  const overviewRow = {
    total_gateways: 10,
    online_gateways: 8,
    offline_gateways: 2,
    gateway_online_rate: 80,
    backfill_pressure_count: 3,
    has_backfill_failure: true,
    organization_count: 4,
  };

  it("returns gateway-first KPIs (admin)", async () => {
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [overviewRow] });

    const event = makeEvent("GET", "/api/fleet/overview", adminToken());
    const result = await fleetOverviewHandler(event);

    expect((result as { statusCode: number }).statusCode).toBe(200);
    const body = parseBody(result);
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({
      totalGateways: 10,
      offlineGateways: 2,
      onlineGateways: 8,
      gatewayOnlineRate: 80,
      backfillPressure: { count: 3, hasFailure: true },
      organizationCount: 4,
    });
  });

  it("returns integer online rate (no decimal)", async () => {
    mockQueryWithOrg.mockResolvedValueOnce({
      rows: [{ ...overviewRow, gateway_online_rate: 75 }],
    });

    const event = makeEvent("GET", "/api/fleet/overview", adminToken());
    const result = await fleetOverviewHandler(event);
    const body = parseBody(result);
    expect(body.data.gatewayOnlineRate).toBe(75);
    expect(Number.isInteger(body.data.gatewayOnlineRate)).toBe(true);
  });

  it("returns 0 for all KPIs when no gateways", async () => {
    mockQueryWithOrg.mockResolvedValueOnce({
      rows: [
        {
          total_gateways: 0,
          online_gateways: 0,
          offline_gateways: 0,
          gateway_online_rate: 0,
          backfill_pressure_count: 0,
          has_backfill_failure: false,
          organization_count: 0,
        },
      ],
    });

    const event = makeEvent("GET", "/api/fleet/overview", adminToken());
    const result = await fleetOverviewHandler(event);
    const body = parseBody(result);
    expect(body.data.totalGateways).toBe(0);
    expect(body.data.gatewayOnlineRate).toBe(0);
  });

  it("backfill pressure deduplicates by gateway (SQL uses COUNT DISTINCT)", async () => {
    // Verify SQL contains COUNT(DISTINCT for backfill
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [overviewRow] });

    const event = makeEvent("GET", "/api/fleet/overview", adminToken());
    await fleetOverviewHandler(event);

    const sql = mockQueryWithOrg.mock.calls[0][0] as string;
    expect(sql).toContain("COUNT(DISTINCT br.gateway_id)");
  });

  it("queries ALL gateways as denominator (no WHERE filter on status)", async () => {
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [overviewRow] });

    const event = makeEvent("GET", "/api/fleet/overview", adminToken());
    await fleetOverviewHandler(event);

    const sql = mockQueryWithOrg.mock.calls[0][0] as string;
    expect(sql).toContain("FROM gateways");
    // All gateways in DB count toward denominator — COUNT(*) with no row-level WHERE.
    // FILTER (WHERE ...) inside aggregates is OK (used for online/offline breakdown).
    expect(sql).toContain("COUNT(*)::int");
  });

  it("aggregates gateways in a CTE to avoid JOIN row duplication (bug fix)", async () => {
    // Regression test: LEFT JOIN backfill_requests was duplicating gateway rows,
    // inflating totals (e.g. 4 gateways reported as 48 when each had ~12 backfill rows).
    // Fix: gateway counts are computed in a separate CTE from backfill aggregation.
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [overviewRow] });

    const event = makeEvent("GET", "/api/fleet/overview", adminToken());
    await fleetOverviewHandler(event);

    const sql = mockQueryWithOrg.mock.calls[0][0] as string;

    // Gateway aggregation must happen in its own CTE, not joined to backfill_requests
    expect(sql).toMatch(/WITH\s+gw\s+AS/i);
    // Backfill aggregation in a separate CTE
    expect(sql).toMatch(/bf\s+AS/i);
    // The gateway CTE should count from gateways directly (no JOIN)
    const gwCte = sql.match(/WITH\s+gw\s+AS\s*\(([\s\S]*?)\)/i);
    expect(gwCte).toBeTruthy();
    expect(gwCte![1]).not.toContain("backfill_requests");
    expect(gwCte![1]).not.toContain("JOIN");
  });

  it("org-scoped user passes orgId to queryWithOrg", async () => {
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [overviewRow] });

    const event = makeEvent("GET", "/api/fleet/overview", orgToken("ORG_002"));
    await fleetOverviewHandler(event);

    expect(mockQueryWithOrg).toHaveBeenCalledWith(
      expect.any(String),
      [],
      "ORG_002",
    );
  });

  it("rejects unauthorized role", async () => {
    const badToken = JSON.stringify({
      userId: "u1",
      orgId: "ORG_001",
      role: "UNKNOWN_ROLE",
    });
    const event = makeEvent("GET", "/api/fleet/overview", badToken);
    const result = await fleetOverviewHandler(event);
    expect(
      (result as { statusCode: number }).statusCode,
    ).toBeGreaterThanOrEqual(400);
  });
});

// ─── EP-2: GET /api/fleet/integradores ──────────────────────────────────────
describe("GET /api/fleet/integradores (v6.1 gateway-first)", () => {
  const orgRow = {
    org_id: "ORG_001",
    name: "Solar SP",
    gateway_count: 5,
    gateway_online_rate: 80,
    backfill_pending_failed: 1,
    last_commissioning: "2026-01-15T10:00:00Z",
  };

  it("returns gateway-first org summary", async () => {
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [orgRow] });

    const event = makeEvent("GET", "/api/fleet/integradores", adminToken());
    const result = await fleetIntegradoresHandler(event);

    expect((result as { statusCode: number }).statusCode).toBe(200);
    const body = parseBody(result);
    const org = (body.data.integradores as unknown[])[0] as Record<
      string,
      unknown
    >;
    expect(org.gatewayCount).toBe(5);
    expect(org.gatewayOnlineRate).toBe(80);
    expect(org.backfillPendingFailed).toBe(1);
    expect(org.lastCommissioning).toBe("2026-01-15T10:00:00.000Z");
  });

  it("excludes orgs with 0 gateways (filters on pre-aggregated gateway CTE)", async () => {
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [orgRow] });

    const event = makeEvent("GET", "/api/fleet/integradores", adminToken());
    await fleetIntegradoresHandler(event);

    const sql = mockQueryWithOrg.mock.calls[0][0] as string;
    expect(sql).toContain("WHERE gw.gateway_count > 0");
  });

  it("aggregates organizations in a gateway CTE to avoid JOIN row duplication (bug fix)", async () => {
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [orgRow] });

    const event = makeEvent("GET", "/api/fleet/integradores", adminToken());
    await fleetIntegradoresHandler(event);

    const sql = mockQueryWithOrg.mock.calls[0][0] as string;
    expect(sql).toMatch(/WITH\s+gw\s+AS/i);
    expect(sql).toMatch(/bf\s+AS/i);
    const gwCte = sql.match(/WITH\s+gw\s+AS\s*\(([\s\S]*?)\)\s*,\s*bf\s+AS/i);
    expect(gwCte).toBeTruthy();
    expect(gwCte![1]).not.toContain("backfill_requests");
  });

  it("sorts by online rate ASC then gateway count DESC", async () => {
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [orgRow] });

    const event = makeEvent("GET", "/api/fleet/integradores", adminToken());
    await fleetIntegradoresHandler(event);

    const sql = mockQueryWithOrg.mock.calls[0][0] as string;
    expect(sql).toContain(
      "ORDER BY gateway_online_rate ASC, gateway_count DESC",
    );
  });

  it("uses COALESCE for last commissioning fallback", async () => {
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [orgRow] });

    const event = makeEvent("GET", "/api/fleet/integradores", adminToken());
    await fleetIntegradoresHandler(event);

    const sql = mockQueryWithOrg.mock.calls[0][0] as string;
    expect(sql).toContain(
      "COALESCE(g.commissioned_at, g_first_telem.first_ts)",
    );
  });

  it("returns null lastCommissioning when no data", async () => {
    mockQueryWithOrg.mockResolvedValueOnce({
      rows: [{ ...orgRow, last_commissioning: null }],
    });

    const event = makeEvent("GET", "/api/fleet/integradores", adminToken());
    const result = await fleetIntegradoresHandler(event);
    const body = parseBody(result);
    const org = (body.data.integradores as unknown[])[0] as Record<
      string,
      unknown
    >;
    expect(org.lastCommissioning).toBeNull();
  });
});

// ─── EP-3: GET /api/fleet/offline-events ────────────────────────────────────
describe("GET /api/fleet/offline-events (v6.1 gateway outage events)", () => {
  const eventRow = {
    gateway_id: "gw-001",
    gateway_name: "Gateway A",
    org_name: "Solar SP",
    offline_start: "2026-03-15T10:00:00Z",
    duration_minutes: 45,
    backfill_status: "pending",
  };

  it("returns gateway-level outage events", async () => {
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [eventRow] });

    const event = makeEvent("GET", "/api/fleet/offline-events", adminToken());
    const result = await fleetOfflineEventsHandler(event);

    expect((result as { statusCode: number }).statusCode).toBe(200);
    const body = parseBody(result);
    const ev = (body.data.events as unknown[])[0] as Record<string, unknown>;
    expect(ev.gatewayId).toBe("gw-001");
    expect(ev.gatewayName).toBe("Gateway A");
    expect(ev.orgName).toBe("Solar SP");
    expect(ev.durationMinutes).toBe(45);
    expect(ev.backfillStatus).toBe("pending");
  });

  it("returns null durationMinutes for ongoing outage", async () => {
    mockQueryWithOrg.mockResolvedValueOnce({
      rows: [{ ...eventRow, duration_minutes: null }],
    });

    const event = makeEvent("GET", "/api/fleet/offline-events", adminToken());
    const result = await fleetOfflineEventsHandler(event);
    const body = parseBody(result);
    const ev = (body.data.events as unknown[])[0] as Record<string, unknown>;
    expect(ev.durationMinutes).toBeNull();
  });

  it("limits to 7 days (SQL WHERE clause)", async () => {
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [] });

    const event = makeEvent("GET", "/api/fleet/offline-events", adminToken());
    await fleetOfflineEventsHandler(event);

    const sql = mockQueryWithOrg.mock.calls[0][0] as string;
    expect(sql).toContain("NOW() - INTERVAL '7 days'");
  });

  it("sorts by offlineStart DESC", async () => {
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [] });

    const event = makeEvent("GET", "/api/fleet/offline-events", adminToken());
    await fleetOfflineEventsHandler(event);

    const sql = mockQueryWithOrg.mock.calls[0][0] as string;
    expect(sql).toContain("ORDER BY goe.started_at DESC");
  });

  it("respects limit query parameter", async () => {
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [] });

    const event = makeEvent("GET", "/api/fleet/offline-events", adminToken(), {
      queryStringParameters: { limit: "10" },
    });
    await fleetOfflineEventsHandler(event);

    expect(mockQueryWithOrg).toHaveBeenCalledWith(
      expect.any(String),
      [10],
      expect.any(String),
    );
  });
});

// ─── EP-4: GET /api/fleet/charts ────────────────────────────────────────────
describe("GET /api/fleet/charts (v6.1 chart data)", () => {
  it("returns gateway status with only 2 categories (online/offline)", async () => {
    mockQueryWithOrg
      .mockResolvedValueOnce({ rows: [{ online: 8, offline: 2 }] })
      .mockResolvedValueOnce({ rows: [{ brand: "GoodWe", device_count: 10 }] });

    const event = makeEvent("GET", "/api/fleet/charts", adminToken());
    const result = await fleetChartsHandler(event);

    expect((result as { statusCode: number }).statusCode).toBe(200);
    const body = parseBody(result);
    const gs = body.data.gatewayStatus as Record<string, unknown>;
    expect(gs).toEqual({ online: 8, offline: 2 });
    // Only online/offline, no backfill states
    expect(Object.keys(gs)).toEqual(["online", "offline"]);
  });

  it("returns inverter brand distribution by device count", async () => {
    mockQueryWithOrg
      .mockResolvedValueOnce({ rows: [{ online: 5, offline: 1 }] })
      .mockResolvedValueOnce({
        rows: [
          { brand: "GoodWe", device_count: 10 },
          { brand: "Huawei", device_count: 5 },
        ],
      });

    const event = makeEvent("GET", "/api/fleet/charts", adminToken());
    const result = await fleetChartsHandler(event);
    const body = parseBody(result);
    const brands = body.data.inverterBrandDistribution as Array<
      Record<string, unknown>
    >;
    expect(brands).toHaveLength(2);
    expect(brands[0].brand).toBe("GoodWe");
    expect(brands[0].deviceCount).toBe(10);
  });

  it("maps NULL brand to 'Unknown' (SQL COALESCE)", async () => {
    mockQueryWithOrg
      .mockResolvedValueOnce({ rows: [{ online: 0, offline: 0 }] })
      .mockResolvedValueOnce({ rows: [] });

    const event = makeEvent("GET", "/api/fleet/charts", adminToken());
    await fleetChartsHandler(event);

    const brandSql = mockQueryWithOrg.mock.calls[1][0] as string;
    expect(brandSql).toContain("COALESCE(a.brand, 'Unknown')");
  });

  it("filters by INVERTER_BATTERY asset type", async () => {
    mockQueryWithOrg
      .mockResolvedValueOnce({ rows: [{ online: 0, offline: 0 }] })
      .mockResolvedValueOnce({ rows: [] });

    const event = makeEvent("GET", "/api/fleet/charts", adminToken());
    await fleetChartsHandler(event);

    const brandSql = mockQueryWithOrg.mock.calls[1][0] as string;
    expect(brandSql).toContain("asset_type = 'INVERTER_BATTERY'");
  });

  it("uses parallel queries (Promise.all)", async () => {
    // Both queries should be called even if test is synchronous
    mockQueryWithOrg
      .mockResolvedValueOnce({ rows: [{ online: 0, offline: 0 }] })
      .mockResolvedValueOnce({ rows: [] });

    const event = makeEvent("GET", "/api/fleet/charts", adminToken());
    await fleetChartsHandler(event);

    expect(mockQueryWithOrg).toHaveBeenCalledTimes(2);
  });
});
