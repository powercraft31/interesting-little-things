/**
 * Tests for POST /api/auth/login handler (v5.23)
 *
 * These are unit tests that mock the database pool.
 */
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { createLoginHandler } from "../../src/bff/handlers/auth-login";

const JWT_SECRET = "solfacil-dev-secret";

// Mock pool helper
function mockPool(rows: Record<string, unknown>[]) {
  return {
    query: jest.fn().mockResolvedValue({ rows }),
  } as unknown as import("pg").Pool;
}

function mockReq(body: Record<string, unknown> = {}) {
  return { body } as unknown as import("express").Request;
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

describe("POST /api/auth/login", () => {
  const hashedPassword = bcrypt.hashSync("solfacil2026", 10);

  it("returns 200 + valid JWT on correct credentials", async () => {
    const pool = mockPool([
      {
        user_id: "USER_ADMIN_001",
        email: "admin@solfacil.com.br",
        name: "Admin",
        hashed_password: hashedPassword,
        is_active: true,
        org_id: "ORG_ENERGIA_001",
        role: "SOLFACIL_ADMIN",
      },
    ]);
    const handler = createLoginHandler(pool);
    const req = mockReq({ email: "admin@solfacil.com.br", password: "solfacil2026" });
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty("token");

    // Verify JWT is valid
    const decoded = jwt.verify(
      (res.body.data as { token: string }).token,
      JWT_SECRET,
    ) as { userId: string; orgId: string; role: string };
    expect(decoded.userId).toBe("USER_ADMIN_001");
    expect(decoded.orgId).toBe("ORG_ENERGIA_001");
    expect(decoded.role).toBe("SOLFACIL_ADMIN");
  });

  it("returns 401 on wrong password", async () => {
    const pool = mockPool([
      {
        user_id: "USER_ADMIN_001",
        email: "admin@solfacil.com.br",
        name: "Admin",
        hashed_password: hashedPassword,
        is_active: true,
        org_id: "ORG_ENERGIA_001",
        role: "SOLFACIL_ADMIN",
      },
    ]);
    const handler = createLoginHandler(pool);
    const req = mockReq({ email: "admin@solfacil.com.br", password: "wrongpass" });
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe("Invalid email or password");
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

  it("returns 401 on disabled account", async () => {
    const pool = mockPool([
      {
        user_id: "USER_DISABLED",
        email: "disabled@test.com",
        name: "Disabled",
        hashed_password: hashedPassword,
        is_active: false,
        org_id: "ORG_ENERGIA_001",
        role: "ORG_VIEWER",
      },
    ]);
    const handler = createLoginHandler(pool);
    const req = mockReq({ email: "disabled@test.com", password: "solfacil2026" });
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe("Account is disabled");
  });

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
});
