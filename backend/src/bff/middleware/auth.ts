/**
 * BFF Auth Middleware — Cookie-first JWT authentication + backward-compatible exports.
 *
 * v5.23: Added Express authMiddleware for JWT validation.
 * v6.9 B3: Rewritten for cookie-first auth. Browser contract uses session cookie;
 *          machine contract uses Authorization: Bearer. Cookie wins when both present.
 *
 * Keeps extractTenantContext() and apiError() for handler backward compatibility.
 */
import type { Request, Response, NextFunction } from "express";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { verifyTenantToken, requireRole } from '../../shared/middleware/tenant-context';
import type { TenantContext } from '../../shared/types/auth';
import { fail } from '../../shared/types/api';

// Re-export requireRole for BFF handler convenience
export { requireRole };

// ── v6.9 B3: Session cookie name ────────────────────────────────────────

/**
 * Cookie name for browser session auth.
 * Production: __Host-solfacil_session (requires Secure, no Domain)
 * Development: solfacil_session (allows HTTP localhost)
 */
export const SESSION_COOKIE_NAME = process.env.NODE_ENV === 'production'
  ? '__Host-solfacil_session'
  : 'solfacil_session';

// ── v5.23: Express JWT Auth Middleware ────────────────────────────────────

/** Public routes that skip JWT verification */
const PUBLIC_ROUTES = ["/api/auth/login", "/api/auth/logout"];

function getCookieValue(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (rawKey === name) {
      return decodeURIComponent(rest.join("="));
    }
  }
  return null;
}

/**
 * Express middleware: validates JWT on /api/* routes (except public ones).
 *
 * v6.9 B3 auth resolution order:
 *   1. Check session cookie → browser contract
 *   2. Check Authorization: Bearer header → machine contract
 *   3. Neither → 401
 *
 * Cookie wins when both are present.
 *
 * On success, overwrites req.headers.authorization with raw JSON so
 * downstream handlers (via wrapHandler → extractTenantContext) see no change.
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Skip auth for public routes
  if (PUBLIC_ROUTES.includes(req.path)) {
    next();
    return;
  }

  // Skip auth for non-API routes (static files, frontend)
  if (!req.path.startsWith("/api/")) {
    next();
    return;
  }

  // ── v6.9 B3: Cookie-first auth resolution ──────────────────────────

  // 1. Check session cookie first (browser contract)
  const cookieToken = getCookieValue(req.headers.cookie, SESSION_COOKIE_NAME);

  // 2. Check Authorization header (machine contract or raw JSON backward compat)
  const authHeader = req.headers.authorization;

  // Cookie wins when both present; otherwise use whichever is available
  const token = cookieToken ?? authHeader ?? null;

  if (!token) {
    res.status(401).json(fail("Authorization header or auth cookie required"));
    return;
  }

  // Determine if this is a bearer-only request (no cookie)
  const isBearerOnly = !cookieToken && authHeader !== undefined;

  // Strip "Bearer " prefix if present (for bearer tokens and legacy paths)
  const rawToken = token.startsWith("Bearer ")
    ? token.slice(7)
    : token;

  // v6.9 B3.7: LEGACY_BROWSER_BEARER warning logging
  if (isBearerOnly && rawToken.trim().startsWith("{") === false && process.env.LEGACY_BROWSER_BEARER === "true") {
    console.warn("Legacy browser bearer auth used — migrate to cookie");
  }

  try {
    const ctx = verifyTenantToken(rawToken);

    // KEY: overwrite authorization header with raw JSON
    // All downstream handlers see the same format as demo mode
    req.headers.authorization = JSON.stringify({
      userId: ctx.userId,
      orgId: ctx.orgId,
      role: ctx.role,
    });

    next();
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 401).json(fail(e.message ?? "Authentication failed"));
  }
}

// ── Backward-compatible exports (used by 32 BFF handlers via wrapHandler) ─

/**
 * HTTP adapter: extract Authorization header from API Gateway event,
 * delegate to shared verifyTenantToken pure function.
 */
export function extractTenantContext(event: APIGatewayProxyEventV2): TenantContext {
  const token = event.headers?.['authorization'] ?? event.headers?.['Authorization'] ?? '';
  return verifyTenantToken(token);
}

/**
 * Build a standard API Gateway error response.
 * BFF-only — does not belong in Shared Layer.
 */
export function apiError(statusCode: number, message: string): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fail(message)),
  };
}
