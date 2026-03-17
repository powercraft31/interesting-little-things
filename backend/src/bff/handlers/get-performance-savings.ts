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
 * GET /api/performance/savings
 * EP-15: Savings breakdown by home.
 * Query param: period (month|quarter|year, default month)
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

  const period = event.queryStringParameters?.period ?? "month";
  let dateTrunc: string;
  switch (period) {
    case "quarter":
      dateTrunc = "quarter";
      break;
    case "year":
      dateTrunc = "year";
      break;
    default:
      dateTrunc = "month";
  }

  const { rows } = await queryWithOrg(
    `SELECT
       g.name AS home,
       COALESCE(SUM(rd.client_savings_reais), 0) AS total,
       COALESCE(SUM(rd.sc_savings_reais), 0)     AS sc,
       COALESCE(SUM(rd.tou_savings_reais), 0)    AS tou,
       COALESCE(SUM(rd.ps_savings_reais), 0)     AS ps
     FROM revenue_daily rd
     JOIN assets a ON rd.asset_id = a.asset_id
     JOIN gateways g ON a.gateway_id = g.gateway_id
     WHERE rd.date >= date_trunc('${dateTrunc}', CURRENT_DATE)
       AND a.is_active = true
     GROUP BY g.gateway_id, g.name
     ORDER BY total DESC`,
    [],
    rlsOrgId,
  );

  const savings = rows.map((r: Record<string, unknown>) => ({
    home: r.home as string,
    total: Math.round(parseFloat(String(r.total)) * 100) / 100,
    sc: parseFloat(String(r.sc)),
    tou: parseFloat(String(r.tou)),
    ps: parseFloat(String(r.ps)),
  }));

  const body = ok({ savings, _tenant: { orgId: ctx.orgId, role: ctx.role } });

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
