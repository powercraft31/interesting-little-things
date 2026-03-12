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
  validateSchedule,
  type DomainSchedule,
  type DomainSlot,
} from "../../iot-hub/handlers/schedule-translator";

interface RequestBody {
  socMinLimit: number;
  socMaxLimit: number;
  maxChargeCurrent: number;
  maxDischargeCurrent: number;
  gridImportLimitKw: number;
  slots: Array<{
    startMinute: number;
    endMinute: number;
    purpose: string;
    direction?: string;
    exportPolicy?: string;
  }>;
}

/**
 * PUT /api/gateways/:gatewayId/schedule
 * Accept full DomainSchedule body, validate, store as pending command.
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

  // Extract gatewayId from path: /api/gateways/:gatewayId/schedule
  const pathParts = event.rawPath.split("/");
  const gwIdx = pathParts.indexOf("gateways");
  const gatewayId = gwIdx >= 0 ? pathParts[gwIdx + 1] : "";

  if (!gatewayId) {
    return apiError(400, "gatewayId is required");
  }

  let body: RequestBody;
  try {
    body = JSON.parse(event.body ?? "{}");
  } catch {
    return apiError(400, "Invalid JSON body");
  }

  if (!body.slots || !Array.isArray(body.slots) || body.slots.length === 0) {
    return apiError(400, "slots array is required and must not be empty");
  }

  // Map frontend purpose → domain mode
  let schedule: DomainSchedule;
  try {
    schedule = {
      socMinLimit: body.socMinLimit,
      socMaxLimit: body.socMaxLimit,
      maxChargeCurrent: body.maxChargeCurrent,
      maxDischargeCurrent: body.maxDischargeCurrent,
      gridImportLimitKw: body.gridImportLimitKw,
      slots: body.slots.map(
        (s): DomainSlot => ({
          mode: mapPurposeToMode(s.purpose),
          action:
            s.purpose === "tariff"
              ? (s.direction as "charge" | "discharge" | undefined)
              : undefined,
          allowExport:
            s.purpose === "tariff" && s.direction === "discharge"
              ? s.exportPolicy === "allow"
              : undefined,
          startMinute: s.startMinute,
          endMinute: s.endMinute,
        }),
      ),
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Invalid request body";
    return apiError(400, msg);
  }

  // Validate using schedule-translator's validateSchedule
  try {
    validateSchedule(schedule);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Validation error";
    return apiError(400, msg);
  }

  // Validate gateway exists
  const gwResult = await queryWithOrg(
    `SELECT 1 FROM gateways WHERE gateway_id = $1`,
    [gatewayId],
    rlsOrgId,
  );

  if (gwResult.rows.length === 0) {
    return apiError(404, "Gateway not found");
  }

  // Guard: reject if there's already an active command for this gateway
  // Use service pool (orgId=null) for cross-org visibility
  const activeCheck = await queryWithOrg(
    `SELECT id, result FROM device_command_logs
     WHERE gateway_id = $1 AND command_type = 'set' AND config_name = 'battery_schedule'
       AND result IN ('pending', 'dispatched', 'accepted')
     ORDER BY created_at DESC LIMIT 1`,
    [gatewayId],
    null,
  );

  if (activeCheck.rows.length > 0) {
    const active = activeCheck.rows[0];
    return {
      statusCode: 409,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        success: false,
        data: null,
        error: `Command already in progress (id=${active.id}, status=${active.result}). Wait for completion.`,
        timestamp: new Date().toISOString(),
      }),
    };
  }

  // Insert command log with full DomainSchedule as payload_json
  const insertResult = await queryWithOrg(
    `INSERT INTO device_command_logs (gateway_id, command_type, config_name, payload_json, result)
     VALUES ($1, 'set', 'battery_schedule', $2, 'pending')
     RETURNING id`,
    [gatewayId, JSON.stringify(schedule)],
    rlsOrgId,
  );

  const commandId = (insertResult.rows[0] as Record<string, unknown>).id;

  const responseBody = ok({
    commandId: Number(commandId),
    status: "pending",
    message: "Schedule submitted. Waiting for gateway confirmation.",
  });

  return {
    statusCode: 202,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(responseBody),
  };
}

function mapPurposeToMode(purpose: string): DomainSlot["mode"] {
  switch (purpose) {
    case "self_consumption":
      return "self_consumption";
    case "peak_shaving":
      return "peak_shaving";
    case "tariff":
      return "peak_valley_arbitrage";
    default:
      throw new Error(`Unknown purpose: ${purpose}`);
  }
}
