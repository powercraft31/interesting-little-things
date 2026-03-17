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
 * GET /api/fleet/uptime-trend
 * EP-4: 28-day daily uptime percentage trend.
 * Query param: days (default 28)
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

  const daysParam = event.queryStringParameters?.days;
  const days = Math.min(Math.max(parseInt(daysParam ?? "28", 10) || 28, 1), 365);

  const { rows } = await queryWithOrg(
    `SELECT
       TO_CHAR(date, 'DD/MM') AS date,
       ROUND(AVG(uptime_pct), 1) AS uptime
     FROM daily_uptime_snapshots
     WHERE date >= CURRENT_DATE - $1::INT
     GROUP BY date
     ORDER BY date ASC`,
    [days],
    rlsOrgId,
  );

  const trend = rows.map((r: Record<string, unknown>) => ({
    date: r.date as string,
    uptime: parseFloat(String(r.uptime)),
  }));

  const body = ok({ trend, _tenant: { orgId: ctx.orgId, role: ctx.role } });

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
