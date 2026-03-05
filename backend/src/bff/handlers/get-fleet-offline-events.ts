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
 * GET /api/fleet/offline-events
 * EP-3: Recent offline events with duration and cause.
 * Query param: limit (default 20)
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

  const limitParam = event.queryStringParameters?.limit;
  const limit = Math.min(Math.max(parseInt(limitParam ?? "20", 10) || 20, 1), 100);

  const { rows } = await queryWithOrg(
    `SELECT
       oe.asset_id AS device_id,
       oe.started_at AS start,
       EXTRACT(EPOCH FROM (COALESCE(oe.ended_at, NOW()) - oe.started_at)) / 3600.0 AS duration_hrs,
       oe.cause,
       oe.backfill
     FROM offline_events oe
     JOIN assets a ON oe.asset_id = a.asset_id
     WHERE a.is_active = true
     ORDER BY oe.started_at DESC
     LIMIT $1`,
    [limit],
    rlsOrgId,
  );

  const events = rows.map((r: Record<string, unknown>) => ({
    deviceId: r.device_id as string,
    start: new Date(r.start as string).toISOString(),
    durationHrs: Math.round(parseFloat(String(r.duration_hrs)) * 10) / 10,
    cause: r.cause as string,
    backfill: r.backfill as boolean,
  }));

  const body = ok({ events, _tenant: { orgId: ctx.orgId, role: ctx.role } });

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
