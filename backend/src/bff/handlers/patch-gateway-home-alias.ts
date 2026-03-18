import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { Role } from "../../shared/types/auth";
import {
  extractTenantContext,
  requireRole,
  apiError,
} from "../middleware/auth";
import { queryWithOrg } from "../../shared/db";

/**
 * PATCH /api/gateways/:gatewayId/home-alias
 * Allows operators to set a human-readable Home alias for a gateway.
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

  const rlsOrgId = ctx.orgId;

  // Extract gatewayId from path: /api/gateways/:gatewayId/home-alias
  const pathParts = event.rawPath.split("/");
  const gwIdx = pathParts.indexOf("gateways");
  const gatewayId = gwIdx >= 0 ? pathParts[gwIdx + 1] : "";

  if (!gatewayId) {
    return apiError(400, "gatewayId is required");
  }

  let body: { homeAlias?: string };
  try {
    body = JSON.parse(event.body ?? "{}");
  } catch {
    return apiError(400, "Invalid JSON body");
  }

  if (typeof body.homeAlias !== "string") {
    return apiError(400, "homeAlias must be a string");
  }

  const trimmed = body.homeAlias.trim();
  if (trimmed.length === 0) {
    return apiError(400, "homeAlias must not be empty");
  }
  if (trimmed.length > 100) {
    return apiError(400, "homeAlias must not exceed 100 characters");
  }

  // Verify gateway exists under this org
  const gwCheck = await queryWithOrg(
    `SELECT 1 FROM gateways WHERE gateway_id = $1`,
    [gatewayId],
    rlsOrgId,
  );

  if (gwCheck.rows.length === 0) {
    return apiError(404, "Gateway not found");
  }

  await queryWithOrg(
    `UPDATE gateways SET home_alias = $1, updated_at = now() WHERE gateway_id = $2`,
    [trimmed, gatewayId],
    rlsOrgId,
  );

  return {
    statusCode: 204,
    headers: { "Content-Type": "application/json" },
    body: "",
  };
}
