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
import {
  parseGetReply,
  type ProtocolSchedule,
  type DomainSlot,
} from "../../iot-hub/handlers/schedule-translator";

/**
 * GET /api/gateways/:gatewayId/schedule
 * Returns full battery schedule config from latest get_reply + sync status from latest set.
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

  // Query 1: Latest successful set command (user's last applied config)
  const setSuccessResult = await queryWithOrg(
    `SELECT payload_json
     FROM device_command_logs
     WHERE gateway_id = $1
       AND command_type = 'set'
       AND config_name = 'battery_schedule'
       AND result = 'success'
       AND payload_json IS NOT NULL
     ORDER BY created_at DESC
     LIMIT 1`,
    [gatewayId],
    rlsOrgId,
  );

  // Query 2: Fallback — latest get_reply (gateway-reported config)
  const getReplyResult = await queryWithOrg(
    `SELECT payload_json
     FROM device_command_logs
     WHERE gateway_id = $1
       AND command_type = 'get_reply'
       AND config_name = 'battery_schedule'
       AND payload_json IS NOT NULL
     ORDER BY created_at DESC
     LIMIT 1`,
    [gatewayId],
    rlsOrgId,
  );

  // Query 3: Latest set command (any status) for sync status
  const setResult = await queryWithOrg(
    `SELECT result, resolved_at, created_at
     FROM device_command_logs
     WHERE gateway_id = $1
       AND command_type = 'set'
       AND config_name = 'battery_schedule'
     ORDER BY created_at DESC
     LIMIT 1`,
    [gatewayId],
    rlsOrgId,
  );

  // Priority: successful set payload > get_reply > null
  let batterySchedule: {
    socMinLimit: number | null;
    socMaxLimit: number | null;
    maxChargeCurrent: number | null;
    maxDischargeCurrent: number | null;
    gridImportLimitKw: number | null;
    slots: Array<{
      startMinute: number;
      endMinute: number;
      purpose: string;
      direction?: string;
      exportPolicy?: string;
    }>;
  } | null = null;

  if (setSuccessResult.rows.length > 0) {
    // Use the DomainSchedule we stored in payload_json at PUT time
    const row = setSuccessResult.rows[0] as Record<string, unknown>;
    const domain = row.payload_json as {
      socMinLimit: number; socMaxLimit: number;
      maxChargeCurrent: number; maxDischargeCurrent: number;
      gridImportLimitKw: number;
      slots: DomainSlot[];
    };
    batterySchedule = {
      socMinLimit: domain.socMinLimit,
      socMaxLimit: domain.socMaxLimit,
      maxChargeCurrent: domain.maxChargeCurrent,
      maxDischargeCurrent: domain.maxDischargeCurrent,
      gridImportLimitKw: domain.gridImportLimitKw,
      slots: domain.slots.map(domainSlotToResponse),
    };
  } else if (getReplyResult.rows.length > 0) {
    // Fallback: parse protocol format from get_reply
    const row = getReplyResult.rows[0] as Record<string, unknown>;
    const protocolData = row.payload_json as ProtocolSchedule | null;
    const domain = parseGetReply(protocolData);
    if (domain) {
      batterySchedule = {
        socMinLimit: domain.socMinLimit,
        socMaxLimit: domain.socMaxLimit,
        maxChargeCurrent: domain.maxChargeCurrent,
        maxDischargeCurrent: domain.maxDischargeCurrent,
        gridImportLimitKw: domain.gridImportLimitKw,
        slots: domain.slots.map(domainSlotToResponse),
      };
    }
  }

  // Determine sync status from latest set command
  let syncStatus = "unknown";
  let lastAckAt: string | null = null;

  if (setResult.rows.length > 0) {
    const setRow = setResult.rows[0] as Record<string, unknown>;
    const result = setRow.result as string;

    syncStatus = result === "success"
      ? "synced"
      : (result === "pending" || result === "dispatched")
        ? "pending"
        : result === "failed" || result === "timeout"
          ? "failed"
          : "unknown";

    lastAckAt = setRow.resolved_at
      ? new Date(setRow.resolved_at as string).toISOString()
      : null;
  }

  const body = ok({
    batterySchedule,
    syncStatus,
    lastAckAt,
  });

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

/** Map domain slot to frontend response format (purpose-based naming). */
function domainSlotToResponse(slot: DomainSlot): {
  startMinute: number;
  endMinute: number;
  purpose: string;
  direction?: string;
  exportPolicy?: string;
} {
  if (slot.mode === "self_consumption") {
    return { startMinute: slot.startMinute, endMinute: slot.endMinute, purpose: "self_consumption" };
  }
  if (slot.mode === "peak_shaving") {
    return { startMinute: slot.startMinute, endMinute: slot.endMinute, purpose: "peak_shaving" };
  }
  // peak_valley_arbitrage → tariff
  const result: {
    startMinute: number;
    endMinute: number;
    purpose: string;
    direction?: string;
    exportPolicy?: string;
  } = {
    startMinute: slot.startMinute,
    endMinute: slot.endMinute,
    purpose: "tariff",
    direction: slot.action ?? "charge",
  };
  if (slot.action === "discharge") {
    result.exportPolicy = slot.allowExport ? "allow" : "forbid";
  }
  return result;
}
