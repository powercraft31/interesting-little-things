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
 * GET /api/alerts
 * P6 v7.0: Alert list with dynamic filtering.
 *
 * Query params: status, level (comma-separated), gatewayId, period (24h/7d/30d),
 *               limit (default 500, max 1000), offset (default 0).
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

  const qs = event.queryStringParameters ?? {};

  // Build dynamic WHERE clauses
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (qs.status !== undefined) {
    conditions.push(`AND a.status = $${paramIdx}`);
    params.push(qs.status);
    paramIdx++;
  }

  if (qs.level !== undefined) {
    const levels = qs.level.split(",").map((l) => l.trim());
    conditions.push(`AND a.level = ANY($${paramIdx}::text[])`);
    params.push(levels);
    paramIdx++;
  }

  if (qs.gatewayId !== undefined) {
    conditions.push(`AND a.gateway_id = $${paramIdx}`);
    params.push(qs.gatewayId);
    paramIdx++;
  }

  // Period filter — hardcoded INTERVAL strings only (not parameterized)
  const periodMap: Record<string, string> = {
    "24h": "24 hours",
    "7d": "7 days",
    "30d": "30 days",
  };
  if (qs.period && periodMap[qs.period]) {
    conditions.push(
      `AND a.event_create_time >= NOW() - INTERVAL '${periodMap[qs.period]}'`,
    );
  }

  const limit = Math.min(Math.max(parseInt(qs.limit ?? "", 10) || 500, 1), 1000);
  const offset = Math.max(parseInt(qs.offset ?? "", 10) || 0, 0);

  params.push(limit);
  const limitIdx = paramIdx++;
  params.push(offset);
  const offsetIdx = paramIdx++;

  const sql = `
    SELECT
      a.id,
      a.gateway_id       AS "gatewayId",
      g.name             AS "gatewayName",
      a.device_sn        AS "deviceSn",
      a.sub_dev_id       AS "subDevId",
      a.sub_dev_name     AS "subDevName",
      a.product_type     AS "productType",
      a.event_id         AS "eventId",
      a.event_name       AS "eventName",
      a.event_type       AS "eventType",
      a.level,
      a.status,
      a.prop_id          AS "propId",
      a.prop_name        AS "propName",
      a.prop_value       AS "propValue",
      a.description,
      a.event_create_time AS "eventCreateTime",
      a.event_update_time AS "eventUpdateTime"
    FROM gateway_alarm_events a
    JOIN gateways g ON g.gateway_id = a.gateway_id
    WHERE 1=1
      ${conditions.join("\n      ")}
    ORDER BY a.event_create_time DESC
    LIMIT $${limitIdx} OFFSET $${offsetIdx}
  `;

  const { rows } = await queryWithOrg(sql, params, ctx.orgId);

  const body = ok(rows);

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
