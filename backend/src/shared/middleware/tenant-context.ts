/**
 * Shared Layer — Pure tenant context functions (zero framework dependencies).
 *
 * This file MUST NOT import any HTTP/cloud framework types
 * (no aws-lambda, no APIGatewayProxyEventV2, no express, etc.).
 *
 * BFF uses these via its HTTP adapter (bff/middleware/auth.ts).
 * M4 and M8 import directly.
 */
import jwt from "jsonwebtoken";
import { Role, type TenantContext } from '../types/auth';

const VALID_ROLES = new Set<string>(Object.values(Role));

/**
 * Verify a raw tenant token and return a TenantContext.
 * Pure function: accepts a raw token string, no HTTP concepts.
 *
 * Supports two formats:
 *   1. Raw JSON: {"userId":"u1","orgId":"ORG_ENERGIA_001","role":"ORG_MANAGER"}
 *   2. JWT with signature verification (v5.23): jwt.verify() with HS256
 *
 * Throws { statusCode, message } on failure.
 */
export function verifyTenantToken(token: string): TenantContext {
  if (!token) {
    throw { statusCode: 401, message: 'Unauthorized' };
  }

  // Path 1: Raw JSON (kept for tests + downstream handlers after auth middleware overwrites header)
  if (token.trim().startsWith('{')) {
    let claims: Record<string, unknown>;
    try {
      claims = JSON.parse(token);
    } catch {
      throw { statusCode: 401, message: 'Invalid token' };
    }

    const { userId, orgId, role } = claims as { userId?: string; orgId?: string; role?: string };
    if (!userId || !orgId || !role || !VALID_ROLES.has(role)) {
      throw { statusCode: 401, message: 'Invalid token' };
    }
    return { userId, orgId, role: role as Role };
  }

  // Path 2: JWT with signature verification (v5.23)
  const jwtSecret = process.env.JWT_SECRET || "solfacil-dev-secret";
  const rawToken = token.replace(/^Bearer\s+/i, '');
  try {
    const decoded = jwt.verify(rawToken, jwtSecret) as {
      userId: string; orgId: string; role: string;
    };

    const { userId, orgId, role } = decoded;
    if (!userId || !orgId || !role || !VALID_ROLES.has(role)) {
      throw { statusCode: 401, message: 'Invalid token' };
    }
    return { userId, orgId, role: role as Role };
  } catch (err) {
    // Re-throw our own structured errors
    if (err && typeof err === 'object' && 'statusCode' in err) {
      throw err;
    }
    throw { statusCode: 401, message: 'Invalid or expired token' };
  }
}

/**
 * Enforce RBAC role check.
 * SOLFACIL_ADMIN bypasses all role checks.
 * Throws { statusCode: 403, message: "Forbidden" } on failure.
 */
export function requireRole(ctx: TenantContext, allowedRoles: Role[]): void {
  if (ctx.role === Role.SOLFACIL_ADMIN) return;
  if (!allowedRoles.includes(ctx.role)) {
    throw { statusCode: 403, message: 'Forbidden' };
  }
}
