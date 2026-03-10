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
 * GET /api/gateways/summary
 * EP-8: Cross-gateway comparison table.
 * Query param: date (ISO, default today)
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

  const dateParam = event.queryStringParameters?.date ?? new Date().toISOString().slice(0, 10);

  const { rows } = await queryWithOrg(
    `SELECT
       g.gateway_id,
       g.name,
       COALESCE(SUM(rd.grid_export_kwh), 0) AS grid_export,
       COALESCE(SUM(rd.grid_import_kwh), 0) AS grid_import,
       COALESCE(AVG(rd.actual_self_consumption_pct), 0) AS self_cons,
       COALESCE(MAX(ds.load_power), 0) AS peak_load,
       a2.operation_mode AS mode
     FROM gateways g
     LEFT JOIN assets a ON a.gateway_id = g.gateway_id AND a.is_active = true
     LEFT JOIN revenue_daily rd ON rd.asset_id = a.asset_id AND rd.date = $1::DATE
     LEFT JOIN device_state ds ON ds.asset_id = a.asset_id
     LEFT JOIN LATERAL (
       SELECT a3.operation_mode
       FROM assets a3
       WHERE a3.gateway_id = g.gateway_id AND a3.is_active = true AND a3.asset_type = 'INVERTER_BATTERY'
       LIMIT 1
     ) a2 ON true
     GROUP BY g.gateway_id, g.name, a2.operation_mode
     ORDER BY g.name`,
    [dateParam],
    rlsOrgId,
  );

  const summary = rows.map((r: Record<string, unknown>) => ({
    gatewayId: r.gateway_id as string,
    name: r.name as string,
    selfCons: Math.round(parseFloat(String(r.self_cons)) * 10) / 10,
    gridExport: Math.round(parseFloat(String(r.grid_export)) * 100) / 100,
    gridImport: Math.round(parseFloat(String(r.grid_import)) * 100) / 100,
    peakLoad: Math.round(parseFloat(String(r.peak_load)) * 10) / 10,
    mode: (r.mode as string) ?? "self_consumption",
  }));

  const body = ok({ summary, _tenant: { orgId: ctx.orgId, role: ctx.role } });

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
