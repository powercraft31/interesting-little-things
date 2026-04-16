/**
 * Tests for GET /api/auth/session handler (v6.9 B4)
 *
 * Cookie-only browser session endpoint.
 * Bearer-only requests must be rejected with 401.
 */
import { createSessionHandler } from "../../src/bff/handlers/auth-session";
import { SESSION_COOKIE_NAME } from "../../src/bff/middleware/auth";

const TEST_JWT_SECRET = "test-jwt-secret-for-unit-tests";

beforeAll(() => {
  process.env.JWT_SECRET = TEST_JWT_SECRET;
});

// ── Test helpers ────────────────────────────────────────────────────────

function mockQueryWithOrg(rows: Record<string, unknown>[]) {
  return jest.fn().mockResolvedValue({ rows });
}

/** Build a mock request that looks like it passed through auth middleware. */
function mockReq(opts: {
  cookie?: string;
  authJson?: { userId: string; orgId: string; role: string };
  authHeader?: string;
}) {
  const headers: Record<string, string | undefined> = {};

  if (opts.cookie) {
    headers.cookie = opts.cookie;
  }

  // Auth middleware overwrites authorization with JSON on success
  if (opts.authJson) {
    headers.authorization = JSON.stringify(opts.authJson);
  } else if (opts.authHeader) {
    headers.authorization = opts.authHeader;
  }

  return { headers } as unknown as import("express").Request;
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
    body: { success: boolean; data: unknown; error: string | null };
  };
}

// ── Tests ───────────────────────────────────────────────────────────────

describe("GET /api/auth/session", () => {
  const AUTH_CLAIMS = {
    userId: "USER_ADMIN_001",
    orgId: "ORG_ENERGIA_001",
    role: "SOLFACIL_ADMIN",
  };

  const DB_ROW = {
    user_id: "USER_ADMIN_001",
    email: "admin@solfacil.com.br",
    name: "Admin User",
    org_id: "ORG_ENERGIA_001",
    role: "SOLFACIL_ADMIN",
  };

  describe("valid cookie session", () => {
    it("returns 200 with userId, orgId, role, name, email", async () => {
      const qwo = mockQueryWithOrg([DB_ROW]);
      const handler = createSessionHandler(qwo);
      const req = mockReq({
        cookie: `${SESSION_COOKIE_NAME}=some-jwt-value`,
        authJson: AUTH_CLAIMS,
      });
      const res = mockRes();

      await handler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({
        userId: "USER_ADMIN_001",
        orgId: "ORG_ENERGIA_001",
        role: "SOLFACIL_ADMIN",
        name: "Admin User",
        email: "admin@solfacil.com.br",
      });
    });

    it("passes userId and orgId to the DB query", async () => {
      const qwo = mockQueryWithOrg([DB_ROW]);
      const handler = createSessionHandler(qwo);
      const req = mockReq({
        cookie: `${SESSION_COOKIE_NAME}=some-jwt-value`,
        authJson: AUTH_CLAIMS,
      });
      const res = mockRes();

      await handler(req, res);

      expect(qwo).toHaveBeenCalledTimes(1);
      const [sql, params, orgId] = qwo.mock.calls[0];
      expect(sql).toContain("users");
      expect(sql).toContain("user_org_roles");
      expect(params).toEqual(["USER_ADMIN_001"]);
      expect(orgId).toBe("ORG_ENERGIA_001");
    });
  });

  describe("bearer-only request (no cookie)", () => {
    it("returns 401 even if auth middleware passed", async () => {
      const qwo = mockQueryWithOrg([DB_ROW]);
      const handler = createSessionHandler(qwo);
      // No cookie, but auth middleware set authorization from bearer
      const req = mockReq({
        authJson: AUTH_CLAIMS,
      });
      const res = mockRes();

      await handler(req, res);

      expect(res.statusCode).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe("Session expired or invalid");
      // DB must NOT be queried
      expect(qwo).not.toHaveBeenCalled();
    });
  });

  describe("missing cookie (unauthenticated)", () => {
    it("returns 401 with no authorization header", async () => {
      const qwo = mockQueryWithOrg([]);
      const handler = createSessionHandler(qwo);
      const req = mockReq({});
      const res = mockRes();

      await handler(req, res);

      expect(res.statusCode).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe("Session expired or invalid");
      expect(qwo).not.toHaveBeenCalled();
    });
  });

  describe("cookie present but user not found in DB", () => {
    it("returns 401 when DB returns no rows", async () => {
      const qwo = mockQueryWithOrg([]);
      const handler = createSessionHandler(qwo);
      const req = mockReq({
        cookie: `${SESSION_COOKIE_NAME}=some-jwt-value`,
        authJson: AUTH_CLAIMS,
      });
      const res = mockRes();

      await handler(req, res);

      expect(res.statusCode).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe("Session expired or invalid");
    });
  });

  describe("cookie present but invalid authorization JSON", () => {
    it("returns 401 when authorization header is malformed", async () => {
      const qwo = mockQueryWithOrg([]);
      const handler = createSessionHandler(qwo);
      const req = mockReq({
        cookie: `${SESSION_COOKIE_NAME}=some-jwt-value`,
        authHeader: "not-valid-json",
      });
      const res = mockRes();

      await handler(req, res);

      expect(res.statusCode).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe("Session expired or invalid");
    });
  });

  describe("DB error handling", () => {
    it("returns 500 on database failure", async () => {
      const qwo = jest.fn().mockRejectedValue(new Error("connection refused"));
      const handler = createSessionHandler(qwo);
      const req = mockReq({
        cookie: `${SESSION_COOKIE_NAME}=some-jwt-value`,
        authJson: AUTH_CLAIMS,
      });
      const res = mockRes();

      await handler(req, res);

      expect(res.statusCode).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe("Internal server error");
    });
  });

  describe("response shape", () => {
    it("includes all required fields and no extras", async () => {
      const qwo = mockQueryWithOrg([DB_ROW]);
      const handler = createSessionHandler(qwo);
      const req = mockReq({
        cookie: `${SESSION_COOKIE_NAME}=some-jwt-value`,
        authJson: AUTH_CLAIMS,
      });
      const res = mockRes();

      await handler(req, res);

      const data = res.body.data as Record<string, unknown>;
      expect(Object.keys(data).sort()).toEqual(
        ["email", "name", "orgId", "role", "userId"].sort(),
      );
    });

    it("wraps data in standard ApiResponse envelope", async () => {
      const qwo = mockQueryWithOrg([DB_ROW]);
      const handler = createSessionHandler(qwo);
      const req = mockReq({
        cookie: `${SESSION_COOKIE_NAME}=some-jwt-value`,
        authJson: AUTH_CLAIMS,
      });
      const res = mockRes();

      await handler(req, res);

      expect(res.body).toHaveProperty("success", true);
      expect(res.body).toHaveProperty("data");
      expect(res.body).toHaveProperty("error", null);
      expect(res.body).toHaveProperty("timestamp");
    });
  });
});
