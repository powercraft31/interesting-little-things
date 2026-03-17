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

// Import handlers AFTER mock setup
import { handler as fleetOverviewHandler } from "../../src/bff/handlers/get-fleet-overview";
import { handler as fleetIntegradoresHandler } from "../../src/bff/handlers/get-fleet-integradores";
import { handler as fleetOfflineEventsHandler } from "../../src/bff/handlers/get-fleet-offline-events";
import { handler as fleetUptimeTrendHandler } from "../../src/bff/handlers/get-fleet-uptime-trend";
import { handler as devicesHandler } from "../../src/bff/handlers/get-devices";
import { handler as homesHandler } from "../../src/bff/handlers/get-homes";
import { handler as homeEnergyHandler } from "../../src/bff/handlers/get-home-energy";
import { handler as homesSummaryHandler } from "../../src/bff/handlers/get-homes-summary";
import { handler as hemsOverviewHandler } from "../../src/bff/handlers/get-hems-overview";
import { handler as hemsDispatchHandler } from "../../src/bff/handlers/post-hems-batch-dispatch";
import { handler as vppCapacityHandler } from "../../src/bff/handlers/get-vpp-capacity";
import { handler as vppLatencyHandler } from "../../src/bff/handlers/get-vpp-latency";
import { handler as vppDrEventsHandler } from "../../src/bff/handlers/get-vpp-dr-events";
import { handler as perfScorecardHandler } from "../../src/bff/handlers/get-performance-scorecard";
import { handler as perfSavingsHandler } from "../../src/bff/handlers/get-performance-savings";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(
  method: string,
  path: string,
  authHeader: string,
  opts?: {
    queryStringParameters?: Record<string, string>;
    body?: string;
  },
): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: `${method} ${path}`,
    rawPath: path,
    rawQueryString: "",
    headers: { authorization: authHeader },
    queryStringParameters: opts?.queryStringParameters,
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
    orgId: "ORG_ENERGIA_001",
    role: "SOLFACIL_ADMIN",
  });
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
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockQueryWithOrg.mockReset();
});

// ---------------------------------------------------------------------------
// EP-1: GET /api/fleet/overview
// ---------------------------------------------------------------------------

describe("GET /api/fleet/overview", () => {
  it("returns fleet aggregate KPIs (admin)", async () => {
    mockQueryWithOrg
      .mockResolvedValueOnce({
        rows: [
          {
            total_devices: 47,
            online_count: 44,
            offline_count: 3,
            online_rate: 93.6,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { type: "INVERTER_BATTERY", count: 20, online: 19 },
          { type: "SMART_METER", count: 12, online: 12 },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ total_gateways: 3 }] })
      .mockResolvedValueOnce({ rows: [{ total_integradores: 2 }] });

    const event = makeEvent("GET", "/api/fleet/overview", adminToken());
    const result = (await fleetOverviewHandler(
      event,
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    const body = parseBody(result);
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty("totalDevices", 47);
    expect(body.data).toHaveProperty("onlineCount", 44);
    expect(body.data).toHaveProperty("offlineCount", 3);
    expect(body.data).toHaveProperty("totalGateways", 3);
    expect(body.data).toHaveProperty("deviceTypes");
  });

  it("returns 401 with empty auth", async () => {
    const event = makeEvent("GET", "/api/fleet/overview", "");
    const result = (await fleetOverviewHandler(
      event,
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// EP-2: GET /api/fleet/integradores
// ---------------------------------------------------------------------------

describe("GET /api/fleet/integradores", () => {
  it("returns integrador list for admin", async () => {
    mockQueryWithOrg.mockResolvedValueOnce({
      rows: [
        {
          org_id: "ORG_ENERGIA_001",
          name: "Solar São Paulo",
          device_count: 26,
          online_rate: 96.2,
          last_commission: "2024-11-15T10:00:00Z",
        },
      ],
    });

    const event = makeEvent("GET", "/api/fleet/integradores", adminToken());
    const result = (await fleetIntegradoresHandler(
      event,
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    const body = parseBody(result);
    expect(body.data).toHaveProperty("integradores");
    const integradores = (body.data as Record<string, unknown>)
      .integradores as Array<Record<string, unknown>>;
    expect(integradores.length).toBeGreaterThanOrEqual(1);
    expect(integradores[0]).toHaveProperty("orgId");
    expect(integradores[0]).toHaveProperty("deviceCount");
  });

  it("returns integrador list for org user (org-scoped)", async () => {
    mockQueryWithOrg.mockResolvedValueOnce({
      rows: [
        {
          org_id: "ORG_ENERGIA_001",
          name: "Solar São Paulo",
          device_count: 26,
          online_rate: 96.2,
          last_commission: "2024-11-15T10:00:00Z",
        },
      ],
    });

    const event = makeEvent("GET", "/api/fleet/integradores", orgToken());
    const result = (await fleetIntegradoresHandler(
      event,
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    const body = parseBody(result);
    expect(body.data).toHaveProperty("integradores");
  });

  it("scopes organizations query with WHERE o.org_id = $1 to prevent zero-shell foreign rows", async () => {
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [] });

    const event = makeEvent(
      "GET",
      "/api/fleet/integradores",
      orgToken("ORG_DEMO_002"),
    );
    await fleetIntegradoresHandler(event);

    const sql = mockQueryWithOrg.mock.calls[0][0] as string;
    const params = mockQueryWithOrg.mock.calls[0][1] as unknown[];
    const orgIdArg = mockQueryWithOrg.mock.calls[0][2] as string;

    // SQL must filter organizations table by org_id
    expect(sql).toContain("WHERE o.org_id = $1");
    // org_id must be passed as a query parameter
    expect(params).toEqual(["ORG_DEMO_002"]);
    // org_id must also be passed as RLS context
    expect(orgIdArg).toBe("ORG_DEMO_002");
  });
});

// ---------------------------------------------------------------------------
// EP-3: GET /api/fleet/offline-events
// ---------------------------------------------------------------------------

describe("GET /api/fleet/offline-events", () => {
  it("returns offline events list", async () => {
    mockQueryWithOrg.mockResolvedValueOnce({
      rows: [
        {
          device_id: "DEV-016",
          start: "2026-03-05T10:00:00Z",
          duration_hrs: 2.5,
          cause: "network",
          backfill: false,
        },
      ],
    });

    const event = makeEvent("GET", "/api/fleet/offline-events", adminToken());
    const result = (await fleetOfflineEventsHandler(
      event,
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    const body = parseBody(result);
    expect(body.data).toHaveProperty("events");
  });
});

// ---------------------------------------------------------------------------
// EP-4: GET /api/fleet/uptime-trend
// ---------------------------------------------------------------------------

describe("GET /api/fleet/uptime-trend", () => {
  it("returns 28-day uptime trend", async () => {
    mockQueryWithOrg.mockResolvedValueOnce({
      rows: [
        { date: "01/03", uptime: 95.2 },
        { date: "02/03", uptime: 96.0 },
      ],
    });

    const event = makeEvent("GET", "/api/fleet/uptime-trend", adminToken());
    const result = (await fleetUptimeTrendHandler(
      event,
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    const body = parseBody(result);
    expect(body.data).toHaveProperty("trend");
    const trend = (body.data as Record<string, unknown>).trend as Array<
      Record<string, unknown>
    >;
    expect(trend.length).toBe(2);
    expect(trend[0]).toHaveProperty("date");
    expect(trend[0]).toHaveProperty("uptime");
  });
});

// ---------------------------------------------------------------------------
// EP-5: GET /api/devices
// ---------------------------------------------------------------------------

describe("GET /api/devices", () => {
  it("returns device list with telemetry", async () => {
    mockQueryWithOrg.mockResolvedValueOnce({
      rows: [
        {
          device_id: "DEV-005",
          type: "INVERTER_BATTERY",
          brand: "Growatt",
          model: "MIN 5000TL-XH",
          home_id: "HOME-001",
          home_name: "Casa Silva",
          org_id: "ORG_ENERGIA_001",
          org_name: "Solar São Paulo",
          status: "online",
          last_seen: "2026-03-05T12:00:00Z",
          commission_date: "2024-04-01T10:00:00Z",
          telemetry: {},
        },
      ],
    });

    const event = makeEvent("GET", "/api/devices", adminToken());
    const result = (await devicesHandler(
      event,
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    const body = parseBody(result);
    expect(body.data).toHaveProperty("devices");
    const devices = (body.data as Record<string, unknown>).devices as Array<
      Record<string, unknown>
    >;
    expect(devices[0]).toHaveProperty("deviceId", "DEV-005");
    expect(devices[0]).toHaveProperty("brand", "Growatt");
    expect(devices[0]).toHaveProperty("telemetry");
  });
});

// ---------------------------------------------------------------------------
// EP-6: GET /api/homes
// ---------------------------------------------------------------------------

describe("GET /api/homes", () => {
  it("returns home list with device count", async () => {
    mockQueryWithOrg.mockResolvedValueOnce({
      rows: [
        {
          id: "HOME-001",
          name: "Casa Silva",
          org_id: "ORG_ENERGIA_001",
          org_name: "Solar SP",
          device_count: 13,
        },
        {
          id: "HOME-002",
          name: "Casa Santos",
          org_id: "ORG_ENERGIA_001",
          org_name: "Solar SP",
          device_count: 15,
        },
      ],
    });

    const event = makeEvent("GET", "/api/homes", adminToken());
    const result = (await homesHandler(
      event,
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    const body = parseBody(result);
    expect(body.data).toHaveProperty("homes");
    const homes = (body.data as Record<string, unknown>).homes as Array<
      Record<string, unknown>
    >;
    expect(homes.length).toBe(2);
    expect(homes[0]).toHaveProperty("deviceCount");
  });
});

// ---------------------------------------------------------------------------
// EP-7: GET /api/homes/:homeId/energy
// ---------------------------------------------------------------------------

describe("GET /api/homes/:homeId/energy", () => {
  it("returns 96-point time series", async () => {
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [] }); // No telemetry data — returns zeros

    const event = makeEvent("GET", "/api/homes/HOME-001/energy", adminToken());
    const result = (await homeEnergyHandler(
      event,
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    const body = parseBody(result);
    expect(body.data).toHaveProperty("homeId", "HOME-001");
    expect(body.data).toHaveProperty("timeLabels");
    expect(body.data).toHaveProperty("pv");
    expect(body.data).toHaveProperty("load");
    expect(body.data).toHaveProperty("battery");
    expect(body.data).toHaveProperty("grid");
    expect(body.data).toHaveProperty("soc");
    const labels = (body.data as Record<string, unknown>)
      .timeLabels as string[];
    expect(labels.length).toBe(96);
    expect(labels[0]).toBe("00:00");
    expect(labels[95]).toBe("23:45");
  });

  it("returns 400 when homeId is missing", async () => {
    const event = makeEvent("GET", "/api/homes//energy", adminToken());
    const result = (await homeEnergyHandler(
      event,
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// EP-8: GET /api/homes/summary
// ---------------------------------------------------------------------------

describe("GET /api/homes/summary", () => {
  it("returns cross-home comparison", async () => {
    mockQueryWithOrg.mockResolvedValueOnce({
      rows: [
        {
          home_id: "HOME-001",
          name: "Casa Silva",
          self_cons: 87,
          grid_export: 5.2,
          grid_import: 2.1,
          peak_load: 8.5,
          mode: "self_consumption",
        },
      ],
    });

    const event = makeEvent("GET", "/api/homes/summary", adminToken());
    const result = (await homesSummaryHandler(
      event,
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    const body = parseBody(result);
    expect(body.data).toHaveProperty("summary");
  });
});

// ---------------------------------------------------------------------------
// EP-9: GET /api/hems/overview
// ---------------------------------------------------------------------------

describe("GET /api/hems/overview", () => {
  it("returns mode distribution + tarifa + last dispatch", async () => {
    mockQueryWithOrg
      .mockResolvedValueOnce({
        rows: [
          { operation_mode: "self_consumption", device_count: 22 },
          { operation_mode: "peak_valley_arbitrage", device_count: 18 },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            disco: "CEMIG",
            peak: 0.89,
            off_peak: 0.41,
            intermediate: 0.62,
            feed_in: 0.24,
            effective_date: "2025-01-01",
            peak_start: "17:00",
            peak_end: "22:00",
            intermediate_start: "16:00",
            intermediate_end: "21:00",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const event = makeEvent("GET", "/api/hems/overview", adminToken());
    const result = (await hemsOverviewHandler(
      event,
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    const body = parseBody(result);
    expect(body.data).toHaveProperty("modeDistribution");
    expect(body.data).toHaveProperty("tarifaRates");
    const modes = (body.data as Record<string, unknown>)
      .modeDistribution as Record<string, number>;
    expect(modes.self_consumption).toBe(22);
  });
});

// ---------------------------------------------------------------------------
// EP-10: POST /api/hems/batch-dispatch (v6.0: replaces old /api/hems/dispatch)
// ---------------------------------------------------------------------------

describe("POST /api/hems/batch-dispatch", () => {
  it("creates batch dispatch for self_consumption mode", async () => {
    // Q1: batch RLS check
    mockQueryWithOrg.mockResolvedValueOnce({
      rows: [{ gateway_id: "GW-001" }],
    });
    // Q2: batch read historical schedules
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [] });
    // Q3: batch check active commands
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [] });
    // Q4: batch rated capacity
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [] });
    // Q5: INSERT command log
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [{ id: "42" }] });

    const event = makeEvent(
      "POST",
      "/api/hems/batch-dispatch",
      JSON.stringify({
        userId: "u1",
        orgId: "ORG_ENERGIA_001",
        role: "ORG_OPERATOR",
      }),
      {
        body: JSON.stringify({
          mode: "self_consumption",
          socMinLimit: 20,
          socMaxLimit: 95,
          gatewayIds: ["GW-001"],
        }),
      },
    );
    const result = (await hemsDispatchHandler(
      event,
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    const body = parseBody(result);
    expect(body.data).toHaveProperty("batchId");
    expect(body.data).toHaveProperty("summary");
    const summary = (body.data as Record<string, unknown>).summary as Record<
      string,
      number
    >;
    expect(summary.pending).toBe(1);
    expect(summary.skipped).toBe(0);
  });

  it("rejects invalid mode", async () => {
    const event = makeEvent(
      "POST",
      "/api/hems/batch-dispatch",
      JSON.stringify({
        userId: "u1",
        orgId: "ORG_ENERGIA_001",
        role: "ORG_OPERATOR",
      }),
      {
        body: JSON.stringify({
          mode: "invalid_mode",
          socMinLimit: 20,
          socMaxLimit: 95,
          gatewayIds: ["GW-001"],
        }),
      },
    );
    const result = (await hemsDispatchHandler(
      event,
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
  });

  it("rejects viewer role", async () => {
    const event = makeEvent(
      "POST",
      "/api/hems/batch-dispatch",
      JSON.stringify({
        userId: "u1",
        orgId: "ORG_ENERGIA_001",
        role: "ORG_VIEWER",
      }),
      {
        body: JSON.stringify({
          mode: "self_consumption",
          socMinLimit: 20,
          socMaxLimit: 95,
          gatewayIds: ["GW-001"],
        }),
      },
    );
    const result = (await hemsDispatchHandler(
      event,
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// EP-11: GET /api/vpp/capacity
// ---------------------------------------------------------------------------

describe("GET /api/vpp/capacity", () => {
  it("returns aggregated VPP capacity", async () => {
    mockQueryWithOrg.mockResolvedValueOnce({
      rows: [
        {
          total_capacity_kwh: 145.4,
          available_kwh: 87.2,
          aggregate_soc: 60.0,
          max_discharge_kw: 92.6,
          max_charge_kw: 74.1,
          dispatchable_devices: 44,
        },
      ],
    });

    const event = makeEvent("GET", "/api/vpp/capacity", adminToken());
    const result = (await vppCapacityHandler(
      event,
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    const body = parseBody(result);
    expect(body.data).toHaveProperty("totalCapacityKwh");
    expect(body.data).toHaveProperty("availableKwh");
    expect(body.data).toHaveProperty("dispatchableDevices", 44);
  });
});

// ---------------------------------------------------------------------------
// EP-12: GET /api/vpp/latency
// ---------------------------------------------------------------------------

describe("GET /api/vpp/latency", () => {
  it("returns 7 latency tiers", async () => {
    mockQueryWithOrg.mockResolvedValueOnce({
      rows: [
        { tier: "1s", success_rate: 45.2 },
        { tier: "5s", success_rate: 78.5 },
        { tier: "15s", success_rate: 92.1 },
        { tier: "30s", success_rate: 96.8 },
        { tier: "1min", success_rate: 98.5 },
        { tier: "15min", success_rate: 99.8 },
        { tier: "1h", success_rate: 100.0 },
      ],
    });

    const event = makeEvent("GET", "/api/vpp/latency", adminToken());
    const result = (await vppLatencyHandler(
      event,
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    const body = parseBody(result);
    expect(body.data).toHaveProperty("tiers");
    const tiers = (body.data as Record<string, unknown>).tiers as Array<
      Record<string, unknown>
    >;
    expect(tiers.length).toBe(7);
    expect(tiers[0]).toHaveProperty("tier", "1s");
    expect(tiers[0]).toHaveProperty("successRate");
  });
});

// ---------------------------------------------------------------------------
// EP-13: GET /api/vpp/dr-events
// ---------------------------------------------------------------------------

describe("GET /api/vpp/dr-events", () => {
  it("returns DR event history", async () => {
    mockQueryWithOrg.mockResolvedValueOnce({
      rows: [
        {
          id: "1",
          type: "Discharge",
          triggered_at: "2026-03-05T18:00:00Z",
          target_kw: 50.0,
          achieved_kw: 48.5,
          accuracy: 97.0,
          participated: 40,
          failed: 2,
        },
      ],
    });

    const event = makeEvent("GET", "/api/vpp/dr-events", adminToken());
    const result = (await vppDrEventsHandler(
      event,
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    const body = parseBody(result);
    expect(body.data).toHaveProperty("events");
    const events = (body.data as Record<string, unknown>).events as Array<
      Record<string, unknown>
    >;
    expect(events[0]).toHaveProperty("type", "Discharge");
    expect(events[0]).toHaveProperty("accuracy");
  });
});

// ---------------------------------------------------------------------------
// EP-14: GET /api/performance/scorecard
// ---------------------------------------------------------------------------

describe("GET /api/performance/scorecard", () => {
  it("returns 14 metrics in 3 categories (v5.14: Actual Savings + Optimization Efficiency + Self-Sufficiency)", async () => {
    mockQueryWithOrg
      .mockResolvedValueOnce({ rows: [{ avg_uptime: 96.5 }] }) // uptime
      .mockResolvedValueOnce({ rows: [{ accuracy: 97.2, avg_latency_s: 1.5 }] }) // dispatch
      .mockResolvedValueOnce({ rows: [{ backfill_rate: 85.0 }] }) // offline
      .mockResolvedValueOnce({
        // v5.14: costs
        rows: [{ total_baseline: 100, total_actual: 30, total_best_tou: 20 }],
      })
      .mockResolvedValueOnce({ rows: [{ avg_sc: 78.5 }] }) // self-consumption
      .mockResolvedValueOnce({ rows: [{ avg_ss: 62.3 }] }) // v5.14: self-sufficiency
      .mockResolvedValueOnce({ rows: [{ avg_commission_min: 42 }] }) // v5.20: commissioning time
      .mockResolvedValueOnce({ rows: [{ manual_count: 1 }] }); // v5.20: manual interventions

    const event = makeEvent("GET", "/api/performance/scorecard", adminToken());
    const result = (await perfScorecardHandler(
      event,
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    const body = parseBody(result);
    expect(body.data).toHaveProperty("hardware");
    expect(body.data).toHaveProperty("optimization");
    expect(body.data).toHaveProperty("operations");
    const hw = (body.data as Record<string, unknown>).hardware as Array<
      Record<string, unknown>
    >;
    const opt = (body.data as Record<string, unknown>).optimization as Array<
      Record<string, unknown>
    >;
    const ops = (body.data as Record<string, unknown>).operations as Array<
      Record<string, unknown>
    >;
    expect(hw.length).toBe(4);
    expect(opt.length).toBe(6); // v5.14: was 4, now 6
    expect(ops.length).toBe(4);

    // v5.14: Verify old "Savings Alpha" is gone
    const metricNames = opt.map((m) => m.name);
    expect(metricNames).not.toContain("Savings Alpha");
    // v5.14: Verify new metrics are present
    expect(metricNames).toContain("Actual Savings");
    expect(metricNames).toContain("Optimization Efficiency");
    expect(metricNames).toContain("Self-Sufficiency");
    expect(metricNames).toContain("Self-Consumption");

    // Each metric has required fields
    for (const m of [...hw, ...opt, ...ops]) {
      expect(m).toHaveProperty("name");
      expect(m).toHaveProperty("unit");
      expect(m).toHaveProperty("target");
      expect(m).toHaveProperty("status");
      expect(["pass", "near", "warn"]).toContain(m.status);
    }

    // v5.14: Verify Actual Savings calculation
    // (100 - 30) / 100 * 100 = 70%
    const actualSavings = opt.find((m) => m.name === "Actual Savings");
    expect(actualSavings!.value).toBe(70);

    // v5.14: Optimization Efficiency = (100 - 30) / (100 - 20) * 100 = 87.5%
    const optEff = opt.find((m) => m.name === "Optimization Efficiency");
    expect(optEff!.value).toBe(87.5);

    // v5.14: Self-Sufficiency from query
    const ss = opt.find((m) => m.name === "Self-Sufficiency");
    expect(ss!.value).toBe(62.3);
  });

  it("returns null for Optimization Efficiency when baseline equals best_tou (divide-by-zero)", async () => {
    mockQueryWithOrg
      .mockResolvedValueOnce({ rows: [{ avg_uptime: 96.5 }] })
      .mockResolvedValueOnce({ rows: [{ accuracy: 97.2, avg_latency_s: 1.5 }] })
      .mockResolvedValueOnce({ rows: [{ backfill_rate: 85.0 }] })
      .mockResolvedValueOnce({
        rows: [{ total_baseline: 50, total_actual: 50, total_best_tou: 50 }],
      })
      .mockResolvedValueOnce({ rows: [{ avg_sc: 78.5 }] })
      .mockResolvedValueOnce({ rows: [{ avg_ss: 0 }] })
      .mockResolvedValueOnce({ rows: [{ avg_commission_min: null }] }) // v5.20: commissioning time
      .mockResolvedValueOnce({ rows: [{ manual_count: 0 }] }); // v5.20: manual interventions

    const event = makeEvent("GET", "/api/performance/scorecard", adminToken());
    const result = (await perfScorecardHandler(
      event,
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    const body = parseBody(result);
    const opt = (body.data as Record<string, unknown>).optimization as Array<
      Record<string, unknown>
    >;
    const optEff = opt.find((m) => m.name === "Optimization Efficiency");
    expect(optEff!.value).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// EP-15: GET /api/performance/savings
// ---------------------------------------------------------------------------

describe("GET /api/performance/savings (v5.15: real SC/TOU)", () => {
  it("returns per-home savings with real sc, tou, and null ps", async () => {
    mockQueryWithOrg.mockResolvedValueOnce({
      rows: [
        {
          home: "Casa Silva",
          total: 1250.5,
          sc: 687.78,
          tou: 375.15,
          ps: 187.57,
        },
        {
          home: "Casa Santos",
          total: 980.0,
          sc: 539.0,
          tou: 294.0,
          ps: 147.0,
        },
      ],
    });

    const event = makeEvent("GET", "/api/performance/savings", adminToken());
    const result = (await perfSavingsHandler(
      event,
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    const body = parseBody(result);
    expect(body.data).toHaveProperty("savings");
    const savings = (body.data as Record<string, unknown>).savings as Array<
      Record<string, unknown>
    >;
    expect(savings.length).toBe(2);
    expect(savings[0]).toHaveProperty("home", "Casa Silva");
    expect(savings[0]).toHaveProperty("total");
    expect(savings[0]).toHaveProperty("sc", 687.78);
    expect(savings[0]).toHaveProperty("tou", 375.15);
    expect(savings[0]).toHaveProperty("ps", 187.57); // v5.16: real PS savings
    // v5.15: no more alpha field
    expect(savings[0]).not.toHaveProperty("alpha");
  });

  it("query reads real sc_savings_reais and tou_savings_reais from DB (no fake ratios)", async () => {
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [] });

    const event = makeEvent("GET", "/api/performance/savings", adminToken());
    await perfSavingsHandler(event);

    const sql = mockQueryWithOrg.mock.calls[0][0] as string;
    // v5.15: reads real columns from revenue_daily
    expect(sql).toContain("sc_savings_reais");
    expect(sql).toContain("tou_savings_reais");
    // v5.16: reads ps_savings_reais
    expect(sql).toContain("ps_savings_reais");
    // v5.15: no more fake 0.55/0.30/0.15 multipliers
    expect(sql).not.toContain("0.55");
    expect(sql).not.toContain("0.30");
    expect(sql).not.toContain("0.15");
    // v5.15: no more alpha
    expect(sql).not.toContain("alpha");
  });
});

// ---------------------------------------------------------------------------
// Auth contract tests — all handlers reject empty auth
// ---------------------------------------------------------------------------

describe("Auth enforcement on all v5.12 handlers", () => {
  const handlers = [
    {
      name: "fleet/overview",
      handler: fleetOverviewHandler,
      method: "GET" as const,
      path: "/api/fleet/overview",
    },
    {
      name: "fleet/uptime-trend",
      handler: fleetUptimeTrendHandler,
      method: "GET" as const,
      path: "/api/fleet/uptime-trend",
    },
    {
      name: "devices",
      handler: devicesHandler,
      method: "GET" as const,
      path: "/api/devices",
    },
    {
      name: "homes",
      handler: homesHandler,
      method: "GET" as const,
      path: "/api/homes",
    },
    {
      name: "homes/summary",
      handler: homesSummaryHandler,
      method: "GET" as const,
      path: "/api/homes/summary",
    },
    {
      name: "hems/overview",
      handler: hemsOverviewHandler,
      method: "GET" as const,
      path: "/api/hems/overview",
    },
    {
      name: "vpp/capacity",
      handler: vppCapacityHandler,
      method: "GET" as const,
      path: "/api/vpp/capacity",
    },
    {
      name: "vpp/latency",
      handler: vppLatencyHandler,
      method: "GET" as const,
      path: "/api/vpp/latency",
    },
    {
      name: "vpp/dr-events",
      handler: vppDrEventsHandler,
      method: "GET" as const,
      path: "/api/vpp/dr-events",
    },
    {
      name: "performance/scorecard",
      handler: perfScorecardHandler,
      method: "GET" as const,
      path: "/api/performance/scorecard",
    },
    {
      name: "performance/savings",
      handler: perfSavingsHandler,
      method: "GET" as const,
      path: "/api/performance/savings",
    },
  ];

  it.each(handlers)(
    "$name returns 401 with empty auth",
    async ({ handler, method, path }) => {
      const event = makeEvent(method, path, "");
      const result = (await handler(
        event,
      )) as APIGatewayProxyStructuredResultV2;
      expect(result.statusCode).toBe(401);
    },
  );
});
