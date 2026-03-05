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
 * GET /api/homes
 * EP-6: Home list with device count.
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

  const { rows } = await queryWithOrg(
    `SELECT
       h.home_id AS id,
       h.name,
       h.org_id,
       o.name AS org_name,
       COUNT(a.asset_id)::int AS device_count
     FROM homes h
     JOIN organizations o ON h.org_id = o.org_id
     LEFT JOIN assets a ON a.home_id = h.home_id AND a.is_active = true
     GROUP BY h.home_id, h.name, h.org_id, o.name
     ORDER BY h.name`,
    [],
    rlsOrgId,
  );

  const homes = rows.map((r: Record<string, unknown>) => ({
    id: r.id as string,
    name: r.name as string,
    orgId: r.org_id as string,
    orgName: r.org_name as string,
    deviceCount: Number(r.device_count),
  }));

  const body = ok({ homes, _tenant: { orgId: ctx.orgId, role: ctx.role } });

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
