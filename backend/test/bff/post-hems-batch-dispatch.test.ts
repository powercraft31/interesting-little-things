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

import { handler } from "../../src/bff/handlers/post-hems-batch-dispatch";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(authHeader: string, body?: string): APIGatewayProxyEventV2 {
  const path = "/api/hems/batch-dispatch";
  return {
    version: "2.0",
    routeKey: `POST ${path}`,
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
        method: "POST",
        path,
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "test",
      },
      requestId: "test-1",
      routeKey: `POST ${path}`,
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

function operatorToken(): string {
  return JSON.stringify({
    userId: "u1",
    orgId: "ORG_ENERGIA_001",
    role: "ORG_OPERATOR",
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
  error?: string;
} {
  return JSON.parse(result.body as string);
}

function selfConsumptionBody(gatewayIds: string[]): string {
  return JSON.stringify({
    mode: "self_consumption",
    socMinLimit: 20,
    socMaxLimit: 95,
    gatewayIds,
  });
}

function peakShavingBody(gatewayIds: string[]): string {
  return JSON.stringify({
    mode: "peak_shaving",
    socMinLimit: 20,
    socMaxLimit: 95,
    gridImportLimitKw: 50,
    gatewayIds,
  });
}

function arbitrageBody(gatewayIds: string[]): string {
  return JSON.stringify({
    mode: "peak_valley_arbitrage",
    socMinLimit: 20,
    socMaxLimit: 95,
    arbSlots: [
      { startHour: 0, endHour: 6, action: "charge" },
      { startHour: 6, endHour: 24, action: "discharge" },
    ],
    gatewayIds,
  });
}

/**
 * Sets up standard mock responses for a successful dispatch:
 * Q1: batch RLS check
 * Q2: batch historical schedules
 * Q3: batch active command check
 * Q4: batch rated capacity (Phase 2)
 * Q5+: INSERT per gateway
 */
function setupSuccessMocks(gatewayIds: string[], insertIds: number[]): void {
  // Q1: batch RLS
  mockQueryWithOrg.mockResolvedValueOnce({
    rows: gatewayIds.map((gw) => ({ gateway_id: gw })),
  });
  // Q2: historical schedules (none)
  mockQueryWithOrg.mockResolvedValueOnce({ rows: [] });
  // Q3: active commands (none)
  mockQueryWithOrg.mockResolvedValueOnce({ rows: [] });
  // Q4: rated capacity (none)
  mockQueryWithOrg.mockResolvedValueOnce({ rows: [] });
  // Q5+: INSERT per gateway
  for (const id of insertIds) {
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [{ id: String(id) }] });
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockQueryWithOrg.mockReset();
});

describe("POST /api/hems/batch-dispatch", () => {
  // ── Validation Tests ─────────────────────────────────────────────

  it("400 — invalid mode", async () => {
    const event = makeEvent(
      adminToken(),
      JSON.stringify({
        mode: "turbo_mode",
        socMinLimit: 20,
        socMaxLimit: 95,
        gatewayIds: ["GW-1"],
      }),
    );
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
    const body = parseBody(result);
    expect(body.error).toContain("mode must be one of");
  });

  it("400 — socMinLimit >= socMaxLimit", async () => {
    const event = makeEvent(
      adminToken(),
      JSON.stringify({
        mode: "self_consumption",
        socMinLimit: 80,
        socMaxLimit: 80,
        gatewayIds: ["GW-1"],
      }),
    );
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
  });

  it("400 — empty gatewayIds", async () => {
    const event = makeEvent(
      adminToken(),
      JSON.stringify({
        mode: "self_consumption",
        socMinLimit: 20,
        socMaxLimit: 95,
        gatewayIds: [],
      }),
    );
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
    const body = parseBody(result);
    expect(body.error).toContain("non-empty");
  });

  it("400 — gatewayIds > 100", async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `GW-${i}`);
    const event = makeEvent(
      adminToken(),
      JSON.stringify({
        mode: "self_consumption",
        socMinLimit: 20,
        socMaxLimit: 95,
        gatewayIds: ids,
      }),
    );
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
    const body = parseBody(result);
    expect(body.error).toContain("at most 100");
  });

  it("400 — arbSlots not covering 0-24h", async () => {
    const event = makeEvent(
      adminToken(),
      JSON.stringify({
        mode: "peak_valley_arbitrage",
        socMinLimit: 20,
        socMaxLimit: 95,
        arbSlots: [{ startHour: 0, endHour: 12, action: "charge" }],
        gatewayIds: ["GW-1"],
      }),
    );
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
    const body = parseBody(result);
    expect(body.error).toContain("end at hour 24");
  });

  it("400 — arbSlots with gap", async () => {
    const event = makeEvent(
      adminToken(),
      JSON.stringify({
        mode: "peak_valley_arbitrage",
        socMinLimit: 20,
        socMaxLimit: 95,
        arbSlots: [
          { startHour: 0, endHour: 6, action: "charge" },
          { startHour: 8, endHour: 24, action: "discharge" },
        ],
        gatewayIds: ["GW-1"],
      }),
    );
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
    const body = parseBody(result);
    expect(body.error).toContain("gap or overlap");
  });

  // ── Auth Tests ───────────────────────────────────────────────────

  it("403 — rejects ORG_VIEWER", async () => {
    const event = makeEvent(viewerToken(), selfConsumptionBody(["GW-1"]));
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(403);
  });

  it("200 — allows ORG_OPERATOR", async () => {
    setupSuccessMocks(["GW-1"], [42]);
    const event = makeEvent(operatorToken(), selfConsumptionBody(["GW-1"]));
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(200);
  });

  it("200 — allows SOLFACIL_ADMIN", async () => {
    setupSuccessMocks(["GW-1"], [42]);
    const event = makeEvent(adminToken(), selfConsumptionBody(["GW-1"]));
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(200);
  });

  it("200 — allows ORG_MANAGER", async () => {
    setupSuccessMocks(["GW-1"], [42]);
    const event = makeEvent(
      JSON.stringify({ userId: "u1", orgId: "ORG_001", role: "ORG_MANAGER" }),
      selfConsumptionBody(["GW-1"]),
    );
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(200);
  });

  // ── Self-consumption Mode ────────────────────────────────────────

  it("self_consumption — batch dispatch 2 gateways creates 2 pending commands", async () => {
    setupSuccessMocks(["GW-1", "GW-2"], [10, 11]);

    const event = makeEvent(
      adminToken(),
      selfConsumptionBody(["GW-1", "GW-2"]),
    );
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    const body = parseBody(result);
    expect(body.data).toHaveProperty("batchId");
    expect((body.data as Record<string, unknown>).batchId).toMatch(/^batch-/);

    const results = (body.data as Record<string, unknown>).results as Array<
      Record<string, unknown>
    >;
    expect(results).toHaveLength(2);
    expect(results[0].status).toBe("pending");
    expect(results[0].commandId).toBe(10);
    expect(results[1].status).toBe("pending");
    expect(results[1].commandId).toBe(11);

    const summary = (body.data as Record<string, unknown>).summary as Record<
      string,
      number
    >;
    expect(summary.total).toBe(2);
    expect(summary.pending).toBe(2);
    expect(summary.skipped).toBe(0);

    // Verify INSERT calls include batch_id and source='p4'
    const insertCall = mockQueryWithOrg.mock.calls[4]; // 5th call = first INSERT
    expect(insertCall[0]).toContain("INSERT INTO device_command_logs");
    expect(insertCall[0]).toContain("batch_id");
    expect(insertCall[0]).toContain("'p4'");

    // Verify payload contains correct slots
    const payload = JSON.parse(insertCall[1][1]);
    expect(payload.slots).toHaveLength(1);
    expect(payload.slots[0].mode).toBe("self_consumption");
    expect(payload.slots[0].startMinute).toBe(0);
    expect(payload.slots[0].endMinute).toBe(1440);
  });

  // ── Peak Shaving Mode ───────────────────────────────────────────

  it("peak_shaving — gridImportLimitKw overrides historical value", async () => {
    // Q1: RLS
    mockQueryWithOrg.mockResolvedValueOnce({
      rows: [{ gateway_id: "GW-1" }],
    });
    // Q2: historical schedule with different gridImportLimitKw
    mockQueryWithOrg.mockResolvedValueOnce({
      rows: [
        {
          gateway_id: "GW-1",
          payload_json: {
            socMinLimit: 10,
            socMaxLimit: 90,
            maxChargeCurrent: 50,
            maxDischargeCurrent: 50,
            gridImportLimitKw: 3000,
            slots: [
              { mode: "self_consumption", startMinute: 0, endMinute: 1440 },
            ],
          },
        },
      ],
    });
    // Q3: no active commands
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [] });
    // Q4: rated capacity (none)
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [] });
    // Q5: INSERT
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [{ id: "20" }] });

    const event = makeEvent(adminToken(), peakShavingBody(["GW-1"]));
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);

    // Verify payload uses P4's gridImportLimitKw (50), not historical (3000)
    const insertCall = mockQueryWithOrg.mock.calls[4];
    const payload = JSON.parse(insertCall[1][1]);
    expect(payload.gridImportLimitKw).toBe(50);
    // Historical charge/discharge current preserved
    expect(payload.maxChargeCurrent).toBe(50);
    expect(payload.maxDischargeCurrent).toBe(50);
    // P4's SoC values
    expect(payload.socMinLimit).toBe(20);
    expect(payload.socMaxLimit).toBe(95);
    // Single peak_shaving slot
    expect(payload.slots).toHaveLength(1);
    expect(payload.slots[0].mode).toBe("peak_shaving");
  });

  // ── Arbitrage Mode ──────────────────────────────────────────────

  it("peak_valley_arbitrage — arbSlots correctly converted to DomainSlots", async () => {
    setupSuccessMocks(["GW-1"], [30]);

    const event = makeEvent(adminToken(), arbitrageBody(["GW-1"]));
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);

    const insertCall = mockQueryWithOrg.mock.calls[4];
    const payload = JSON.parse(insertCall[1][1]);
    expect(payload.slots).toHaveLength(2);
    expect(payload.slots[0]).toEqual({
      mode: "peak_valley_arbitrage",
      action: "charge",
      startMinute: 0,
      endMinute: 360,
    });
    expect(payload.slots[1]).toEqual({
      mode: "peak_valley_arbitrage",
      action: "discharge",
      startMinute: 360,
      endMinute: 1440,
    });
  });

  // ── Edge Cases ──────────────────────────────────────────────────

  it("gateway not found / RLS failure — skipped with reason", async () => {
    // Q1: RLS returns only GW-1
    mockQueryWithOrg.mockResolvedValueOnce({
      rows: [{ gateway_id: "GW-1" }],
    });
    // Q2: no history
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [] });
    // Q3: no active
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [] });
    // Q4: rated capacity (none)
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [] });
    // Q5: INSERT for GW-1
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [{ id: "40" }] });

    const event = makeEvent(
      adminToken(),
      selfConsumptionBody(["GW-1", "GW-MISSING"]),
    );
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    const body = parseBody(result);
    const results = (body.data as Record<string, unknown>).results as Array<
      Record<string, unknown>
    >;
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      gatewayId: "GW-1",
      status: "pending",
      commandId: 40,
    });
    expect(results[1]).toEqual({
      gatewayId: "GW-MISSING",
      status: "skipped",
      reason: "gateway_not_found",
    });
  });

  it("active command conflict — skipped with reason", async () => {
    // Q1: RLS
    mockQueryWithOrg.mockResolvedValueOnce({
      rows: [{ gateway_id: "GW-1" }, { gateway_id: "GW-2" }],
    });
    // Q2: no history
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [] });
    // Q3: GW-2 has active command
    mockQueryWithOrg.mockResolvedValueOnce({
      rows: [{ gateway_id: "GW-2" }],
    });
    // Q4: rated capacity (none)
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [] });
    // Q5: INSERT for GW-1
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [{ id: "50" }] });

    const event = makeEvent(
      adminToken(),
      selfConsumptionBody(["GW-1", "GW-2"]),
    );
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    const body = parseBody(result);
    const results = (body.data as Record<string, unknown>).results as Array<
      Record<string, unknown>
    >;
    expect(results[0].status).toBe("pending");
    expect(results[1]).toEqual({
      gatewayId: "GW-2",
      status: "skipped",
      reason: "active_command",
    });

    const summary = (body.data as Record<string, unknown>).summary as Record<
      string,
      number
    >;
    expect(summary.pending).toBe(1);
    expect(summary.skipped).toBe(1);
  });

  it("no historical schedule — uses safe defaults", async () => {
    setupSuccessMocks(["GW-1"], [60]);

    const event = makeEvent(adminToken(), selfConsumptionBody(["GW-1"]));
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);

    const insertCall = mockQueryWithOrg.mock.calls[4];
    const payload = JSON.parse(insertCall[1][1]);
    expect(payload.maxChargeCurrent).toBe(100);
    expect(payload.maxDischargeCurrent).toBe(100);
    expect(payload.gridImportLimitKw).toBe(3000);
  });

  it("with historical schedule — reads historical power values", async () => {
    // Q1: RLS
    mockQueryWithOrg.mockResolvedValueOnce({
      rows: [{ gateway_id: "GW-1" }],
    });
    // Q2: historical with custom power values
    mockQueryWithOrg.mockResolvedValueOnce({
      rows: [
        {
          gateway_id: "GW-1",
          payload_json: {
            socMinLimit: 15,
            socMaxLimit: 90,
            maxChargeCurrent: 25,
            maxDischargeCurrent: 30,
            gridImportLimitKw: 500,
            slots: [
              { mode: "self_consumption", startMinute: 0, endMinute: 1440 },
            ],
          },
        },
      ],
    });
    // Q3: no active
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [] });
    // Q4: rated capacity (none)
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [] });
    // Q5: INSERT
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [{ id: "70" }] });

    const event = makeEvent(adminToken(), selfConsumptionBody(["GW-1"]));
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);

    const insertCall = mockQueryWithOrg.mock.calls[4];
    const payload = JSON.parse(insertCall[1][1]);
    // Power from historical
    expect(payload.maxChargeCurrent).toBe(25);
    expect(payload.maxDischargeCurrent).toBe(30);
    // gridImportLimitKw from historical (non-peak_shaving mode)
    expect(payload.gridImportLimitKw).toBe(500);
    // SoC from P4 request
    expect(payload.socMinLimit).toBe(20);
    expect(payload.socMaxLimit).toBe(95);
  });

  it("mixed results — 2 pending + 1 skipped → summary correct", async () => {
    // Q1: RLS — all 3 exist
    mockQueryWithOrg.mockResolvedValueOnce({
      rows: [
        { gateway_id: "GW-1" },
        { gateway_id: "GW-2" },
        { gateway_id: "GW-3" },
      ],
    });
    // Q2: no history
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [] });
    // Q3: GW-3 has active command
    mockQueryWithOrg.mockResolvedValueOnce({
      rows: [{ gateway_id: "GW-3" }],
    });
    // Q4: rated capacity (none)
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [] });
    // Q5: INSERT GW-1
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [{ id: "80" }] });
    // Q6: INSERT GW-2
    mockQueryWithOrg.mockResolvedValueOnce({ rows: [{ id: "81" }] });

    const event = makeEvent(
      adminToken(),
      selfConsumptionBody(["GW-1", "GW-2", "GW-3"]),
    );
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    const body = parseBody(result);
    const summary = (body.data as Record<string, unknown>).summary as Record<
      string,
      number
    >;
    expect(summary.total).toBe(3);
    expect(summary.pending).toBe(2);
    expect(summary.skipped).toBe(1);
  });

  it("batch_id format is correct", async () => {
    setupSuccessMocks(["GW-1"], [90]);

    const event = makeEvent(adminToken(), selfConsumptionBody(["GW-1"]));
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    const body = parseBody(result);
    const batchId = (body.data as Record<string, unknown>).batchId as string;
    expect(batchId).toMatch(/^batch-\d+-[0-9a-f]{4}$/);
  });

  it("batch_id is consistent across all INSERTs", async () => {
    setupSuccessMocks(["GW-1", "GW-2"], [91, 92]);

    const event = makeEvent(
      adminToken(),
      selfConsumptionBody(["GW-1", "GW-2"]),
    );
    await handler(event);

    // Both INSERTs should have same batch_id
    const insert1 = mockQueryWithOrg.mock.calls[4];
    const insert2 = mockQueryWithOrg.mock.calls[5];
    const batchId1 = insert1[1][2]; // 3rd param = batch_id
    const batchId2 = insert2[1][2];
    expect(batchId1).toBe(batchId2);
    expect(batchId1).toMatch(/^batch-/);
  });
});
