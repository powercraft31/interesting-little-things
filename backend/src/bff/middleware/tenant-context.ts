import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { Role, type TenantContext } from '../../shared/types/auth';
import { fail } from '../../shared/types/api';

const VALID_ROLES = new Set<string>(Object.values(Role));

/**
 * Extract tenant context from the Authorization header.
 *
 * Accepts two formats:
 *   1. Raw JSON string: {"userId":"u1","orgId":"ORG_ENERGIA_001","role":"ORG_MANAGER"}
 *   2. JWT-style token: header.payload.signature (payload is Base64-encoded JSON
 *      with userId, orgId, role claims)
 *
 * Throws { statusCode, message } on failure.
 */
export function extractTenantContext(event: APIGatewayProxyEventV2): TenantContext {
  const token = event.headers?.['authorization'] ?? event.headers?.['Authorization'] ?? '';

  if (!token) {
    throw { statusCode: 401, message: 'Unauthorized' };
  }

  let claims: Record<string, unknown>;

  try {
    if (token.trim().startsWith('{')) {
      // Raw JSON (local testing)
      claims = JSON.parse(token);
    } else {
      // JWT-style: extract payload segment
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
 * Enforce role-based access.
 * SOLFACIL_ADMIN bypasses all role checks.
 * Throws { statusCode: 403, message: "Forbidden" } on failure.
 */
export function requireRole(ctx: TenantContext, allowedRoles: Role[]): void {
  if (ctx.role === Role.SOLFACIL_ADMIN) return;
  if (!allowedRoles.includes(ctx.role)) {
    throw { statusCode: 403, message: 'Forbidden' };
  }
}

/** Build a standard API Gateway error response. */
export function apiError(statusCode: number, message: string): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fail(message)),
  };
}
