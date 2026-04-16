/**
 * Tests for B6 Abuse-Control Middleware
 *
 * Covers:
 * - RateLimitStore interface contract (MemoryRateLimitStore)
 * - Middleware: per-IP (10/15min) and per-email (5/15min) thresholds
 * - 429 response shape with Retry-After header
 * - Success resets email counter but NOT IP counter
 * - Store selection logic (dev/memory, redis, non-dev fatal)
 */

import type { Request, Response, NextFunction } from "express";

// Will import from implementation once written
import {
  MemoryRateLimitStore,
  createAbuseControlMiddleware,
  selectRateLimitStore,
} from "../../src/bff/middleware/rate-limit";

// ── MemoryRateLimitStore ────────────────────────────────────────────────

describe("MemoryRateLimitStore", () => {
  it("returns 1 on first increment", async () => {
    const store = new MemoryRateLimitStore();
    const count = await store.increment("key1", 900);
    expect(count).toBe(1);
  });

  it("increments on subsequent calls", async () => {
    const store = new MemoryRateLimitStore();
    await store.increment("key1", 900);
    await store.increment("key1", 900);
    const count = await store.increment("key1", 900);
    expect(count).toBe(3);
  });

  it("resets counter to zero", async () => {
    const store = new MemoryRateLimitStore();
    await store.increment("key1", 900);
    await store.increment("key1", 900);
    await store.reset("key1");
    const count = await store.increment("key1", 900);
    expect(count).toBe(1);
  });

  it("isolates keys", async () => {
    const store = new MemoryRateLimitStore();
    await store.increment("a", 900);
    await store.increment("a", 900);
    const countB = await store.increment("b", 900);
    expect(countB).toBe(1);
  });

  it("expires entries after TTL", async () => {
    const store = new MemoryRateLimitStore();
    // Use a very short window
    await store.increment("key1", 1);
    // Wait for expiry
    await new Promise((r) => setTimeout(r, 1100));
    const count = await store.increment("key1", 1);
    expect(count).toBe(1); // restarted
  });

  it("returns remaining TTL seconds via getRemainingTtl", async () => {
    const store = new MemoryRateLimitStore();
    await store.increment("key1", 900);
    const remaining = await store.getRemainingTtl("key1");
    expect(remaining).toBeGreaterThan(898);
    expect(remaining).toBeLessThanOrEqual(900);
  });

  it("returns 0 TTL for unknown key", async () => {
    const store = new MemoryRateLimitStore();
    const remaining = await store.getRemainingTtl("nonexistent");
    expect(remaining).toBe(0);
  });
});

// ── Middleware helpers ───────────────────────────────────────────────────

function mockReq(
  ip: string,
  body: Record<string, unknown> = {},
): Request {
  return { ip, body } as unknown as Request;
}

function mockRes() {
  const res = {
    statusCode: 0,
    body: null as unknown,
    headers: {} as Record<string, string>,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(data: unknown) {
      res.body = data;
      return res;
    },
    setHeader(name: string, value: string) {
      res.headers[name] = value;
      return res;
    },
  };
  return res as unknown as Response & {
    statusCode: number;
    body: { success: boolean; data: unknown; error: string | null };
    headers: Record<string, string>;
  };
}

// ── Abuse-control middleware ─────────────────────────────────────────────

describe("abuse-control middleware", () => {
  const WINDOW = 900; // 15 minutes in seconds

  function makeMiddleware() {
    const store = new MemoryRateLimitStore();
    const { preHandler, postHandler } = createAbuseControlMiddleware(store);
    return { store, preHandler, postHandler };
  }

  it("allows requests under both thresholds", async () => {
    const { preHandler } = makeMiddleware();
    const req = mockReq("1.2.3.4", { email: "user@test.com" });
    const res = mockRes();
    let nextCalled = false;
    const next: NextFunction = () => { nextCalled = true; };

    await preHandler(req, res, next);

    expect(nextCalled).toBe(true);
    expect(res.statusCode).toBe(0); // not set = passed through
  });

  it("returns 429 after 5 failed attempts for same email", async () => {
    const { preHandler, postHandler } = makeMiddleware();
    const ip = "1.2.3.4";
    const email = "victim@test.com";

    // Simulate 5 failed login attempts
    for (let i = 0; i < 5; i++) {
      const req = mockReq(ip, { email });
      const res = mockRes();
      let nextCalled = false;
      await preHandler(req, res, () => { nextCalled = true; });
      if (nextCalled) {
        // Simulate 401 failure
        res.statusCode = 401;
        await postHandler(req, res);
      }
    }

    // 6th attempt should be blocked at preHandler
    const req = mockReq(ip, { email });
    const res = mockRes();
    let nextCalled = false;
    await preHandler(req, res, () => { nextCalled = true; });

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(429);
    expect(res.body).toEqual(
      expect.objectContaining({
        success: false,
        error: "Too many login attempts. Try again later.",
      }),
    );
  });

  it("returns 429 after 10 failed attempts from same IP (different emails)", async () => {
    const { preHandler, postHandler } = makeMiddleware();
    const ip = "10.0.0.1";

    // Simulate 10 failed attempts with different emails
    for (let i = 0; i < 10; i++) {
      const req = mockReq(ip, { email: `user${i}@test.com` });
      const res = mockRes();
      let nextCalled = false;
      await preHandler(req, res, () => { nextCalled = true; });
      if (nextCalled) {
        res.statusCode = 401;
        await postHandler(req, res);
      }
    }

    // 11th attempt from same IP, new email
    const req = mockReq(ip, { email: "fresh@test.com" });
    const res = mockRes();
    let nextCalled = false;
    await preHandler(req, res, () => { nextCalled = true; });

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(429);
  });

  it("sets Retry-After header on 429", async () => {
    const { preHandler, postHandler } = makeMiddleware();
    const ip = "1.2.3.4";
    const email = "retry@test.com";

    for (let i = 0; i < 5; i++) {
      const req = mockReq(ip, { email });
      const res = mockRes();
      let nextCalled = false;
      await preHandler(req, res, () => { nextCalled = true; });
      if (nextCalled) {
        res.statusCode = 401;
        await postHandler(req, res);
      }
    }

    const req = mockReq(ip, { email });
    const res = mockRes();
    await preHandler(req, res, () => {});

    expect(res.headers["Retry-After"]).toBeDefined();
    const retryAfter = parseInt(res.headers["Retry-After"], 10);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(WINDOW);
  });

  it("429 response uses standard fail envelope", async () => {
    const { preHandler, postHandler } = makeMiddleware();
    const ip = "1.2.3.4";
    const email = "envelope@test.com";

    for (let i = 0; i < 5; i++) {
      const req = mockReq(ip, { email });
      const res = mockRes();
      await preHandler(req, res, () => {
        res.statusCode = 401;
      });
      await postHandler(req, res);
    }

    const req = mockReq(ip, { email });
    const res = mockRes();
    await preHandler(req, res, () => {});

    expect(res.body).toHaveProperty("success", false);
    expect(res.body).toHaveProperty("error", "Too many login attempts. Try again later.");
    expect(res.body).toHaveProperty("data", null);
    expect(res.body).toHaveProperty("timestamp");
  });

  it("successful login resets email counter but NOT IP counter", async () => {
    const { preHandler, postHandler } = makeMiddleware();
    const ip = "1.2.3.4";
    const email = "reset@test.com";

    // 4 failed attempts
    for (let i = 0; i < 4; i++) {
      const req = mockReq(ip, { email });
      const res = mockRes();
      await preHandler(req, res, () => {
        res.statusCode = 401;
      });
      await postHandler(req, res);
    }

    // 1 successful login
    {
      const req = mockReq(ip, { email });
      const res = mockRes();
      await preHandler(req, res, () => {
        res.statusCode = 200;
      });
      await postHandler(req, res);
    }

    // Next attempt with same email should pass (email counter was reset)
    {
      const req = mockReq(ip, { email });
      const res = mockRes();
      let nextCalled = false;
      await preHandler(req, res, () => { nextCalled = true; });
      expect(nextCalled).toBe(true);
    }
  });

  it("successful login does NOT reset IP counter", async () => {
    const { preHandler, postHandler } = makeMiddleware();
    const ip = "10.0.0.2";

    // 9 failed attempts from same IP with different emails
    for (let i = 0; i < 9; i++) {
      const req = mockReq(ip, { email: `u${i}@test.com` });
      const res = mockRes();
      await preHandler(req, res, () => {
        res.statusCode = 401;
      });
      await postHandler(req, res);
    }

    // 1 successful login
    {
      const req = mockReq(ip, { email: "success@test.com" });
      const res = mockRes();
      await preHandler(req, res, () => {
        res.statusCode = 200;
      });
      await postHandler(req, res);
    }

    // IP counter should still be at 9+1=10 (success doesn't reset IP)
    // Actually the successful login was the 10th request from this IP,
    // but the IP counter is only incremented on failure. So IP count = 9.
    // Let's do one more failure to hit 10:
    {
      const req = mockReq(ip, { email: "another@test.com" });
      const res = mockRes();
      await preHandler(req, res, () => {
        res.statusCode = 401;
      });
      await postHandler(req, res);
    }
    // IP count should now be 10. Next should be blocked.
    {
      const req = mockReq(ip, { email: "fresh@test.com" });
      const res = mockRes();
      let nextCalled = false;
      await preHandler(req, res, () => { nextCalled = true; });
      expect(nextCalled).toBe(false);
      expect(res.statusCode).toBe(429);
    }
  });

  it("handles missing email gracefully (only IP check)", async () => {
    const { preHandler } = makeMiddleware();
    const req = mockReq("1.2.3.4", {});
    const res = mockRes();
    let nextCalled = false;
    await preHandler(req, res, () => { nextCalled = true; });

    expect(nextCalled).toBe(true);
  });

  it("normalizes email (trim + lowercase)", async () => {
    const { preHandler, postHandler } = makeMiddleware();
    const ip = "1.2.3.4";

    // 5 failures with differently-cased/padded email
    const emails = [
      "  Victim@Test.COM  ",
      "victim@test.com",
      "VICTIM@TEST.COM",
      " victim@test.com ",
      "Victim@test.com",
    ];

    for (const email of emails) {
      const req = mockReq(ip, { email });
      const res = mockRes();
      await preHandler(req, res, () => {
        res.statusCode = 401;
      });
      await postHandler(req, res);
    }

    // 6th attempt — should be blocked (all normalized to same key)
    const req = mockReq(ip, { email: "victim@test.com" });
    const res = mockRes();
    let nextCalled = false;
    await preHandler(req, res, () => { nextCalled = true; });

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(429);
  });
});

// ── Store selection ─────────────────────────────────────────────────────

describe("selectRateLimitStore", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("returns MemoryRateLimitStore in development without RATE_LIMIT_REDIS_URL", () => {
    process.env.NODE_ENV = "development";
    delete process.env.RATE_LIMIT_REDIS_URL;

    const store = selectRateLimitStore();
    expect(store).toBeInstanceOf(MemoryRateLimitStore);
  });

  it("exits process in non-dev without RATE_LIMIT_REDIS_URL", () => {
    process.env.NODE_ENV = "production";
    delete process.env.RATE_LIMIT_REDIS_URL;

    const mockExit = jest.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as never);
    const mockError = jest.spyOn(console, "error").mockImplementation(() => {});

    expect(() => selectRateLimitStore()).toThrow("process.exit called");
    expect(mockExit).toHaveBeenCalledWith(1);
    expect(mockError).toHaveBeenCalledWith(
      expect.stringContaining("RATE_LIMIT_REDIS_URL"),
    );

    mockExit.mockRestore();
    mockError.mockRestore();
  });

  it("exits process in staging without RATE_LIMIT_REDIS_URL", () => {
    process.env.NODE_ENV = "staging";
    delete process.env.RATE_LIMIT_REDIS_URL;

    const mockExit = jest.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as never);
    const mockError = jest.spyOn(console, "error").mockImplementation(() => {});

    expect(() => selectRateLimitStore()).toThrow("process.exit called");
    expect(mockExit).toHaveBeenCalledWith(1);

    mockExit.mockRestore();
    mockError.mockRestore();
  });
});
