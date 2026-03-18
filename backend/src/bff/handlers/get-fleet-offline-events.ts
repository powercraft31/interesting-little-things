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
 * GET /api/fleet/offline-events
 * EP-3 v6.1: Recent gateway outage events (7 days).
 *
 * Columns: gatewayId, gatewayName, orgName, offlineStart, durationMinutes, backfillStatus.
 * Sorted: offlineStart DESC.
 * Backfill status is joined from backfill_requests by time-window overlap.
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

  const limitParam = event.queryStringParameters?.limit;
  const limit = Math.min(Math.max(parseInt(limitParam ?? "50", 10) || 50, 1), 100);

  const { rows } = await queryWithOrg(
    `SELECT
       goe.gateway_id,
       COALESCE(g.name, g.gateway_id) AS gateway_name,
       o.name AS org_name,
       goe.started_at AS offline_start,
       CASE WHEN goe.ended_at IS NOT NULL
         THEN ROUND(EXTRACT(EPOCH FROM (goe.ended_at - goe.started_at)) / 60.0)::int
         ELSE NULL
       END AS duration_minutes,
       br_latest.status AS backfill_status
     FROM gateway_outage_events goe
     JOIN gateways g ON goe.gateway_id = g.gateway_id
     JOIN organizations o ON goe.org_id = o.org_id
     LEFT JOIN LATERAL (
       SELECT br.status
       FROM backfill_requests br
       WHERE br.gateway_id = goe.gateway_id
         AND br.gap_start >= goe.started_at - INTERVAL '5 minutes'
         AND br.gap_start <= COALESCE(goe.ended_at, NOW()) + INTERVAL '5 minutes'
       ORDER BY br.created_at DESC
       LIMIT 1
     ) br_latest ON true
     WHERE goe.started_at >= NOW() - INTERVAL '7 days'
     ORDER BY goe.started_at DESC
     LIMIT $1`,
    [limit],
    rlsOrgId,
  );

  const events = rows.map((r: Record<string, unknown>) => ({
    gatewayId: r.gateway_id as string,
    gatewayName: r.gateway_name as string,
    orgName: r.org_name as string,
    offlineStart: new Date(r.offline_start as string).toISOString(),
    durationMinutes: r.duration_minutes != null ? Number(r.duration_minutes) : null,
    backfillStatus: (r.backfill_status as string) ?? null,
  }));

  const body = ok({ events, _tenant: { orgId: ctx.orgId, role: ctx.role } });

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
