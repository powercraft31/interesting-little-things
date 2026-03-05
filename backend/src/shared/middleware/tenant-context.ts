/**
 * Shared Layer — Pure tenant context functions (zero framework dependencies).
 *
 * This file MUST NOT import any HTTP/cloud framework types
 * (no aws-lambda, no APIGatewayProxyEventV2, no express, etc.).
 *
 * BFF uses these via its HTTP adapter (bff/middleware/auth.ts).
 * M4 and M8 import directly.
 */
import { Role, type TenantContext } from '../types/auth';

const VALID_ROLES = new Set<string>(Object.values(Role));

/**
 * Verify a raw tenant token and return a TenantContext.
 * Pure function: accepts a raw token string, no HTTP concepts.
 *
 * Supports two formats:
 *   1. Raw JSON: {"userId":"u1","orgId":"ORG_ENERGIA_001","role":"ORG_MANAGER"}
 *   2. JWT-style: header.payload.signature (payload is Base64-encoded JSON)
 *
 * Throws { statusCode, message } on failure.
 */
export function verifyTenantToken(token: string): TenantContext {
  if (!token) {
    throw { statusCode: 401, message: 'Unauthorized' };
  }

  let claims: Record<string, unknown>;

  try {
    if (token.trim().startsWith('{')) {
      claims = JSON.parse(token);
    } else {
      const parts = token.replace(/^Bearer\s+/i, '').split('.');
      if (parts.length < 2) {
        throw new Error('malformed token');
      }
      const payload = Buffer.from(parts[1], 'base64').toString('utf-8');
      claims = JSON.parse(payload);
    }
  } catch {
    throw { statusCode: 401, message: 'Invalid token' };
  }

  const { userId, orgId, role } = claims as { userId?: string; orgId?: string; role?: string };

  if (!userId || !orgId || !role || !VALID_ROLES.has(role)) {
    throw { statusCode: 401, message: 'Invalid token' };
  }

  return { userId, orgId, role: role as Role };
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
