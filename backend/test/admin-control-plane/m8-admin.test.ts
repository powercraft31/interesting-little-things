/**
 * M8 Admin Control Plane — Unit Tests
 *
 * Covers all 4 handlers:
 *   1. get-parser-rules:  happy path, ORG_VIEWER 403, DB error
 *   2. create-parser-rule: happy path, missing manufacturer, bad unitConversions.factor
 *   3. get-vpp-strategies: happy path (ORG_OPERATOR OK), ORG_VIEWER 403
 *   4. update-vpp-strategy:
 *      - happy path update
 *      - min_soc=90 max_soc=10 → 400 (bulletproof test)
 *      - min_soc=200 → 400 (out of range)
 *      - emergencySoc >= minSoc → 400
 *      - strategy not found → 404
 *      - ORG_VIEWER → 403
 */

// ---------------------------------------------------------------------------
// Mock pg BEFORE importing handlers
// ---------------------------------------------------------------------------

const mockRelease = jest.fn();
const mockQuery = jest.fn();
const mockConnect = jest.fn();

jest.mock("pg", () => {
  return {
    Pool: jest.fn().mockImplementation(() => ({
      connect: mockConnect,
    })),
  };
});

process.env.DATABASE_URL = "postgres://localhost:5432/vpp_test";

import { handler as getParserRules } from "../../src/admin-control-plane/handlers/get-parser-rules";
import { handler as createParserRule } from "../../src/admin-control-plane/handlers/create-parser-rule";
import { handler as getVppStrategies } from "../../src/admin-control-plane/handlers/get-vpp-strategies";
import { handler as updateVppStrategy } from "../../src/admin-control-plane/handlers/update-vpp-strategy";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64");
  return `${header}.${body}.signature`;
}

function makeEvent(
  overrides: Partial<APIGatewayProxyEventV2> = {},
): APIGatewayProxyEventV2 {
  return {
    headers: {},
    body: undefined,
    routeKey: "GET /admin/parser-rules",
    rawPath: "/admin/parser-rules",
    rawQueryString: "",
    version: "2.0",
    isBase64Encoded: false,
    requestContext: {
      accountId: "123456789012",
      apiId: "api-id",
      domainName: "test.execute-api.us-east-1.amazonaws.com",
      domainPrefix: "test",
      http: {
        method: "GET",
        path: "/admin/parser-rules",
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "test",
      },
      requestId: "req-id",
      routeKey: "GET /admin/parser-rules",
      stage: "$default",
      time: "01/Jan/2026:00:00:00 +0000",
      timeEpoch: 1767225600000,
    },
    ...overrides,
  } as APIGatewayProxyEventV2;
}

const ORG_ID = "ORG_ENERGIA_001";

function authHeader(role: string, orgId = ORG_ID): Record<string, string> {
  return {
    authorization: `Bearer ${makeJwt({ userId: "user-1", orgId, role })}`,
  };
}

const NOW = new Date("2026-02-21T10:00:00.000Z");

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockReset();
  mockRelease.mockReset();
  mockConnect.mockResolvedValue({
    query: mockQuery,
    release: mockRelease,
  });
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ===========================================================================
// 1. get-parser-rules
// ===========================================================================

describe("get-parser-rules handler", () => {
  it("returns parser rules for ORG_MANAGER", async () => {
    const fakeRows = [
      {
        id: "r1", org_id: ORG_ID, manufacturer: "Huawei", model_version: "*",
        mapping_rule: { devSn: "deviceId" }, unit_conversions: { p: { factor: 0.001 } },
        is_active: true, created_at: NOW, updated_at: NOW,
      },
    ];

    // BEGIN, SET LOCAL, SELECT, COMMIT
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    mockQuery.mockResolvedValueOnce({ rows: fakeRows, rowCount: 1 });
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const event = makeEvent({ headers: authHeader("ORG_MANAGER") });
    const result = await getParserRules(event);

    expect(result.statusCode).toBe(200);

    const body = JSON.parse(result.body as string);
    expect(body.total).toBe(1);
    expect(body.orgId).toBe(ORG_ID);
    expect(body.data[0].manufacturer).toBe("Huawei");
    expect(body.data[0].mappingRule).toEqual({ devSn: "deviceId" });

    // Verify SET LOCAL used parameterized query
    expect(mockQuery.mock.calls[1][0]).toBe("SET LOCAL app.current_org_id = $1");
    expect(mockQuery.mock.calls[1][1]).toEqual([ORG_ID]);

    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  it("returns 403 for ORG_VIEWER", async () => {
    const event = makeEvent({ headers: authHeader("ORG_VIEWER") });
    const result = await getParserRules(event);

    expect(result.statusCode).toBe(403);
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it("returns 500 and ROLLBACK on DB error", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // BEGIN
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // SET LOCAL
    mockQuery.mockRejectedValueOnce(new Error("connection reset")); // SELECT
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // ROLLBACK

    const event = makeEvent({ headers: authHeader("ORG_MANAGER") });
    const result = await getParserRules(event);

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body as string);
    expect(body.error).toBe("Internal server error");
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// 2. create-parser-rule
// ===========================================================================

describe("create-parser-rule handler", () => {
  it("creates a parser rule and returns 201", async () => {
    const returnedRow = {
      id: "new-uuid", org_id: ORG_ID, manufacturer: "Growatt",
      model_version: "*", mapping_rule: { sn: "deviceId" },
      unit_conversions: {}, is_active: true, created_at: NOW, updated_at: NOW,
    };

    // BEGIN, SET LOCAL, INSERT RETURNING, COMMIT
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    mockQuery.mockResolvedValueOnce({ rows: [returnedRow], rowCount: 1 });
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const event = makeEvent({
      headers: authHeader("ORG_MANAGER"),
      body: JSON.stringify({
        manufacturer: "Growatt",
        mappingRule: { sn: "deviceId" },
      }),
    });
    const result = await createParserRule(event);

    expect(result.statusCode).toBe(201);

    const body = JSON.parse(result.body as string);
    expect(body.data.manufacturer).toBe("Growatt");
    expect(body.orgId).toBe(ORG_ID);
  });

  it("returns 400 when manufacturer is missing", async () => {
    const event = makeEvent({
      headers: authHeader("ORG_MANAGER"),
      body: JSON.stringify({ mappingRule: { sn: "deviceId" } }),
    });
    const result = await createParserRule(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error).toContain("manufacturer");
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it("returns 400 when unitConversions.factor <= 0", async () => {
    const event = makeEvent({
      headers: authHeader("ORG_MANAGER"),
      body: JSON.stringify({
        manufacturer: "BadDevice",
        mappingRule: { x: "y" },
        unitConversions: { power: { factor: -1 } },
      }),
    });
    const result = await createParserRule(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error).toContain("unitConversions.power.factor");
    expect(mockConnect).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 3. get-vpp-strategies
// ===========================================================================

describe("get-vpp-strategies handler", () => {
  it("returns strategies for ORG_OPERATOR (read access)", async () => {
    const fakeRows = [
      {
        id: "s1", org_id: ORG_ID, strategy_name: "Conservative",
        min_soc: "20.00", max_soc: "80.00", emergency_soc: "10.00",
        profit_margin: "0.1500", active_hours: { start: 18, end: 21 },
        active_weekdays: [1, 2, 3, 4, 5], is_default: true, is_active: true,
        created_at: NOW, updated_at: NOW,
      },
    ];

    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // BEGIN
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // SET LOCAL
    mockQuery.mockResolvedValueOnce({ rows: fakeRows, rowCount: 1 }); // SELECT
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // COMMIT

    const event = makeEvent({ headers: authHeader("ORG_OPERATOR") });
    const result = await getVppStrategies(event);

    expect(result.statusCode).toBe(200);

    const body = JSON.parse(result.body as string);
    expect(body.total).toBe(1);
    expect(body.data[0].strategyName).toBe("Conservative");
    expect(body.data[0].minSoc).toBe(20);
    expect(body.data[0].maxSoc).toBe(80);
    expect(body.data[0].isDefault).toBe(true);
  });

  it("returns 403 for ORG_VIEWER", async () => {
    const event = makeEvent({ headers: authHeader("ORG_VIEWER") });
    const result = await getVppStrategies(event);

    expect(result.statusCode).toBe(403);
    expect(mockConnect).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 4. update-vpp-strategy
// ===========================================================================

describe("update-vpp-strategy handler", () => {
  const STRATEGY_ID = "strat-uuid-001";

  function updateEvent(
    body: Record<string, unknown>,
    role = "ORG_MANAGER",
    stratId = STRATEGY_ID,
  ) {
    return makeEvent({
      headers: authHeader(role),
      pathParameters: { id: stratId },
      body: JSON.stringify(body),
    });
  }

  it("updates strategy and returns 200", async () => {
    const updatedRow = {
      id: STRATEGY_ID, org_id: ORG_ID, strategy_name: "Aggressive",
      min_soc: "20.00", max_soc: "90.00", emergency_soc: "10.00",
      profit_margin: "0.2000", active_hours: { start: 17, end: 22 },
      active_weekdays: [1, 2, 3, 4, 5], is_default: false, is_active: true,
      created_at: NOW, updated_at: NOW,
    };

    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // BEGIN
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // SET LOCAL
    mockQuery.mockResolvedValueOnce({ rows: [{ id: STRATEGY_ID }], rowCount: 1 }); // SELECT existence
    mockQuery.mockResolvedValueOnce({ rows: [updatedRow], rowCount: 1 }); // UPDATE RETURNING
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // COMMIT

    const event = updateEvent({ strategyName: "Aggressive", maxSoc: 90, profitMargin: 0.2 });
    const result = await updateVppStrategy(event);

    expect(result.statusCode).toBe(200);

    const body = JSON.parse(result.body as string);
    expect(body.data.strategyName).toBe("Aggressive");
    expect(body.data.maxSoc).toBe(90);
    expect(body.data.profitMargin).toBe(0.2);
    expect(body.orgId).toBe(ORG_ID);
  });

  // ── Bulletproof test: min_soc=90 > max_soc=10 ──────────────────────────
  it("returns 400 when minSoc=90, maxSoc=10 (inverted order)", async () => {
    const event = updateEvent({ minSoc: 90, maxSoc: 10 });
    const result = await updateVppStrategy(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error).toContain("minSoc");
    expect(mockConnect).not.toHaveBeenCalled();
  });

  // ── Out of range: minSoc=200 ──────────────────────────────────────────
  it("returns 400 when minSoc=200 (out of range)", async () => {
    const event = updateEvent({ minSoc: 200 });
    const result = await updateVppStrategy(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error).toContain("minSoc must be between 10 and 50");
    expect(mockConnect).not.toHaveBeenCalled();
  });

  // ── emergencySoc >= minSoc ──────────────────────────────────────────────
  it("returns 400 when emergencySoc >= minSoc", async () => {
    const event = updateEvent({ emergencySoc: 20, minSoc: 15 });
    const result = await updateVppStrategy(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error).toContain("emergencySoc");
    expect(body.error).toContain("less than minSoc");
    expect(mockConnect).not.toHaveBeenCalled();
  });

  // ── Strategy not found → 404 ──────────────────────────────────────────
  it("returns 404 when strategy is not found", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // BEGIN
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // SET LOCAL
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // SELECT existence → 0 rows
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // ROLLBACK

    const event = updateEvent({ strategyName: "Ghost" }, "ORG_MANAGER", "non-existent-id");
    const result = await updateVppStrategy(event);

    expect(result.statusCode).toBe(404);
    const body = JSON.parse(result.body as string);
    expect(body.error).toBe("Strategy not found");
  });

  // ── ORG_VIEWER → 403 ──────────────────────────────────────────────────
  it("returns 403 for ORG_VIEWER", async () => {
    const event = updateEvent({ strategyName: "Nope" }, "ORG_VIEWER");
    const result = await updateVppStrategy(event);

    expect(result.statusCode).toBe(403);
    expect(mockConnect).not.toHaveBeenCalled();
  });
});
