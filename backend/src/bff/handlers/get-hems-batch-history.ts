import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { ok } from "../../shared/types/api";
import { extractTenantContext, apiError } from "../middleware/auth";
import { queryWithOrg } from "../../shared/db";

// ── Types ────────────────────────────────────────────────────────────────

interface BatchHistoryRow {
  batch_id: string;
  source: string;
  dispatched_at: string;
  total: string;
  success_count: string;
  failed_count: string;
  gateways: Array<{ gatewayId: string; result: string }>;
  sample_payload: Record<string, unknown> | null;
  [key: string]: unknown;
}

// ── Handler ──────────────────────────────────────────────────────────────

/**
 * GET /api/hems/batch-history?limit=20
 * Returns batch dispatch history grouped by batch_id.
 */
export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  // 1. Auth — all roles allowed (ORG_VIEWER+)
  let ctx;
  try {
    ctx = extractTenantContext(event);
    // No requireRole — all authenticated users can view
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    return apiError(e.statusCode ?? 500, e.message ?? "Error");
  }

  const rlsOrgId = ctx.orgId;

  // 2. Parse query params
  const qs = event.queryStringParameters ?? {};
  let limit = parseInt(qs.limit ?? "20", 10);
  if (!Number.isFinite(limit) || limit < 1) limit = 20;
  if (limit > 100) limit = 100;

  // 3. Query — JOIN gateways for org filtering
  const { rows } = await queryWithOrg<BatchHistoryRow>(
    `SELECT
       dcl.batch_id,
       dcl.source,
       MIN(dcl.created_at)                                          AS dispatched_at,
       COUNT(*)                                                     AS total,
       COUNT(*) FILTER (WHERE dcl.result IN ('success','accepted')) AS success_count,
       COUNT(*) FILTER (WHERE dcl.result = 'failed')                AS failed_count,
       jsonb_agg(jsonb_build_object(
         'gatewayId', dcl.gateway_id,
         'result',    dcl.result
       ))                                                           AS gateways,
       (array_agg(dcl.payload_json ORDER BY dcl.id)
         FILTER (WHERE dcl.payload_json IS NOT NULL))[1]            AS sample_payload
     FROM device_command_logs dcl
     JOIN gateways g ON g.gateway_id = dcl.gateway_id
     WHERE dcl.batch_id IS NOT NULL
       AND dcl.command_type = 'set'
       AND ($2::VARCHAR IS NULL OR g.org_id = $2)
     GROUP BY dcl.batch_id, dcl.source
     ORDER BY MIN(dcl.created_at) DESC
     LIMIT $1`,
    [limit, rlsOrgId],
    rlsOrgId,
  );

  // 4. Format response
  const batches = rows.map((row) => ({
    batchId: row.batch_id,
    source: row.source,
    dispatchedAt: row.dispatched_at,
    total: Number(row.total),
    successCount: Number(row.success_count),
    failedCount: Number(row.failed_count),
    gateways: row.gateways,
    samplePayload: row.sample_payload,
  }));

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(ok({ batches })),
  };
}
