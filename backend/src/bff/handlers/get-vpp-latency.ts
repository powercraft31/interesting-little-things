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
 * GET /api/vpp/latency
 * EP-12: Dispatch latency distribution (cumulative tiers).
 * Query param: days (default 30)
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

  const daysParam = event.queryStringParameters?.days;
  const days = Math.min(Math.max(parseInt(daysParam ?? "30", 10) || 30, 1), 365);

  const { rows } = await queryWithOrg(
    `WITH latency_data AS (
       SELECT response_latency_ms
       FROM dispatch_records
       WHERE dispatched_at >= CURRENT_DATE - $1::INT
         AND response_latency_ms IS NOT NULL
     ),
     total AS (SELECT COUNT(*) AS cnt FROM latency_data)
     SELECT
       tiers.tier,
       CASE WHEN t.cnt = 0 THEN 0
         ELSE ROUND(100.0 * COUNT(ld.response_latency_ms) / t.cnt, 1)
       END AS success_rate
     FROM (VALUES
       ('1s', 1000), ('5s', 5000), ('15s', 15000), ('30s', 30000),
       ('1min', 60000), ('15min', 900000), ('1h', 3600000)
     ) AS tiers(tier, threshold_ms)
     CROSS JOIN total t
     LEFT JOIN latency_data ld ON ld.response_latency_ms <= tiers.threshold_ms
     GROUP BY tiers.tier, tiers.threshold_ms, t.cnt
     ORDER BY tiers.threshold_ms`,
    [days],
    rlsOrgId,
  );

  const tiers = rows.map((r: Record<string, unknown>) => ({
    tier: r.tier as string,
    successRate: parseFloat(String(r.success_rate)),
  }));

  const body = ok({ tiers, _tenant: { orgId: ctx.orgId, role: ctx.role } });

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
