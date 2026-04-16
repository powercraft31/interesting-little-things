/**
 * Tests for authMiddleware + verifyTenantToken (v5.23 + v6.9 B2/B3 hardening)
 */
import jwt from "jsonwebtoken";
import { authMiddleware, SESSION_COOKIE_NAME } from "../../src/bff/middleware/auth";
import { verifyTenantToken } from "../../src/shared/middleware/tenant-context";

const TEST_JWT_SECRET = "test-jwt-secret-for-unit-tests";

// Set JWT_SECRET env var for all tests in this file
beforeAll(() => {
  process.env.JWT_SECRET = TEST_JWT_SECRET;
});

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
      TEST_JWT_SECRET,
    );
    const ctx = verifyTenantToken(token);
    expect(ctx.userId).toBe("u2");
    expect(ctx.orgId).toBe("ORG_ENERGIA_001");
    expect(ctx.role).toBe("ORG_MANAGER");
  });

  it("throws 401 on expired JWT", () => {
    const token = jwt.sign(
      { userId: "u3", orgId: "ORG_ENERGIA_001", role: "ORG_VIEWER" },
      TEST_JWT_SECRET,
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
    const token = jwt.sign({ userId: "u5" }, TEST_JWT_SECRET); // missing orgId and role
    expect(() => verifyTenantToken(token)).toThrow(
      expect.objectContaining({ statusCode: 401, message: "Invalid token" }),
    );
  });

  // ── v6.9 B2: runtime fallback removal ─────────────────────────────────

  it("does NOT fall back to hardcoded secret when JWT_SECRET is missing", () => {
    const saved = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;
    try {
      // Token signed with the old hardcoded fallback — must be rejected
      const token = jwt.sign(
        { userId: "u6", orgId: "ORG_ENERGIA_001", role: "ORG_MANAGER" },
        "solfacil-dev-secret",
      );
      expect(() => verifyTenantToken(token)).toThrow(
        expect.objectContaining({ statusCode: 401 }),
      );
    } finally {
      process.env.JWT_SECRET = saved;
    }
  });
});

// ── Test helpers ────────────────────────────────────────────────────────

function mockReq(path: string, opts?: { authorization?: string; cookie?: string }) {
  const headers: Record<string, string> = {};
  if (opts?.authorization !== undefined) headers.authorization = opts.authorization;
  if (opts?.cookie !== undefined) headers.cookie = opts.cookie;
  return { path, headers } as unknown as import("express").Request;
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

function validJwt(claims?: Partial<{ userId: string; orgId: string; role: string }>): string {
  return jwt.sign(
    {
      userId: claims?.userId ?? "u1",
      orgId: claims?.orgId ?? "ORG_ENERGIA_001",
      role: claims?.role ?? "SOLFACIL_ADMIN",
    },
    TEST_JWT_SECRET,
  );
}

function cookieHeader(name: string, value: string): string {
  return `${name}=${encodeURIComponent(value)}`;
}

// ── authMiddleware tests ─────────────────────────────────────────────────

describe("authMiddleware", () => {
  // ── B3.6: Public routes skip auth ────────────────────────────────────

  it("skips auth for public route /api/auth/login", () => {
    const req = mockReq("/api/auth/login");
    const res = mockRes();
    const next = jest.fn();

    authMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(0);
  });

  it("skips auth for public route /api/auth/logout", () => {
    const req = mockReq("/api/auth/logout");
    const res = mockRes();
    const next = jest.fn();

    authMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it("skips auth for static file paths (non-/api/*)", () => {
    const req = mockReq("/index.html");
    const res = mockRes();
    const next = jest.fn();

    authMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  // ── B3.1: SESSION_COOKIE_NAME constant ───────────────────────────────

  it("exports SESSION_COOKIE_NAME constant", () => {
    expect(SESSION_COOKIE_NAME).toBeDefined();
    expect(typeof SESSION_COOKIE_NAME).toBe("string");
    // In test env (not production), should be dev name
    expect(SESSION_COOKIE_NAME).toBe("solfacil_session");
  });

  // ── B3.2: Cookie-first auth resolution ───────────────────────────────

  it("authenticates via session cookie (browser contract)", () => {
    const token = validJwt();
    const req = mockReq("/api/dashboard", {
      cookie: cookieHeader(SESSION_COOKIE_NAME, token),
    });
    const res = mockRes();
    const next = jest.fn();

    authMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    // Downstream sees raw JSON rewrite
    const overwritten = JSON.parse(req.headers.authorization as string);
    expect(overwritten.userId).toBe("u1");
    expect(overwritten.orgId).toBe("ORG_ENERGIA_001");
    expect(overwritten.role).toBe("SOLFACIL_ADMIN");
  });

  // ── B3.3: Cookie-wins when both present ──────────────────────────────

  it("uses cookie when both cookie and Authorization header present (cookie-wins)", () => {
    const cookieJwt = validJwt({ userId: "cookie-user" });
    const bearerJwt = validJwt({ userId: "bearer-user" });
    const req = mockReq("/api/dashboard", {
      cookie: cookieHeader(SESSION_COOKIE_NAME, cookieJwt),
      authorization: "Bearer " + bearerJwt,
    });
    const res = mockRes();
    const next = jest.fn();

    authMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    const overwritten = JSON.parse(req.headers.authorization as string);
    expect(overwritten.userId).toBe("cookie-user");
  });

  // ── B3.4: Neither present → 401 ─────────────────────────────────────

  it("returns 401 when neither cookie nor Authorization header present", () => {
    const req = mockReq("/api/dashboard");
    const res = mockRes();
    const next = jest.fn();

    authMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe("Authorization header or auth cookie required");
  });

  // ── B3.5: Post-verification raw JSON rewrite ─────────────────────────

  it("overwrites req.headers.authorization with raw JSON after cookie verification", () => {
    const token = validJwt();
    const req = mockReq("/api/dashboard", {
      cookie: cookieHeader(SESSION_COOKIE_NAME, token),
    });
    const res = mockRes();
    const next = jest.fn();

    authMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    const parsed = JSON.parse(req.headers.authorization as string);
    expect(parsed).toEqual(
      expect.objectContaining({ userId: "u1", orgId: "ORG_ENERGIA_001", role: "SOLFACIL_ADMIN" }),
    );
  });

  it("accepts raw JSON auth header (backward compat for downstream handlers)", () => {
    const rawJson = '{"userId":"u1","orgId":"ORG_ENERGIA_001","role":"SOLFACIL_ADMIN"}';
    const req = mockReq("/api/dashboard", { authorization: rawJson });
    const res = mockRes();
    const next = jest.fn();

    authMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  // ── B3.2: Bearer-only (machine contract) still works ─────────────────

  it("authenticates via bearer token when no cookie (machine contract)", () => {
    const token = validJwt();
    const req = mockReq("/api/dashboard", { authorization: "Bearer " + token });
    const res = mockRes();
    const next = jest.fn();

    authMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    const overwritten = JSON.parse(req.headers.authorization as string);
    expect(overwritten.userId).toBe("u1");
  });

  // ── B3.7: LEGACY_BROWSER_BEARER emergency toggle ────────────────────

  describe("LEGACY_BROWSER_BEARER toggle", () => {
    const originalEnv = process.env.LEGACY_BROWSER_BEARER;

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.LEGACY_BROWSER_BEARER;
      } else {
        process.env.LEGACY_BROWSER_BEARER = originalEnv;
      }
    });

    it("logs warning when LEGACY_BROWSER_BEARER=true and bearer used without cookie", () => {
      process.env.LEGACY_BROWSER_BEARER = "true";
      const warnSpy = jest.spyOn(console, "warn").mockImplementation();

      const token = validJwt();
      const req = mockReq("/api/dashboard", { authorization: "Bearer " + token });
      const res = mockRes();
      const next = jest.fn();

      authMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Legacy browser bearer auth used"),
      );

      warnSpy.mockRestore();
    });

    it("does not log warning when LEGACY_BROWSER_BEARER is not set", () => {
      delete process.env.LEGACY_BROWSER_BEARER;
      const warnSpy = jest.spyOn(console, "warn").mockImplementation();

      const token = validJwt();
      const req = mockReq("/api/dashboard", { authorization: "Bearer " + token });
      const res = mockRes();
      const next = jest.fn();

      authMiddleware(req, res, next);

      // Bearer-only still works (machine contract) but no legacy warning
      expect(next).toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("Legacy browser bearer auth used"),
      );

      warnSpy.mockRestore();
    });
  });

  // ── Error cases ──────────────────────────────────────────────────────

  it("returns 401 on expired JWT in cookie", () => {
    const token = jwt.sign(
      { userId: "u1", orgId: "ORG_ENERGIA_001", role: "SOLFACIL_ADMIN" },
      TEST_JWT_SECRET,
      { expiresIn: "-1s" },
    );
    const req = mockReq("/api/dashboard", {
      cookie: cookieHeader(SESSION_COOKIE_NAME, token),
    });
    const res = mockRes();
    const next = jest.fn();

    authMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it("returns 401 on bad signature in cookie", () => {
    const token = jwt.sign(
      { userId: "u1", orgId: "ORG_ENERGIA_001", role: "SOLFACIL_ADMIN" },
      "wrong-secret",
    );
    const req = mockReq("/api/dashboard", {
      cookie: cookieHeader(SESSION_COOKIE_NAME, token),
    });
    const res = mockRes();
    const next = jest.fn();

    authMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });
});
