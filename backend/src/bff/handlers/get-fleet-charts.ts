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
 * GET /api/fleet/charts
 * EP-4 v6.1: Chart data — gateway status distribution + inverter brand distribution.
 *
 * Left chart: Gateway online/offline (2 categories only, no backfill).
 * Right chart: Inverter device count per brand.
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

  const [statusResult, brandResult] = await Promise.all([
    queryWithOrg(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'online')::int                    AS online,
         COUNT(*) FILTER (WHERE status != 'online' OR status IS NULL)::int AS offline
       FROM gateways`,
      [],
      rlsOrgId,
    ),
    queryWithOrg(
      `SELECT
         COALESCE(a.brand, 'Unknown') AS brand,
         COUNT(*)::int                AS device_count
       FROM assets a
       JOIN gateways g ON g.gateway_id = a.gateway_id
       WHERE a.asset_type = 'INVERTER_BATTERY'
         AND a.is_active = true
       GROUP BY COALESCE(a.brand, 'Unknown')
       ORDER BY device_count DESC`,
      [],
      rlsOrgId,
    ),
  ]);

  const status = statusResult.rows[0] as Record<string, unknown>;

  const body = ok({
    gatewayStatus: {
      online: Number(status.online),
      offline: Number(status.offline),
    },
    inverterBrandDistribution: brandResult.rows.map(
      (r: Record<string, unknown>) => ({
        brand: r.brand as string,
        deviceCount: Number(r.device_count),
      }),
    ),
    _tenant: { orgId: ctx.orgId, role: ctx.role },
  });

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
