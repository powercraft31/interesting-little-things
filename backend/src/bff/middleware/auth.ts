/**
 * BFF HTTP Adapter — extracts tenant context from API Gateway events.
 * Delegates token verification to shared/middleware/tenant-context.ts.
 *
 * This file stays in BFF because it depends on aws-lambda types.
 */
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { verifyTenantToken, requireRole } from '../../shared/middleware/tenant-context';
import type { TenantContext } from '../../shared/types/auth';
import { fail } from '../../shared/types/api';

// Re-export requireRole for BFF handler convenience
export { requireRole };

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
