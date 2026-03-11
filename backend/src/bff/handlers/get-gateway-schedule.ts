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
 * GET /api/gateways/:gatewayId/schedule
 * Read latest schedule from device_command_logs by gateway_id directly.
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

  // Extract gatewayId from path: /api/gateways/:gatewayId/schedule
  const pathParts = event.rawPath.split("/");
  const gwIdx = pathParts.indexOf("gateways");
  const gatewayId = gwIdx >= 0 ? pathParts[gwIdx + 1] : "";

  if (!gatewayId) {
    return apiError(400, "gatewayId is required");
  }

  const { rows } = await queryWithOrg(
    `SELECT id, payload_json, result, resolved_at, created_at
     FROM device_command_logs
     WHERE gateway_id = $1
       AND command_type = 'set'
       AND config_name = 'battery_schedule'
     ORDER BY created_at DESC
     LIMIT 1`,
    [gatewayId],
    rlsOrgId,
  );

  if (rows.length === 0) {
    const body = ok({
      syncStatus: "unknown",
      lastAckAt: null,
      slots: [],
    });
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    };
  }

  const row = rows[0] as Record<string, unknown>;
  const result = row.result as string;
  const payload = row.payload_json as Record<string, unknown> | null;
  const slots = payload?.slots ?? [];

  const syncStatus = result === "success"
    ? "synced"
    : (result === "pending" || result === "pending_dispatch")
      ? "pending"
      : "unknown";

  const lastAckAt = row.resolved_at
    ? new Date(row.resolved_at as string).toISOString()
    : null;

  const body = ok({
    syncStatus,
    lastAckAt,
    slots,
  });

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
