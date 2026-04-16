/**
 * B1 Security Headers Middleware
 *
 * Sets browser-hardening response headers on all responses.
 * App-layer ownership ensures headers are effective in all deployment
 * topologies (local dev, Docker, production behind proxy).
 *
 * HSTS is intentionally omitted — it is set at the ingress (Nginx) layer
 * because only the TLS-terminating layer can guarantee HTTPS.
 */
import type { Request, Response, NextFunction } from "express";

const CSP_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

export function securityHeaders(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.setHeader("Content-Security-Policy", CSP_POLICY);
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=()",
  );
  next();
}
