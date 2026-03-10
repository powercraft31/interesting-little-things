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
 * PUT /api/devices/:assetId
 * EP-N4: Update device configuration (assets table).
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

  // Extract assetId from path: /api/devices/:assetId
  const pathParts = event.rawPath.split("/");
  const devicesIdx = pathParts.indexOf("devices");
  const assetId = devicesIdx >= 0 ? pathParts[devicesIdx + 1] : "";

  if (!assetId) {
    return apiError(400, "assetId is required");
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body ?? "{}");
  } catch {
    return apiError(400, "Invalid JSON body");
  }

  const { operationMode, allowExport, capacidadeKw, capacityKwh, socMin, socMax } = body as {
    operationMode?: string;
    allowExport?: boolean;
    capacidadeKw?: number;
    capacityKwh?: number;
    socMin?: number;
    socMax?: number;
  };

  // Validation
  const validModes = ["self_consumption", "peak_valley_arbitrage", "peak_shaving"];
  if (operationMode !== undefined && !validModes.includes(operationMode)) {
    return apiError(400, `Invalid operationMode. Must be one of: ${validModes.join(", ")}`);
  }
  if (capacidadeKw !== undefined && capacidadeKw <= 0) {
    return apiError(400, "capacidadeKw must be > 0");
  }
  if (capacityKwh !== undefined && capacityKwh <= 0) {
    return apiError(400, "capacityKwh must be > 0");
  }
  if (socMin !== undefined && (socMin < 0 || socMin > 100)) {
    return apiError(400, "socMin must be between 0 and 100");
  }
  if (socMax !== undefined && (socMax < 0 || socMax > 100)) {
    return apiError(400, "socMax must be between 0 and 100");
  }
  if (socMin !== undefined && socMax !== undefined && socMin >= socMax) {
    return apiError(400, "socMin must be less than socMax");
  }

  const result = await queryWithOrg(
    `UPDATE assets SET
       operation_mode = COALESCE($2, operation_mode),
       allow_export = COALESCE($3, allow_export),
       capacidade_kw = COALESCE($4, capacidade_kw),
       capacity_kwh = COALESCE($5, capacity_kwh),
       updated_at = NOW()
     WHERE asset_id = $1
     RETURNING asset_id`,
    [
      assetId,
      operationMode ?? null,
      allowExport ?? null,
      capacidadeKw ?? null,
      capacityKwh ?? null,
    ],
    rlsOrgId,
  );

  if (result.rows.length === 0) {
    return apiError(404, "Device not found");
  }

  const responseBody = ok({ assetId, updated: true });

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(responseBody),
  };
}
