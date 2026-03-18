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
 * GET /api/gateways
 * EP-N1: Gateway list with device count and ems_health.
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
    `SELECT g.gateway_id, g.name, g.org_id, o.name AS org_name,
            g.status, g.last_seen_at, g.ems_health, g.contracted_demand_kw,
            g.home_alias,
            COUNT(a.asset_id)::int AS device_count,
            MAX(ds.battery_soc) AS battery_soc
     FROM gateways g
     JOIN organizations o ON g.org_id = o.org_id
     LEFT JOIN assets a ON a.gateway_id = g.gateway_id AND a.is_active = true
     LEFT JOIN device_state ds ON ds.asset_id = a.asset_id
     GROUP BY g.gateway_id, g.name, g.org_id, o.name, g.status, g.last_seen_at, g.ems_health, g.contracted_demand_kw, g.home_alias
     ORDER BY COALESCE(g.home_alias, g.name)`,
    [],
    rlsOrgId,
  );

  const gateways = rows.map((r: Record<string, unknown>) => ({
    gatewayId: r.gateway_id as string,
    name: r.name as string,
    homeAlias: (r.home_alias as string) || (r.name as string),
    orgId: r.org_id as string,
    orgName: r.org_name as string,
    status: (r.status as string) ?? "offline",
    lastSeenAt: r.last_seen_at
      ? new Date(r.last_seen_at as string).toISOString()
      : null,
    deviceCount: Number(r.device_count),
    emsHealth: r.ems_health ?? {},
    contractedDemandKw:
      r.contracted_demand_kw != null
        ? parseFloat(String(r.contracted_demand_kw))
        : null,
    batterySoc:
      r.battery_soc != null ? parseFloat(String(r.battery_soc)) : null,
  }));

  const body = ok({ gateways, _tenant: { orgId: ctx.orgId, role: ctx.role } });

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
