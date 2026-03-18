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
 * GET /api/fleet/integradores
 * EP-2 v6.1: Organization summary table — gateway-first.
 *
 * Columns: org, gatewayCount, gatewayOnlineRate, backfillPendingFailed, lastCommissioning.
 * Only orgs with >= 1 gateway are returned.
 * Sorted: gatewayOnlineRate ASC, gatewayCount DESC.
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
         o.org_id,
         o.name,
         COUNT(g.gateway_id)::int                                         AS gateway_count,
         COUNT(*) FILTER (WHERE g.status = 'online')::int                 AS online_gateways,
         MAX(COALESCE(g.commissioned_at, g_first_telem.first_ts))         AS last_commissioning
       FROM organizations o
       INNER JOIN gateways g ON g.org_id = o.org_id
       LEFT JOIN LATERAL (
         SELECT MIN(th.recorded_at) AS first_ts
         FROM telemetry_history th
         JOIN assets a ON a.asset_id = th.asset_id
         WHERE a.gateway_id = g.gateway_id
       ) g_first_telem ON true
       GROUP BY o.org_id, o.name
     ),
     bf AS (
       SELECT
         g.org_id,
         COUNT(DISTINCT br.gateway_id)::int                               AS backfill_pending_failed
       FROM backfill_requests br
       JOIN gateways g ON g.gateway_id = br.gateway_id
       WHERE br.status IN ('pending','in_progress','failed')
       GROUP BY g.org_id
     )
     SELECT
       gw.org_id,
       gw.name,
       gw.gateway_count,
       CASE WHEN gw.gateway_count > 0
         THEN ROUND(100.0 * gw.online_gateways / gw.gateway_count)::int
         ELSE 0
       END                                                               AS gateway_online_rate,
       COALESCE(bf.backfill_pending_failed, 0)::int                      AS backfill_pending_failed,
       gw.last_commissioning
     FROM gw
     LEFT JOIN bf ON bf.org_id = gw.org_id
     WHERE gw.gateway_count > 0
     ORDER BY gateway_online_rate ASC, gateway_count DESC`,
    [],
    rlsOrgId,
  );

  const integradores = rows.map((r: Record<string, unknown>) => ({
    orgId: r.org_id as string,
    name: r.name as string,
    gatewayCount: Number(r.gateway_count),
    gatewayOnlineRate: Number(r.gateway_online_rate),
    backfillPendingFailed: Number(r.backfill_pending_failed),
    lastCommissioning: r.last_commissioning
      ? new Date(r.last_commissioning as string).toISOString()
      : null,
  }));

  const body = ok({
    integradores,
    _tenant: { orgId: ctx.orgId, role: ctx.role },
  });

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
