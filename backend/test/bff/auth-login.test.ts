/**
 * Tests for POST /api/auth/login handler
 *
 * v5.23: Original unit tests with mocked database pool.
 * v6.9 B5: Browser/machine contract split tests.
 */
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { createLoginHandler, createLogoutHandler } from "../../src/bff/handlers/auth-login";

const TEST_JWT_SECRET = "test-jwt-secret-for-unit-tests";

// Ensure JWT_SECRET is set for all tests in this file
beforeAll(() => {
  process.env.JWT_SECRET = TEST_JWT_SECRET;
});

// Mock pool helper
function mockPool(rows: Record<string, unknown>[]) {
  return {
    query: jest.fn().mockResolvedValue({ rows }),
  } as unknown as import("pg").Pool;
}

function mockReq(
  body: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) {
  return { body, headers } as unknown as import("express").Request;
}

async function loadAuthHandlersWithNodeEnv(nodeEnv: string) {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousJwtSecret = process.env.JWT_SECRET;
  process.env.NODE_ENV = nodeEnv;
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  jest.resetModules();

  try {
    return await import("../../src/bff/handlers/auth-login");
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
    process.env.JWT_SECRET = previousJwtSecret;
    jest.resetModules();
  }
}

function mockRes() {
  const res = {
    statusCode: 0,
    body: null as unknown,
    cookies: [] as Array<{ name: string; value: string; options: Record<string, unknown> }>,
    clearedCookies: [] as Array<{ name: string; options: Record<string, unknown> }>,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(data: unknown) {
      res.body = data;
      return res;
    },
    cookie(name: string, value: string, options: Record<string, unknown>) {
      res.cookies.push({ name, value, options });
    },
    clearCookie(name: string, options: Record<string, unknown>) {
      res.clearedCookies.push({ name, options });
    },
  };
  return res as unknown as import("express").Response & {
    statusCode: number;
    body: { success: boolean; data: unknown; error: string | null };
    cookies: Array<{ name: string; value: string; options: Record<string, unknown> }>;
    clearedCookies: Array<{ name: string; options: Record<string, unknown> }>;
  };
}

const hashedPassword = bcrypt.hashSync("solfacil2026", 10);
const validUserRow = {
  user_id: "USER_ADMIN_001",
  email: "admin@solfacil.com.br",
  name: "Admin",
  hashed_password: hashedPassword,
  is_active: true,
  org_id: "ORG_ENERGIA_001",
  role: "SOLFACIL_ADMIN",
};

// ── Existing validation tests ────────────────────────────────────────────

describe("POST /api/auth/login — input validation", () => {
  it("returns 400 on missing email", async () => {
    const pool = mockPool([]);
    const handler = createLoginHandler(pool);
    const req = mockReq({ password: "solfacil2026" });
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe("Email and password are required");
  });

  it("returns 400 on missing password", async () => {
    const pool = mockPool([]);
    const handler = createLoginHandler(pool);
    const req = mockReq({ email: "admin@solfacil.com.br" });
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe("Email and password are required");
  });

  it("returns 401 on non-existent email (same message, no info leak)", async () => {
    const pool = mockPool([]);
    const handler = createLoginHandler(pool);
    const req = mockReq({ email: "nobody@example.com", password: "anything" });
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe("Invalid email or password");
  });

  it("returns 401 on wrong password", async () => {
    const pool = mockPool([validUserRow]);
    const handler = createLoginHandler(pool);
    const req = mockReq({ email: "admin@solfacil.com.br", password: "wrongpass" });
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe("Invalid email or password");
  });

  it("returns 401 on disabled account", async () => {
    const pool = mockPool([{ ...validUserRow, is_active: false }]);
    const handler = createLoginHandler(pool);
    const req = mockReq({ email: "disabled@test.com", password: "solfacil2026" });
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe("Account is disabled");
  });
});

// ── v6.9 B5: Browser contract (default) ─────────────────────────────────

describe("POST /api/auth/login — browser contract (default)", () => {
  it("sets session cookie on success", async () => {
    const pool = mockPool([validUserRow]);
    const handler = createLoginHandler(pool);
    const req = mockReq({ email: "admin@solfacil.com.br", password: "solfacil2026" });
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.cookies.length).toBe(1);
    expect(res.cookies[0].name).toBe("solfacil_session");
    expect(res.cookies[0].options.httpOnly).toBe(true);
    expect(res.cookies[0].options.sameSite).toBe("strict");
    expect(res.cookies[0].options.path).toBe("/");
  });

  it("does NOT return token in response body", async () => {
    const pool = mockPool([validUserRow]);
    const handler = createLoginHandler(pool);
    const req = mockReq({ email: "admin@solfacil.com.br", password: "solfacil2026" });
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    const data = res.body.data as Record<string, unknown>;
    expect(data).not.toHaveProperty("token");
  });

  it("returns user object in response body", async () => {
    const pool = mockPool([validUserRow]);
    const handler = createLoginHandler(pool);
    const req = mockReq({ email: "admin@solfacil.com.br", password: "solfacil2026" });
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const data = res.body.data as { user: Record<string, unknown> };
    expect(data.user).toEqual({
      userId: "USER_ADMIN_001",
      email: "admin@solfacil.com.br",
      name: "Admin",
      orgId: "ORG_ENERGIA_001",
      role: "SOLFACIL_ADMIN",
    });
  });

  it("cookie value is a valid JWT", async () => {
    const pool = mockPool([validUserRow]);
    const handler = createLoginHandler(pool);
    const req = mockReq({ email: "admin@solfacil.com.br", password: "solfacil2026" });
    const res = mockRes();

    await handler(req, res);

    const decoded = jwt.verify(res.cookies[0].value, TEST_JWT_SECRET) as {
      userId: string;
      orgId: string;
      role: string;
    };
    expect(decoded.userId).toBe("USER_ADMIN_001");
    expect(decoded.orgId).toBe("ORG_ENERGIA_001");
    expect(decoded.role).toBe("SOLFACIL_ADMIN");
  });
});

// ── v6.9 B5: Machine contract ───────────────────────────────────────────

describe("POST /api/auth/login — machine contract (X-Auth-Contract: machine)", () => {
  it("returns token in response body", async () => {
    const pool = mockPool([validUserRow]);
    const handler = createLoginHandler(pool);
    const req = mockReq(
      { email: "admin@solfacil.com.br", password: "solfacil2026" },
      { "x-auth-contract": "machine" },
    );
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    const data = res.body.data as { token: string; user: Record<string, unknown> };
    expect(data).toHaveProperty("token");
    expect(typeof data.token).toBe("string");
  });

  it("returns user object in response body", async () => {
    const pool = mockPool([validUserRow]);
    const handler = createLoginHandler(pool);
    const req = mockReq(
      { email: "admin@solfacil.com.br", password: "solfacil2026" },
      { "x-auth-contract": "machine" },
    );
    const res = mockRes();

    await handler(req, res);

    const data = res.body.data as { user: Record<string, unknown> };
    expect(data.user).toEqual({
      userId: "USER_ADMIN_001",
      email: "admin@solfacil.com.br",
      name: "Admin",
      orgId: "ORG_ENERGIA_001",
      role: "SOLFACIL_ADMIN",
    });
  });

  it("does NOT set any cookie", async () => {
    const pool = mockPool([validUserRow]);
    const handler = createLoginHandler(pool);
    const req = mockReq(
      { email: "admin@solfacil.com.br", password: "solfacil2026" },
      { "x-auth-contract": "machine" },
    );
    const res = mockRes();

    await handler(req, res);

    expect(res.cookies.length).toBe(0);
  });

  it("token is a valid JWT", async () => {
    const pool = mockPool([validUserRow]);
    const handler = createLoginHandler(pool);
    const req = mockReq(
      { email: "admin@solfacil.com.br", password: "solfacil2026" },
      { "x-auth-contract": "machine" },
    );
    const res = mockRes();

    await handler(req, res);

    const data = res.body.data as { token: string };
    const decoded = jwt.verify(data.token, TEST_JWT_SECRET) as {
      userId: string;
      orgId: string;
      role: string;
    };
    expect(decoded.userId).toBe("USER_ADMIN_001");
    expect(decoded.orgId).toBe("ORG_ENERGIA_001");
  });
});

// ── v6.9 B5: Logout clears session cookie ───────────────────────────────

describe("POST /api/auth/logout", () => {
  it("clears the session cookie by name", async () => {
    const handler = createLogoutHandler();
    const req = mockReq();
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.clearedCookies.length).toBe(1);
    expect(res.clearedCookies[0].name).toBe("solfacil_session");
    expect(res.clearedCookies[0].options.httpOnly).toBe(true);
    expect(res.clearedCookies[0].options.sameSite).toBe("strict");
    expect(res.clearedCookies[0].options.path).toBe("/");
  });

  it("returns success response", async () => {
    const handler = createLogoutHandler();
    const req = mockReq();
    const res = mockRes();

    await handler(req, res);

    expect(res.body.success).toBe(true);
  });
});

describe("POST /api/auth/login — production cookie contract", () => {
  it("uses __Host-solfacil_session and Secure for browser login in production", async () => {
    const { createLoginHandler: createProdLoginHandler } = await loadAuthHandlersWithNodeEnv("production");
    const pool = mockPool([validUserRow]);
    const handler = createProdLoginHandler(pool);
    const req = mockReq({ email: "admin@solfacil.com.br", password: "solfacil2026" });
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.cookies).toHaveLength(1);
    expect(res.cookies[0].name).toBe("__Host-solfacil_session");
    expect(res.cookies[0].options.secure).toBe(true);
    expect(res.cookies[0].options.httpOnly).toBe(true);
    expect(res.cookies[0].options.sameSite).toBe("strict");
    expect(res.cookies[0].options.path).toBe("/");
  });

  it("clears __Host-solfacil_session with Secure in production logout", async () => {
    const { createLogoutHandler: createProdLogoutHandler } = await loadAuthHandlersWithNodeEnv("production");
    const handler = createProdLogoutHandler();
    const req = mockReq();
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.clearedCookies).toHaveLength(1);
    expect(res.clearedCookies[0].name).toBe("__Host-solfacil_session");
    expect(res.clearedCookies[0].options.secure).toBe(true);
    expect(res.clearedCookies[0].options.httpOnly).toBe(true);
    expect(res.clearedCookies[0].options.sameSite).toBe("strict");
    expect(res.clearedCookies[0].options.path).toBe("/");
  });
});
