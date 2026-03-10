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
 * GET /api/devices
 * EP-5: Full device list with telemetry (unified assets model).
 * Query params: type, status, search
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

  const typeFilter = event.queryStringParameters?.type ?? "all";
  const statusFilter = event.queryStringParameters?.status ?? "all";
  const searchFilter = event.queryStringParameters?.search ?? "";

  const { rows } = await queryWithOrg(
    `SELECT
       a.asset_id AS device_id,
       a.asset_type AS type,
       a.brand,
       a.model,
       a.gateway_id,
       g.name AS gateway_name,
       a.org_id,
       o.name AS org_name,
       CASE WHEN g.status = 'online' THEN 'online' ELSE 'offline' END AS status,
       COALESCE(g.last_seen_at, ds.updated_at) AS last_seen,
       a.commissioned_at AS commission_date,
       ds.telemetry_json AS telemetry
     FROM assets a
     LEFT JOIN gateways g ON a.gateway_id = g.gateway_id
     JOIN organizations o ON a.org_id = o.org_id
     LEFT JOIN device_state ds ON a.asset_id = ds.asset_id
     WHERE a.is_active = true
       AND ($1 = 'all' OR a.asset_type = $1)
       AND ($2 = 'all' OR (CASE WHEN g.status = 'online' THEN 'online' ELSE 'offline' END) = $2)
       AND ($3 = '' OR a.asset_id ILIKE '%' || $3 || '%'
            OR COALESCE(g.name, '') ILIKE '%' || $3 || '%'
            OR a.name ILIKE '%' || $3 || '%')
     ORDER BY a.asset_id`,
    [typeFilter, statusFilter, searchFilter],
    rlsOrgId,
  );

  const devices = rows.map((r: Record<string, unknown>) => ({
    deviceId: r.device_id as string,
    type: r.type as string,
    brand: r.brand as string,
    model: r.model as string,
    gatewayId: r.gateway_id as string | null,
    gatewayName: (r.gateway_name as string) ?? null,
    orgId: r.org_id as string,
    orgName: r.org_name as string,
    status: r.status as string,
    lastSeen: r.last_seen
      ? new Date(r.last_seen as string).toISOString()
      : null,
    commissionDate: r.commission_date
      ? new Date(r.commission_date as string).toISOString()
      : null,
    telemetry: r.telemetry ?? {},
  }));

  const body = ok({ devices, _tenant: { orgId: ctx.orgId, role: ctx.role } });

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
