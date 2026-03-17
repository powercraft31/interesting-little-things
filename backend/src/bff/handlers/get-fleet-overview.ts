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
 * EP-1: Fleet aggregate KPIs — total devices, online/offline, homes, integradores, device types
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

  const [fleetResult, typeResult, gatewayResult, orgResult] = await Promise.all(
    [
      queryWithOrg(
        `SELECT
         COUNT(a.asset_id)::int AS total_devices,
         COUNT(a.asset_id) FILTER (WHERE g.status = 'online')::int AS online_count,
         COUNT(a.asset_id) FILTER (WHERE g.status != 'online' OR g.status IS NULL)::int AS offline_count,
         ROUND(100.0 * COUNT(a.asset_id) FILTER (WHERE g.status = 'online') / NULLIF(COUNT(a.asset_id), 0), 1) AS online_rate
       FROM assets a
       LEFT JOIN gateways g ON a.gateway_id = g.gateway_id
       WHERE a.is_active = true`,
        [],
        rlsOrgId,
      ),
      queryWithOrg(
        `SELECT
         a.asset_type AS type,
         COUNT(a.asset_id)::int AS count,
         COUNT(a.asset_id) FILTER (WHERE g.status = 'online')::int AS online
       FROM assets a
       LEFT JOIN gateways g ON a.gateway_id = g.gateway_id
       WHERE a.is_active = true
       GROUP BY a.asset_type
       ORDER BY count DESC`,
        [],
        rlsOrgId,
      ),
      queryWithOrg(
        `SELECT COUNT(*)::int AS total_gateways FROM gateways`,
        [],
        rlsOrgId,
      ),
      queryWithOrg(
        `SELECT COUNT(DISTINCT org_id)::int AS total_integradores FROM gateways`,
        [],
        rlsOrgId,
      ),
    ],
  );

  const fleet = fleetResult.rows[0] as Record<string, unknown>;
  const typeColors: Record<string, string> = {
    INVERTER_BATTERY: "#3730a3",
    SMART_METER: "#059669",
    HVAC: "#d97706",
    EV_CHARGER: "#dc2626",
    SOLAR_PANEL: "#2563eb",
  };

  const deviceTypes = typeResult.rows.map((r: Record<string, unknown>) => ({
    type: r.type as string,
    count: r.count as number,
    online: r.online as number,
    color: typeColors[r.type as string] ?? "#6b7280",
  }));

  const body = ok({
    totalDevices: Number(fleet.total_devices),
    onlineCount: Number(fleet.online_count),
    offlineCount: Number(fleet.offline_count),
    onlineRate: parseFloat(String(fleet.online_rate ?? 0)),
    totalGateways: Number(
      (gatewayResult.rows[0] as Record<string, unknown>).total_gateways,
    ),
    totalIntegradores: Number(
      (orgResult.rows[0] as Record<string, unknown>).total_integradores,
    ),
    deviceTypes,
    _tenant: { orgId: ctx.orgId, role: ctx.role },
  });

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
