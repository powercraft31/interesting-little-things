/**
 * Tests for POST /api/users handler (v5.23)
 *
 * Unit tests with mocked database pool.
 */
import { createAdminUsersHandler } from "../../src/bff/handlers/admin-users";

// Mock client for transaction
function mockClient(shouldFail = false) {
  return {
    query: jest.fn().mockImplementation((sql: string) => {
      if (shouldFail && sql.startsWith("INSERT INTO users")) {
        throw new Error("duplicate key value violates unique constraint");
      }
      return Promise.resolve({ rows: [] });
    }),
    release: jest.fn(),
  };
}

function mockPool(client = mockClient()) {
  return {
    connect: jest.fn().mockResolvedValue(client),
  } as unknown as import("pg").Pool;
}

function mockReq(
  body: Record<string, unknown> = {},
  authHeader = '{"userId":"USER_ADMIN_001","orgId":"ORG_ENERGIA_001","role":"SOLFACIL_ADMIN"}',
) {
  return {
    body,
    headers: { authorization: authHeader },
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
    body: { success: boolean; data: unknown; error: string | null };
  };
}

describe("POST /api/users", () => {
  const validBody = {
    email: "operator@solar.com",
    password: "initialPass123",
    name: "Joao Operador",
    orgId: "ORG_ENERGIA_001",
    role: "ORG_OPERATOR",
  };

  it("ADMIN + valid body returns 201", async () => {
    const handler = createAdminUsersHandler(mockPool());
    const req = mockReq(validBody);
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect((res.body.data as { userId: string }).userId).toMatch(/^USER_/);
    expect((res.body.data as { email: string }).email).toBe("operator@solar.com");
  });

  it("non-ADMIN returns 403", async () => {
    const handler = createAdminUsersHandler(mockPool());
    const req = mockReq(
      validBody,
      '{"userId":"USER_VIEWER","orgId":"ORG_ENERGIA_001","role":"ORG_VIEWER"}',
    );
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe("Forbidden");
  });

  it("invalid role returns 400", async () => {
    const handler = createAdminUsersHandler(mockPool());
    const req = mockReq({ ...validBody, role: "INVALID_ROLE" });
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain("Invalid role");
  });

  it("duplicate email returns 500 (PG constraint)", async () => {
    const client = mockClient(true);
    const handler = createAdminUsersHandler(mockPool(client));
    const req = mockReq(validBody);
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(500);
    // Verify ROLLBACK was called
    expect(client.query).toHaveBeenCalledWith("ROLLBACK");
    expect(client.release).toHaveBeenCalled();
  });

  it("missing fields returns 400", async () => {
    const handler = createAdminUsersHandler(mockPool());
    const req = mockReq({ email: "test@test.com" }); // missing password, name, orgId, role
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain("All fields required");
  });
});
