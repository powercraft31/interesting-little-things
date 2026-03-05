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
 * POST /api/hems/dispatch
 * EP-10: Batch mode dispatch — create dispatch_commands for filtered assets.
 * Min role: ORG_OPERATOR
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
    ]);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    return apiError(e.statusCode ?? 500, e.message ?? "Error");
  }

  const isAdmin = ctx.role === Role.SOLFACIL_ADMIN;
  const rlsOrgId = isAdmin ? null : ctx.orgId;

  let bodyParsed: {
    targetMode?: string;
    filters?: { homeId?: string; deviceType?: string };
  };
  try {
    bodyParsed = JSON.parse(event.body ?? "{}");
  } catch {
    return apiError(400, "Invalid JSON body");
  }

  const targetMode = bodyParsed.targetMode;
  if (!targetMode) {
    return apiError(400, "targetMode is required");
  }

  const validModes = ["self_consumption", "peak_valley_arbitrage", "peak_shaving"];
  if (!validModes.includes(targetMode)) {
    return apiError(400, `targetMode must be one of: ${validModes.join(", ")}`);
  }

  // Find matching assets
  const homeFilter = bodyParsed.filters?.homeId ?? null;
  const typeFilter = bodyParsed.filters?.deviceType ?? null;

  const { rows: matchingAssets } = await queryWithOrg(
    `SELECT a.asset_id, a.org_id
     FROM assets a
     WHERE a.is_active = true
       AND ($1::VARCHAR IS NULL OR a.home_id = $1)
       AND ($2::VARCHAR IS NULL OR a.asset_type = $2)`,
    [homeFilter, typeFilter],
    rlsOrgId,
  );

  if (matchingAssets.length === 0) {
    return apiError(404, "No matching assets found");
  }

  // Create dispatch commands for each asset
  const dispatchId = `batch-${Date.now()}`;
  for (const asset of matchingAssets) {
    const a = asset as Record<string, unknown>;
    await queryWithOrg(
      `INSERT INTO dispatch_commands (asset_id, org_id, action, status, dispatched_at)
       VALUES ($1, $2, $3, 'dispatched', NOW())`,
      [a.asset_id, a.org_id, targetMode],
      rlsOrgId,
    );
  }

  const body = ok({
    dispatchId,
    targetMode,
    affectedDevices: matchingAssets.length,
    _tenant: { orgId: ctx.orgId, role: ctx.role },
  });

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
