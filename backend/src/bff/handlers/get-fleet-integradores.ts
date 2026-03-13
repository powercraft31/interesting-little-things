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
 * EP-2: Integrador list with device counts and online rates.
 * Min role: SOLFACIL_ADMIN
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
    return apiError(e.statusCode ?? 500, e.message ?? "Error");
  }

  const { rows } = await queryWithOrg(
    `SELECT
       o.org_id,
       o.name,
       COUNT(a.asset_id)::int AS device_count,
       ROUND(100.0 * COUNT(a.asset_id) FILTER (WHERE g.status = 'online')
         / NULLIF(COUNT(a.asset_id), 0), 1) AS online_rate,
       MAX(a.commissioned_at) AS last_commission
     FROM organizations o
     LEFT JOIN assets a ON o.org_id = a.org_id AND a.is_active = true
     LEFT JOIN gateways g ON a.gateway_id = g.gateway_id
     GROUP BY o.org_id, o.name
     ORDER BY o.name`,
    [],
    ctx.role === 'SOLFACIL_ADMIN' ? null : ctx.orgId,
  );

  const integradores = rows.map((r: Record<string, unknown>) => ({
    orgId: r.org_id as string,
    name: r.name as string,
    deviceCount: Number(r.device_count),
    onlineRate: r.online_rate != null ? parseFloat(String(r.online_rate)) : null,
    lastCommission: r.last_commission
      ? new Date(r.last_commission as string).toISOString()
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
