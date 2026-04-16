/**
 * Tests for securityHeaders middleware — B1 Security Headers
 *
 * Verifies that all five required security response headers are set
 * on every response passing through the middleware.
 */
import type { Request, Response } from "express";
import { securityHeaders } from "../../src/bff/middleware/security-headers";

function makeMockRes(): Response {
  const headers: Record<string, string> = {};
  return {
    setHeader: jest.fn((key: string, value: string) => {
      headers[key] = value;
    }),
    getHeader: jest.fn((key: string) => headers[key]),
    _headers: headers,
  } as unknown as Response;
}

describe("securityHeaders middleware", () => {
  const req = {} as Request;

  it("calls next()", () => {
    const res = makeMockRes();
    const next = jest.fn();
    securityHeaders(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("sets Content-Security-Policy without unsafe-inline in script-src", () => {
    const res = makeMockRes();
    securityHeaders(req, res, jest.fn());
    const csp = (res as any)._headers["Content-Security-Policy"];
    expect(csp).toBeDefined();
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("style-src 'self'");
    expect(csp).toContain("img-src 'self' data:");
    expect(csp).toContain("font-src 'self'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
  });

  it("sets X-Frame-Options to DENY", () => {
    const res = makeMockRes();
    securityHeaders(req, res, jest.fn());
    expect(res.setHeader).toHaveBeenCalledWith("X-Frame-Options", "DENY");
  });

  it("sets X-Content-Type-Options to nosniff", () => {
    const res = makeMockRes();
    securityHeaders(req, res, jest.fn());
    expect(res.setHeader).toHaveBeenCalledWith(
      "X-Content-Type-Options",
      "nosniff",
    );
  });

  it("sets Referrer-Policy to strict-origin-when-cross-origin", () => {
    const res = makeMockRes();
    securityHeaders(req, res, jest.fn());
    expect(res.setHeader).toHaveBeenCalledWith(
      "Referrer-Policy",
      "strict-origin-when-cross-origin",
    );
  });

  it("sets Permissions-Policy blocking camera, microphone, geolocation, payment", () => {
    const res = makeMockRes();
    securityHeaders(req, res, jest.fn());
    expect(res.setHeader).toHaveBeenCalledWith(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), payment=()",
    );
  });

  it("does not set Strict-Transport-Security (HSTS is ingress-only)", () => {
    const res = makeMockRes();
    securityHeaders(req, res, jest.fn());
    const headerCalls = (res.setHeader as jest.Mock).mock.calls.map(
      (c) => c[0],
    );
    expect(headerCalls).not.toContain("Strict-Transport-Security");
  });
});
