import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { ok } from '../../shared/types/api';
import { Role } from '../../shared/types/auth';
import { extractTenantContext, requireRole, apiError } from '../middleware/tenant-context';

/**
 * GET /revenue-trend
 * Returns 7-day revenue/cost/profit trend arrays.
 * Field names match the frontend INITIAL_DATA.revenueTrend shape exactly.
 */
export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  let ctx;
  try {
    ctx = extractTenantContext(event);
    requireRole(ctx, [Role.SOLFACIL_ADMIN, Role.ORG_MANAGER, Role.ORG_OPERATOR, Role.ORG_VIEWER]);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    return apiError(e.statusCode ?? 500, e.message ?? 'Error');
  }

  const revenueTrend = {
    receita: [42150, 38900, 45200, 48235, 51000, 39800, 41500],
    custo: [9800, 8700, 10200, 10850, 11500, 9200, 9600],
    lucro: [32350, 30200, 35000, 37385, 39500, 30600, 31900],
    _tenant: { orgId: ctx.orgId, role: ctx.role },
  };

  const body = ok(revenueTrend);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
