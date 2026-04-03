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
 * GET /api/alerts/summary
 * P6 v7.0: Alarm centre KPI aggregation (single CTE query).
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

  const sql = `
    WITH alarm_stats AS (
      SELECT
        COUNT(*) FILTER (WHERE a.status = '0')::int
          AS active_count,
        COUNT(*) FILTER (WHERE a.status = '0' AND a.level = '2')::int
          AS severe_count,
        COUNT(*) FILTER (
          WHERE a.status = '1'
            AND COALESCE(a.event_update_time, a.created_at)
                >= DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC')
        )::int
          AS recovered_today_count,
        COUNT(DISTINCT a.gateway_id) FILTER (WHERE a.status = '0')::int
          AS affected_gateways
      FROM gateway_alarm_events a
    ),
    gw_total AS (
      SELECT COUNT(*)::int AS total_gateways FROM gateways
    ),
    severe_detail AS (
      SELECT
        STRING_AGG(
          DISTINCT a.event_name || ' em ' || g.name,
          ', '
          ORDER BY a.event_name || ' em ' || g.name
        ) AS severe_details
      FROM gateway_alarm_events a
      JOIN gateways g ON g.gateway_id = a.gateway_id
      WHERE a.status = '0' AND a.level = '2'
    )
    SELECT
      s.active_count,
      s.severe_count,
      s.recovered_today_count,
      s.affected_gateways,
      t.total_gateways,
      d.severe_details
    FROM alarm_stats s, gw_total t, severe_detail d
  `;

  const { rows } = await queryWithOrg(sql, [], ctx.orgId);
  const r = rows[0] as Record<string, unknown>;

  const body = ok({
    activeCount: Number(r.active_count),
    severeCount: Number(r.severe_count),
    recoveredTodayCount: Number(r.recovered_today_count),
    affectedGateways: Number(r.affected_gateways),
    totalGateways: Number(r.total_gateways),
    severeDetails: r.severe_details ?? null,
  });

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
