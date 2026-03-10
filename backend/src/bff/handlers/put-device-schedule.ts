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

interface ScheduleSlot {
  startHour: number;
  endHour: number;
  mode: string;
}

const VALID_MODES = ["self_consumption", "peak_valley_arbitrage", "peak_shaving"];

/**
 * PUT /api/devices/:assetId/schedule
 * EP-N6: Submit a schedule — writes to device_command_logs with pending_dispatch.
 * Returns 202 Accepted.
 */
export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  let ctx;
  try {
    ctx = extractTenantContext(event);
    requireRole(ctx, [Role.SOLFACIL_ADMIN, Role.ORG_MANAGER]);
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

  let body: { slots?: ScheduleSlot[] };
  try {
    body = JSON.parse(event.body ?? "{}");
  } catch {
    return apiError(400, "Invalid JSON body");
  }

  const slots = body.slots;
  if (!Array.isArray(slots) || slots.length === 0) {
    return apiError(400, "slots array is required and must not be empty");
  }

  // Validate each slot
  for (const slot of slots) {
    if (!Number.isInteger(slot.startHour) || !Number.isInteger(slot.endHour)) {
      return apiError(400, "startHour and endHour must be integers");
    }
    if (slot.startHour < 0 || slot.startHour > 24 || slot.endHour < 0 || slot.endHour > 24) {
      return apiError(400, "startHour and endHour must be between 0 and 24");
    }
    if (slot.startHour >= slot.endHour) {
      return apiError(400, "startHour must be less than endHour");
    }
    if (!VALID_MODES.includes(slot.mode)) {
      return apiError(400, `Invalid mode: ${slot.mode}. Must be one of: ${VALID_MODES.join(", ")}`);
    }
  }

  // Validate full 0-24 coverage with no gaps/overlaps
  const sorted = [...slots].sort((a, b) => a.startHour - b.startHour);
  if (sorted[0].startHour !== 0) {
    return apiError(400, "Schedule must start at hour 0");
  }
  if (sorted[sorted.length - 1].endHour !== 24) {
    return apiError(400, "Schedule must end at hour 24");
  }
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].startHour !== sorted[i - 1].endHour) {
      return apiError(400, "Schedule slots must be contiguous with no gaps or overlaps");
    }
  }

  // Get gateway_id from asset
  const assetResult = await queryWithOrg(
    `SELECT a.gateway_id FROM assets a WHERE a.asset_id = $1`,
    [assetId],
    rlsOrgId,
  );

  if (assetResult.rows.length === 0) {
    return apiError(404, "Device not found");
  }

  const gatewayId = (assetResult.rows[0] as Record<string, unknown>).gateway_id as string;

  // Insert command log
  const insertResult = await queryWithOrg(
    `INSERT INTO device_command_logs (gateway_id, command_type, config_name, payload_json, result)
     VALUES ($1, 'set', 'battery_schedule', $2, 'pending_dispatch')
     RETURNING id`,
    [gatewayId, JSON.stringify({ slots })],
    rlsOrgId,
  );

  const commandId = (insertResult.rows[0] as Record<string, unknown>).id;

  const responseBody = ok({
    commandId: Number(commandId),
    status: "pending_dispatch",
    message: "Schedule submitted. Waiting for gateway confirmation.",
  });

  return {
    statusCode: 202,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(responseBody),
  };
}
