import type { APIGatewayProxyEventV2 } from "aws-lambda";
import {
  extractTenantContext,
  requireRole,
} from "../../src/bff/middleware/auth";
import { Role } from "../../src/shared/types/auth";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(authHeader?: string): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: "GET /test",
    rawPath: "/test",
    rawQueryString: "",
    headers: authHeader !== undefined ? { authorization: authHeader } : {},
    requestContext: {
      accountId: "test",
      apiId: "test",
      domainName: "test",
      domainPrefix: "test",
      http: {
        method: "GET",
        path: "/test",
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "test",
      },
      requestId: "test-1",
      routeKey: "GET /test",
      stage: "$default",
      time: new Date().toISOString(),
      timeEpoch: Date.now(),
    },
    isBase64Encoded: false,
  };
}

// ---------------------------------------------------------------------------
// extractTenantContext
// ---------------------------------------------------------------------------

describe("extractTenantContext", () => {
  it("parses raw JSON token from Authorization header", () => {
    const token = JSON.stringify({
      userId: "u1",
      orgId: "ORG_ENERGIA_001",
      role: "ORG_MANAGER",
    });
    const ctx = extractTenantContext(makeEvent(token));

    expect(ctx).toEqual({
      userId: "u1",
      orgId: "ORG_ENERGIA_001",
      role: Role.ORG_MANAGER,
    });
  });

  it("parses JWT-style token (Base64 payload)", () => {
    const payload = Buffer.from(
      JSON.stringify({
        userId: "u2",
        orgId: "ORG_SOLARBR_002",
        role: "ORG_OPERATOR",
      }),
    ).toString("base64");
    const jwt = `eyJhbGciOiJIUzI1NiJ9.${payload}.fake-sig`;

    const ctx = extractTenantContext(makeEvent(jwt));

    expect(ctx).toEqual({
      userId: "u2",
      orgId: "ORG_SOLARBR_002",
      role: Role.ORG_OPERATOR,
    });
  });

  it("parses JWT-style token with Bearer prefix", () => {
    const payload = Buffer.from(
      JSON.stringify({
        userId: "u3",
        orgId: "ORG_ENERGIA_001",
        role: "SOLFACIL_ADMIN",
      }),
    ).toString("base64");
    const jwt = `Bearer eyJhbGciOiJIUzI1NiJ9.${payload}.fake-sig`;

    const ctx = extractTenantContext(makeEvent(jwt));

    expect(ctx).toEqual({
      userId: "u3",
      orgId: "ORG_ENERGIA_001",
      role: Role.SOLFACIL_ADMIN,
    });
  });

  it("throws 401 when Authorization header is missing", () => {
    expect(() => extractTenantContext(makeEvent(""))).toThrow(
      expect.objectContaining({ statusCode: 401, message: "Unauthorized" }),
    );
  });

  it("throws 401 when no headers contain authorization", () => {
    expect(() => extractTenantContext(makeEvent(undefined))).toThrow(
      expect.objectContaining({ statusCode: 401 }),
    );
  });

  it("throws 401 for malformed JSON", () => {
    expect(() => extractTenantContext(makeEvent("{bad-json"))).toThrow(
      expect.objectContaining({ statusCode: 401, message: "Invalid token" }),
    );
  });

  it("throws 401 when required claims are missing", () => {
    const token = JSON.stringify({ userId: "u1" }); // missing orgId & role
    expect(() => extractTenantContext(makeEvent(token))).toThrow(
      expect.objectContaining({ statusCode: 401, message: "Invalid token" }),
    );
  });

  it("throws 401 for invalid role value", () => {
    const token = JSON.stringify({
      userId: "u1",
      orgId: "ORG_X",
      role: "SUPER_HACKER",
    });
    expect(() => extractTenantContext(makeEvent(token))).toThrow(
      expect.objectContaining({ statusCode: 401, message: "Invalid token" }),
    );
  });
});

// ---------------------------------------------------------------------------
// requireRole
// ---------------------------------------------------------------------------

describe("requireRole", () => {
  it("allows access when role is in the allowed list", () => {
    const ctx = { userId: "u1", orgId: "ORG_X", role: Role.ORG_MANAGER };
    expect(() =>
      requireRole(ctx, [Role.ORG_MANAGER, Role.ORG_OPERATOR]),
    ).not.toThrow();
  });

  it("throws 403 when role is not in the allowed list", () => {
    const ctx = { userId: "u1", orgId: "ORG_X", role: Role.ORG_VIEWER };
    expect(() => requireRole(ctx, [Role.ORG_MANAGER])).toThrow(
      expect.objectContaining({ statusCode: 403, message: "Forbidden" }),
    );
  });

  it("SOLFACIL_ADMIN bypasses all role checks", () => {
    const ctx = {
      userId: "admin",
      orgId: "SOLFACIL",
      role: Role.SOLFACIL_ADMIN,
    };
    // Even with an empty allowed list, admin should pass
    expect(() => requireRole(ctx, [])).not.toThrow();
  });
});
