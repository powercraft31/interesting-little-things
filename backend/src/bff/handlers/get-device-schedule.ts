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
 * GET /api/devices/:assetId/schedule
 * EP-N5: Read last successful schedule from device_command_logs.
 * v5.19 transitional: does NOT send MQTT config/get.
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

  // Extract assetId from path: /api/devices/:assetId/schedule
  const pathParts = event.rawPath.split("/");
  const devicesIdx = pathParts.indexOf("devices");
  const assetId = devicesIdx >= 0 ? pathParts[devicesIdx + 1] : "";

  if (!assetId) {
    return apiError(400, "assetId is required");
  }

  // Check for pending_dispatch first, then success
  const { rows } = await queryWithOrg(
    `SELECT dcl.payload_json, dcl.created_at, dcl.result
     FROM device_command_logs dcl
     JOIN assets a ON a.gateway_id = dcl.gateway_id
     WHERE a.asset_id = $1
       AND dcl.command_type = 'set'
       AND dcl.config_name = 'battery_schedule'
       AND dcl.result IN ('success', 'pending_dispatch')
     ORDER BY dcl.created_at DESC
     LIMIT 1`,
    [assetId],
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

  const syncStatus = result === "success" ? "synced" : "pending";
  const lastAckAt = result === "success"
    ? new Date(row.created_at as string).toISOString()
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
