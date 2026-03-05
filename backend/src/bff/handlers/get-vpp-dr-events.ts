import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { ok } from "../../shared/types/api";
import { Role } from "../../shared/types/auth";
import {
  extractTenantContext,
  requireRole,
  apiError,
} from "../middleware/auth";
import { queryWithOrg } from "../../shared/db";

/**
 * GET /api/vpp/dr-events
 * EP-13: DR event history grouped by hour.
 * Query param: limit (default 20)
 */
export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  let ctx;
  try {
    ctx = extractTenantContext(event);
    requireRole(ctx, [
      Role.SOLFACIL_ADMIN,
      Role.ORG_MANAGER,
      Role.ORG_OPERATOR,
      Role.ORG_VIEWER,
    ]);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    return apiError(e.statusCode ?? 500, e.message ?? "Error");
  }

  const isAdmin = ctx.role === Role.SOLFACIL_ADMIN;
  const rlsOrgId = isAdmin ? null : ctx.orgId;

  const limitParam = event.queryStringParameters?.limit;
  const limit = Math.min(Math.max(parseInt(limitParam ?? "20", 10) || 20, 1), 100);

  const { rows } = await queryWithOrg(
    `SELECT
       MIN(dr.id)::TEXT AS id,
       CASE
         WHEN AVG(dr.commanded_power_kw) > 0 THEN 'Discharge'
         WHEN AVG(dr.commanded_power_kw) < 0 THEN 'Charge'
         ELSE 'Curtailment'
       END AS type,
       MIN(dr.dispatched_at) AS triggered_at,
       ABS(COALESCE(SUM(dr.commanded_power_kw), 0)) AS target_kw,
       ABS(COALESCE(SUM(dr.actual_power_kw), 0)) AS achieved_kw,
       CASE WHEN ABS(COALESCE(SUM(dr.commanded_power_kw), 0)) = 0 THEN 0
         ELSE ROUND(100.0 * ABS(COALESCE(SUM(dr.actual_power_kw), 0))
           / ABS(SUM(dr.commanded_power_kw)), 1)
       END AS accuracy,
       COUNT(*) FILTER (WHERE dr.success = true)::int AS participated,
       COUNT(*) FILTER (WHERE dr.success = false)::int AS failed
     FROM dispatch_records dr
     GROUP BY date_trunc('hour', dr.dispatched_at)
     ORDER BY triggered_at DESC
     LIMIT $1`,
    [limit],
    rlsOrgId,
  );

  const events = rows.map((r: Record<string, unknown>) => ({
    id: r.id as string,
    type: r.type as string,
    triggeredAt: new Date(r.triggered_at as string).toISOString(),
    targetKw: Math.round(parseFloat(String(r.target_kw)) * 10) / 10,
    achievedKw: Math.round(parseFloat(String(r.achieved_kw)) * 10) / 10,
    accuracy: parseFloat(String(r.accuracy)),
    participated: Number(r.participated),
    failed: Number(r.failed),
  }));

  const body = ok({ events, _tenant: { orgId: ctx.orgId, role: ctx.role } });

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
