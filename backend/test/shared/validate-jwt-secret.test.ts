/**
 * Tests for validateJwtSecret() — B2 Secret Fail-Fast Validation
 *
 * Ensures the process fails fast with a clear error when:
 *   - JWT_SECRET is missing/empty (any mode)
 *   - JWT_SECRET is a weak legacy placeholder in non-dev mode
 */
import { validateJwtSecret } from "../../src/shared/auth/validate-jwt-secret";

describe("validateJwtSecret", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  // ── Missing / empty secret (all modes) ──────────────────────────────────

  it("throws when JWT_SECRET is not set", () => {
    delete process.env.JWT_SECRET;
    delete process.env.NODE_ENV;
    expect(() => validateJwtSecret()).toThrow(/JWT_SECRET/);
  });

  it("throws when JWT_SECRET is empty string", () => {
    process.env.JWT_SECRET = "";
    expect(() => validateJwtSecret()).toThrow(/JWT_SECRET/);
  });

  it("throws when JWT_SECRET is whitespace only", () => {
    process.env.JWT_SECRET = "   ";
    expect(() => validateJwtSecret()).toThrow(/JWT_SECRET/);
  });

  // ── Weak / legacy placeholder rejected in production ────────────────────

  it("throws when JWT_SECRET is 'solfacil-dev-secret' in production", () => {
    process.env.JWT_SECRET = "solfacil-dev-secret";
    process.env.NODE_ENV = "production";
    expect(() => validateJwtSecret()).toThrow(/weak|placeholder|legacy/i);
  });

  it("throws when JWT_SECRET is 'solfacil-dev-secret' when NODE_ENV is unset (defaults to non-dev)", () => {
    process.env.JWT_SECRET = "solfacil-dev-secret";
    delete process.env.NODE_ENV;
    expect(() => validateJwtSecret()).toThrow(/weak|placeholder|legacy/i);
  });

  // ── Valid secrets accepted ──────────────────────────────────────────────

  it("accepts a strong secret in production", () => {
    process.env.JWT_SECRET = "a-real-production-secret-that-is-strong-enough";
    process.env.NODE_ENV = "production";
    expect(() => validateJwtSecret()).not.toThrow();
  });

  it("accepts any non-empty secret in development (including the legacy placeholder)", () => {
    process.env.JWT_SECRET = "solfacil-dev-secret";
    process.env.NODE_ENV = "development";
    expect(() => validateJwtSecret()).not.toThrow();
  });

  it("accepts a strong secret in development", () => {
    process.env.JWT_SECRET = "my-dev-secret-123";
    process.env.NODE_ENV = "development";
    expect(() => validateJwtSecret()).not.toThrow();
  });

  // ── Return value ────────────────────────────────────────────────────────

  it("returns the validated secret string", () => {
    process.env.JWT_SECRET = "test-secret-abc";
    process.env.NODE_ENV = "development";
    const secret = validateJwtSecret();
    expect(secret).toBe("test-secret-abc");
  });
});
