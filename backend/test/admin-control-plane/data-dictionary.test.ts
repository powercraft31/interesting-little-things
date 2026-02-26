/**
 * M8 Data Dictionary — Unit Tests
 *
 * Covers all 3 handlers:
 *   1. get-data-dictionary:    scan returns entries
 *   2. create-dictionary-field: validation + happy path
 *   3. delete-dictionary-field: dependency lock + happy path + 404
 */

import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, ScanCommand, PutCommand, DeleteCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

// ---------------------------------------------------------------------------
// DynamoDB mock — must be created before handler imports
// ---------------------------------------------------------------------------

const ddbMock = mockClient(DynamoDBDocumentClient);

// ---------------------------------------------------------------------------
// Import handlers (after mock is in place)
// ---------------------------------------------------------------------------

import { handler as getDictionary } from "../../src/admin-control-plane/handlers/get-data-dictionary";
import { handler as createField } from "../../src/admin-control-plane/handlers/create-dictionary-field";
import { handler as deleteField } from "../../src/admin-control-plane/handlers/delete-dictionary-field";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(
  overrides: Partial<APIGatewayProxyEventV2> = {},
): APIGatewayProxyEventV2 {
  return {
    headers: {},
    body: undefined,
    routeKey: "GET /admin/dictionary",
    rawPath: "/admin/dictionary",
    rawQueryString: "",
    version: "2.0",
    isBase64Encoded: false,
    requestContext: {
      accountId: "123456789012",
      apiId: "api-id",
      domainName: "localhost",
      domainPrefix: "localhost",
      http: {
        method: "GET",
        path: "/admin/dictionary",
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "jest",
      },
      requestId: "req-id",
      routeKey: "GET /admin/dictionary",
      stage: "$default",
      time: "01/Jan/2026:00:00:00 +0000",
      timeEpoch: 0,
    },
    pathParameters: undefined,
    ...overrides,
  } as APIGatewayProxyEventV2;
}

// ---------------------------------------------------------------------------
// Reset mocks before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  ddbMock.reset();
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════
// Suite 1: get-data-dictionary
// ═══════════════════════════════════════════════════════════════════════════

describe("get-data-dictionary", () => {
  it("returns list of DataDictionaryEntry from DynamoDB scan", async () => {
    const items = [
      {
        fieldId: "status.battery_soc",
        domain: "status",
        valueType: "number",
        displayName: "Battery SoC",
      },
      {
        fieldId: "metering.grid_power_kw",
        domain: "metering",
        valueType: "number",
        displayName: "Grid Power (kW)",
        description: "Real-time grid power measurement",
      },
    ];

    ddbMock.on(ScanCommand).resolves({ Items: items });

    const result = await getDictionary(makeEvent());

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body!);
    expect(body.fields).toHaveLength(2);
    expect(body.fields[0]).toEqual({
      fieldId: "status.battery_soc",
      domain: "status",
      valueType: "number",
      displayName: "Battery SoC",
    });
    expect(body.fields[1]).toEqual({
      fieldId: "metering.grid_power_kw",
      domain: "metering",
      valueType: "number",
      displayName: "Grid Power (kW)",
      description: "Real-time grid power measurement",
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Suite 2: create-dictionary-field
// ═══════════════════════════════════════════════════════════════════════════

describe("create-dictionary-field", () => {
  const validInput = {
    fieldId: "status.chiller_temp",
    domain: "status",
    valueType: "number",
    displayName: "Chiller Temperature",
  };

  it("creates field successfully", async () => {
    ddbMock.on(PutCommand).resolves({});

    const event = makeEvent({
      body: JSON.stringify(validInput),
      routeKey: "POST /admin/dictionary",
      rawPath: "/admin/dictionary",
    });

    const result = await createField(event);

    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body!);
    expect(body).toEqual(validInput);
  });

  it("returns 400 when fieldId is missing", async () => {
    const { fieldId: _, ...noFieldId } = validInput;
    const event = makeEvent({
      body: JSON.stringify(noFieldId),
      routeKey: "POST /admin/dictionary",
    });

    const result = await createField(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body!);
    expect(body.error).toContain("fieldId");
  });

  it("returns 400 when domain is invalid", async () => {
    const event = makeEvent({
      body: JSON.stringify({ ...validInput, domain: "invalid_domain" }),
      routeKey: "POST /admin/dictionary",
    });

    const result = await createField(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body!);
    expect(body.error).toContain("domain");
  });

  it("returns 400 when fieldId format is wrong", async () => {
    const event = makeEvent({
      body: JSON.stringify({ ...validInput, fieldId: "badformat" }),
      routeKey: "POST /admin/dictionary",
    });

    const result = await createField(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body!);
    expect(body.error).toContain("fieldId");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Suite 3: delete-dictionary-field (critical — dependency lock)
// ═══════════════════════════════════════════════════════════════════════════

describe("delete-dictionary-field", () => {
  it("BLOCKS deletion of protected field (status.battery_soc) with 409", async () => {
    const event = makeEvent({
      routeKey: "DELETE /admin/dictionary/{fieldId}",
      rawPath: "/admin/dictionary/status.battery_soc",
      pathParameters: { fieldId: "status.battery_soc" },
    });

    const result = await deleteField(event);

    expect(result.statusCode).toBe(409);
    const body = JSON.parse(result.body!);
    expect(body.message).toContain("currently in use");

    // CRITICAL: DynamoDB DeleteCommand must NEVER be called for protected fields
    const deleteCalls = ddbMock.commandCalls(DeleteCommand);
    expect(deleteCalls).toHaveLength(0);
  });

  it("BLOCKS deletion of protected field (metering.grid_power_kw) with 409", async () => {
    const event = makeEvent({
      routeKey: "DELETE /admin/dictionary/{fieldId}",
      rawPath: "/admin/dictionary/metering.grid_power_kw",
      pathParameters: { fieldId: "metering.grid_power_kw" },
    });

    const result = await deleteField(event);

    expect(result.statusCode).toBe(409);
    const body = JSON.parse(result.body!);
    expect(body.message).toContain("currently in use");

    // CRITICAL: DynamoDB DeleteCommand must NEVER be called for protected fields
    const deleteCalls = ddbMock.commandCalls(DeleteCommand);
    expect(deleteCalls).toHaveLength(0);
  });

  it("ALLOWS deletion of non-protected custom field", async () => {
    ddbMock.on(GetCommand).resolves({
      Item: {
        fieldId: "status.custom_sensor_x",
        domain: "status",
        valueType: "number",
        displayName: "Custom Sensor X",
      },
    });
    ddbMock.on(DeleteCommand).resolves({});

    const event = makeEvent({
      routeKey: "DELETE /admin/dictionary/{fieldId}",
      rawPath: "/admin/dictionary/status.custom_sensor_x",
      pathParameters: { fieldId: "status.custom_sensor_x" },
    });

    const result = await deleteField(event);

    expect(result.statusCode).toBe(204);

    const deleteCalls = ddbMock.commandCalls(DeleteCommand);
    expect(deleteCalls).toHaveLength(1);
  });

  it("returns 404 when field does not exist", async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });

    const event = makeEvent({
      routeKey: "DELETE /admin/dictionary/{fieldId}",
      rawPath: "/admin/dictionary/status.nonexistent_field",
      pathParameters: { fieldId: "status.nonexistent_field" },
    });

    const result = await deleteField(event);

    expect(result.statusCode).toBe(404);
    const body = JSON.parse(result.body!);
    expect(body.error).toContain("not found");
  });
});
