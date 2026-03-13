/**
 * BFF Auth Middleware — JWT authentication + backward-compatible exports.
 *
 * v5.23: Added Express authMiddleware for JWT validation.
 * Keeps extractTenantContext() and apiError() for handler backward compatibility.
 */
import type { Request, Response, NextFunction } from "express";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { verifyTenantToken, requireRole } from '../../shared/middleware/tenant-context';
import type { TenantContext } from '../../shared/types/auth';
import { fail } from '../../shared/types/api';

// Re-export requireRole for BFF handler convenience
export { requireRole };

// ── v5.23: Express JWT Auth Middleware ────────────────────────────────────

/** Public routes that skip JWT verification */
const PUBLIC_ROUTES = ["/api/auth/login"];

/**
 * Express middleware: validates JWT on /api/* routes (except public ones).
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

  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.status(401).json(fail("Authorization header required"));
    return;
  }

  // Strip "Bearer " prefix if present
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : authHeader;

  try {
    const ctx = verifyTenantToken(token);

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
