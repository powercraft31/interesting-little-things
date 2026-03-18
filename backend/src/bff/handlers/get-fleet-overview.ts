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
 * GET /api/fleet/overview
 * EP-1 v6.1: Fleet aggregate KPIs — gateway-first.
 *
 * Returns: totalGateways, offlineGateways, onlineGateways, gatewayOnlineRate,
 *          backfillPressure (count + hasFailure), organizationCount.
 *
 * NOTE: backfill_requests uses 'pending' as DB value (maps to REQ 'not_started').
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

  const rlsOrgId = ctx.orgId;

  const { rows } = await queryWithOrg(
    `WITH gw AS (
       SELECT
         COUNT(*)::int                                                    AS total_gateways,
         COUNT(*) FILTER (WHERE status = 'online')::int                  AS online_gateways,
         COUNT(*) FILTER (WHERE status != 'online'
                             OR status IS NULL)::int                     AS offline_gateways,
         CASE WHEN COUNT(*) > 0
           THEN ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'online') / COUNT(*))::int
           ELSE 0
         END                                                              AS gateway_online_rate,
         COUNT(DISTINCT org_id)::int                                      AS organization_count
       FROM gateways
     ),
     bf AS (
       SELECT
         COUNT(DISTINCT br.gateway_id)::int                               AS backfill_pressure_count,
         COALESCE(BOOL_OR(br.status = 'failed'), false)                   AS has_backfill_failure
       FROM backfill_requests br
       JOIN gateways g ON g.gateway_id = br.gateway_id
       WHERE br.status IN ('pending','in_progress','failed')
     )
     SELECT gw.*, bf.backfill_pressure_count, bf.has_backfill_failure
     FROM gw, bf`,
    [],
    rlsOrgId,
  );

  const r = rows[0] as Record<string, unknown>;

  const body = ok({
    totalGateways: Number(r.total_gateways),
    offlineGateways: Number(r.offline_gateways),
    onlineGateways: Number(r.online_gateways),
    gatewayOnlineRate: Number(r.gateway_online_rate),
    backfillPressure: {
      count: Number(r.backfill_pressure_count),
      hasFailure: Boolean(r.has_backfill_failure),
    },
    organizationCount: Number(r.organization_count),
    _tenant: { orgId: ctx.orgId, role: ctx.role },
  });

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
