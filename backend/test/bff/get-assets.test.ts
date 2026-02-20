import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { handler } from "../../src/bff/handlers/get-assets";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(authHeader?: string): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: "GET /assets",
    rawPath: "/assets",
    rawQueryString: "",
    headers: authHeader !== undefined ? { authorization: authHeader } : {},
    requestContext: {
      accountId: "test",
      apiId: "test",
      domainName: "test",
      domainPrefix: "test",
      http: {
        method: "GET",
        path: "/assets",
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "test",
      },
      requestId: "test-1",
      routeKey: "GET /assets",
      stage: "$default",
      time: new Date().toISOString(),
      timeEpoch: Date.now(),
    },
    isBase64Encoded: false,
  };
}

function tokenFor(userId: string, orgId: string, role: string): string {
  return JSON.stringify({ userId, orgId, role });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /assets handler", () => {
  it("SOLFACIL_ADMIN receives all assets (unfiltered)", async () => {
    const event = makeEvent(tokenFor("admin", "SOLFACIL", "SOLFACIL_ADMIN"));
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);

    const body = JSON.parse(result.body as string);
    expect(body.success).toBe(true);
    expect(body.data.assets).toHaveLength(4);

    // Verify all 4 asset IDs present
    const ids = body.data.assets.map((a: { id: string }) => a.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "ASSET_SP_001",
        "ASSET_RJ_002",
        "ASSET_MG_003",
        "ASSET_PR_004",
      ]),
    );

    // Deep assert: _tenant envelope reflects the caller's identity
    expect(body.data._tenant).toEqual({
      orgId: "SOLFACIL",
      role: "SOLFACIL_ADMIN",
    });
  });

  it("ORG_ENERGIA_001 only receives its own assets", async () => {
    const event = makeEvent(tokenFor("u1", "ORG_ENERGIA_001", "ORG_MANAGER"));
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);

    const body = JSON.parse(result.body as string);
    expect(body.success).toBe(true);
    expect(body.data.assets).toHaveLength(2);

    // Deep assert: every asset belongs to this org (no cross-tenant leak)
    expect(
      body.data.assets.every(
        (a: { orgId: string }) => a.orgId === "ORG_ENERGIA_001",
      ),
    ).toBe(true);

    // Cross-contamination guard: ORG_SOLARBR_002 assets must be absent
    const ids = body.data.assets.map((a: { id: string }) => a.id);
    expect(ids).toEqual(
      expect.arrayContaining(["ASSET_SP_001", "ASSET_RJ_002"]),
    );
    expect(ids).not.toContain("ASSET_MG_003");
    expect(ids).not.toContain("ASSET_PR_004");

    // Deep assert: _tenant envelope matches caller's orgId and role
    expect(body.data._tenant).toEqual({
      orgId: "ORG_ENERGIA_001",
      role: "ORG_MANAGER",
    });
  });

  it("ORG_SOLARBR_002 only receives its own assets", async () => {
    const event = makeEvent(tokenFor("u2", "ORG_SOLARBR_002", "ORG_OPERATOR"));
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);

    const body = JSON.parse(result.body as string);
    expect(body.success).toBe(true);
    expect(body.data.assets).toHaveLength(2);

    // Deep assert: every asset belongs to this org (no cross-tenant leak)
    expect(
      body.data.assets.every(
        (a: { orgId: string }) => a.orgId === "ORG_SOLARBR_002",
      ),
    ).toBe(true);

    // Cross-contamination guard: ORG_ENERGIA_001 assets must be absent
    const ids = body.data.assets.map((a: { id: string }) => a.id);
    expect(ids).toEqual(
      expect.arrayContaining(["ASSET_MG_003", "ASSET_PR_004"]),
    );
    expect(ids).not.toContain("ASSET_SP_001");
    expect(ids).not.toContain("ASSET_RJ_002");

    // Deep assert: _tenant envelope matches caller's orgId and role
    expect(body.data._tenant).toEqual({
      orgId: "ORG_SOLARBR_002",
      role: "ORG_OPERATOR",
    });
  });

  it("returns 401 when no Authorization token is provided", async () => {
    const event = makeEvent("");
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(401);

    const body = JSON.parse(result.body as string);
    expect(body.success).toBe(false);
    expect(body.error).toBeDefined();
  });

  it("returns 401 when Authorization header is missing entirely", async () => {
    const event = makeEvent(undefined);
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(401);
  });
});
