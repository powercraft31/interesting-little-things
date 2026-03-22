// ---------------------------------------------------------------------------
// POST /api/p5/posture-override        — Create posture override
// POST /api/p5/posture-override/:id/cancel — Cancel posture override
// ---------------------------------------------------------------------------

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
import {
  createPostureOverride,
  cancelOverride,
} from "../../shared/p5-db";
import type { OverrideType } from "../../shared/types/p5";

const VALID_OVERRIDE_TYPES: OverrideType[] = [
  "force_protective",
  "suppress_economic",
  "force_approval_gate",
  "manual_escalation_note",
];

const MAX_DURATION_MINUTES = 480; // 8 hours

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
    return apiError(e.statusCode ?? 401, e.message ?? "Unauthorized");
  }

  try {
    const pathParts = event.rawPath.split("/");
    const isCancel = pathParts[pathParts.length - 1] === "cancel";

    if (isCancel) {
      return handleCancel(event, ctx);
    }
    return handleCreate(event, ctx);
  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error("[post-p5-posture-override] Error:", e);
    return apiError(500, e.message ?? "Internal server error");
  }
}

async function handleCreate(
  event: APIGatewayProxyEventV2,
  ctx: { userId: string; orgId: string },
): Promise<APIGatewayProxyResultV2> {
  let body: {
    override_type?: string;
    reason?: string;
    scope_gateway_ids?: string[];
    duration_minutes?: number;
  };
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    return apiError(400, "Invalid JSON body");
  }

  // Validate override_type
  if (
    !body.override_type ||
    !VALID_OVERRIDE_TYPES.includes(body.override_type as OverrideType)
  ) {
    return apiError(
      400,
      `override_type must be one of: ${VALID_OVERRIDE_TYPES.join(", ")}`,
    );
  }

  // Validate reason
  if (!body.reason || body.reason.trim().length === 0) {
    return apiError(400, "reason is required");
  }

  // Validate duration
  const duration = body.duration_minutes;
  if (
    duration === undefined ||
    duration === null ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > MAX_DURATION_MINUTES
  ) {
    return apiError(
      400,
      `duration_minutes must be between 1 and ${MAX_DURATION_MINUTES}`,
    );
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + duration * 60000);
  const actor = `operator:${ctx.userId}`;

  const override = await createPostureOverride(ctx.orgId, {
    org_id: ctx.orgId,
    override_type: body.override_type as OverrideType,
    reason: body.reason.trim(),
    scope_gateway_ids: body.scope_gateway_ids ?? [],
    actor,
    starts_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
  });

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(ok({ success: true, override })),
  };
}

async function handleCancel(
  event: APIGatewayProxyEventV2,
  ctx: { userId: string; orgId: string },
): Promise<APIGatewayProxyResultV2> {
  // Path: /api/p5/posture-override/:overrideId/cancel
  const pathParts = event.rawPath.split("/");
  const overrideIdStr = pathParts[pathParts.length - 2];
  const overrideId = parseInt(overrideIdStr, 10);

  if (isNaN(overrideId)) {
    return apiError(400, "Invalid override ID");
  }

  let body: { reason?: string } = {};
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    return apiError(400, "Invalid JSON body");
  }

  const actor = `operator:${ctx.userId}`;
  const override = await cancelOverride(
    ctx.orgId,
    overrideId,
    actor,
    body.reason,
  );

  if (!override) {
    return apiError(404, "Override not found or already cancelled");
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(ok({ success: true, override })),
  };
}
