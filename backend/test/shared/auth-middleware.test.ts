/**
 * Tests for authMiddleware + verifyTenantToken (v5.23)
 */
import jwt from "jsonwebtoken";
import { authMiddleware } from "../../src/bff/middleware/auth";
import { verifyTenantToken } from "../../src/shared/middleware/tenant-context";

const JWT_SECRET = "solfacil-dev-secret";

// ── verifyTenantToken tests ──────────────────────────────────────────────

describe("verifyTenantToken", () => {
  it("parses raw JSON path correctly", () => {
    const token = '{"userId":"u1","orgId":"ORG_ENERGIA_001","role":"SOLFACIL_ADMIN"}';
    const ctx = verifyTenantToken(token);
    expect(ctx.userId).toBe("u1");
    expect(ctx.orgId).toBe("ORG_ENERGIA_001");
    expect(ctx.role).toBe("SOLFACIL_ADMIN");
  });

  it("verifies valid JWT and extracts claims", () => {
    const token = jwt.sign(
      { userId: "u2", orgId: "ORG_ENERGIA_001", role: "ORG_MANAGER" },
      JWT_SECRET,
    );
    const ctx = verifyTenantToken(token);
    expect(ctx.userId).toBe("u2");
    expect(ctx.orgId).toBe("ORG_ENERGIA_001");
    expect(ctx.role).toBe("ORG_MANAGER");
  });

  it("throws 401 on expired JWT", () => {
    const token = jwt.sign(
      { userId: "u3", orgId: "ORG_ENERGIA_001", role: "ORG_VIEWER" },
      JWT_SECRET,
      { expiresIn: "-1s" },
    );
    expect(() => verifyTenantToken(token)).toThrow(
      expect.objectContaining({ statusCode: 401, message: "Invalid or expired token" }),
    );
  });

  it("throws 401 on bad signature", () => {
    const token = jwt.sign(
      { userId: "u4", orgId: "ORG_ENERGIA_001", role: "ORG_VIEWER" },
      "wrong-secret",
    );
    expect(() => verifyTenantToken(token)).toThrow(
      expect.objectContaining({ statusCode: 401, message: "Invalid or expired token" }),
    );
  });

  it("throws 401 on empty token", () => {
    expect(() => verifyTenantToken("")).toThrow(
      expect.objectContaining({ statusCode: 401 }),
    );
  });

  it("throws 401 on JWT missing required claims", () => {
    const token = jwt.sign({ userId: "u5" }, JWT_SECRET); // missing orgId and role
    expect(() => verifyTenantToken(token)).toThrow(
      expect.objectContaining({ statusCode: 401, message: "Invalid token" }),
    );
  });
});

// ── authMiddleware tests ─────────────────────────────────────────────────

function mockReq(path: string, authorization?: string) {
  return {
    path,
    headers: authorization !== undefined ? { authorization } : {},
  } as unknown as import("express").Request;
}

function mockRes() {
  const res = {
    statusCode: 0,
    body: null as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(data: unknown) {
      res.body = data;
      return res;
    },
  };
  return res as unknown as import("express").Response & {
    statusCode: number;
    body: { success: boolean; error: string | null };
  };
}

describe("authMiddleware", () => {
  it("skips auth for public route /api/auth/login", () => {
    const req = mockReq("/api/auth/login");
    const res = mockRes();
    const next = jest.fn();

    authMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(0); // res.status was not called
  });

  it("returns 401 when no Authorization header on /api/* route", () => {
    const req = mockReq("/api/dashboard");
    const res = mockRes();
    const next = jest.fn();

    authMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe("Authorization header required");
  });

  it("validates JWT and overwrites header with raw JSON", () => {
    const token = jwt.sign(
      { userId: "u1", orgId: "ORG_ENERGIA_001", role: "SOLFACIL_ADMIN" },
      JWT_SECRET,
    );
    const req = mockReq("/api/dashboard", "Bearer " + token);
    const res = mockRes();
    const next = jest.fn();

    authMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    // Verify header was overwritten with raw JSON
    const overwritten = JSON.parse(req.headers.authorization as string);
    expect(overwritten.userId).toBe("u1");
    expect(overwritten.orgId).toBe("ORG_ENERGIA_001");
    expect(overwritten.role).toBe("SOLFACIL_ADMIN");
  });

  it("returns 401 on expired JWT", () => {
    const token = jwt.sign(
      { userId: "u1", orgId: "ORG_ENERGIA_001", role: "SOLFACIL_ADMIN" },
      JWT_SECRET,
      { expiresIn: "-1s" },
    );
    const req = mockReq("/api/dashboard", "Bearer " + token);
    const res = mockRes();
    const next = jest.fn();

    authMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it("returns 401 on bad signature", () => {
    const token = jwt.sign(
      { userId: "u1", orgId: "ORG_ENERGIA_001", role: "SOLFACIL_ADMIN" },
      "wrong-secret",
    );
    const req = mockReq("/api/dashboard", "Bearer " + token);
    const res = mockRes();
    const next = jest.fn();

    authMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it("skips auth for static file paths", () => {
    const req = mockReq("/index.html");
    const res = mockRes();
    const next = jest.fn();

    authMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it("accepts raw JSON auth header (backward compat)", () => {
    const rawJson = '{"userId":"u1","orgId":"ORG_ENERGIA_001","role":"SOLFACIL_ADMIN"}';
    const req = mockReq("/api/dashboard", rawJson);
    const res = mockRes();
    const next = jest.fn();

    authMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});
