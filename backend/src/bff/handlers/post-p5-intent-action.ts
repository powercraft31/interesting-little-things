// ---------------------------------------------------------------------------
// POST /api/p5/intents/:intentId/:action — Operator governance actions
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
import { getIntentById, updateIntentStatus } from "../../shared/p5-db";
import type { IntentStatus, StrategyIntent } from "../../shared/types/p5";

const VALID_ACTIONS = ["approve", "defer", "suppress", "escalate"] as const;
type ActionType = (typeof VALID_ACTIONS)[number];

const ACTION_TO_STATUS: Record<ActionType, IntentStatus> = {
  approve: "approved",
  defer: "deferred",
  suppress: "suppressed",
  escalate: "escalated",
};

function getAllowedActions(intent: StrategyIntent): string[] {
  const { status, governance_mode } = intent;

  // Deferred intents can be resumed (escalated back to active review)
  if (status === "deferred") {
    return ["escalate"];
  }

  if (status !== "active") return [];

  switch (governance_mode) {
    case "approval_required":
      return ["approve", "defer", "suppress", "escalate"];
    case "auto_governed":
      return ["defer", "suppress", "escalate"];
    case "observe":
      return ["defer", "suppress"];
    case "escalate":
      return ["defer", "escalate"];
    default:
      return [];
  }
}

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
    // Extract intentId and action from path: /api/p5/intents/:intentId/:action
    const pathParts = event.rawPath.split("/");
    const action = pathParts[pathParts.length - 1] as ActionType;
    const intentIdStr = pathParts[pathParts.length - 2];
    const intentId = parseInt(intentIdStr, 10);

    if (isNaN(intentId)) {
      return apiError(400, "Invalid intent ID");
    }

    if (!VALID_ACTIONS.includes(action)) {
      return apiError(
        400,
        `Invalid action: ${action}. Must be one of: ${VALID_ACTIONS.join(", ")}`,
      );
    }

    // Parse body
    let body: { reason?: string; defer_until?: string } = {};
    try {
      body = event.body ? JSON.parse(event.body) : {};
    } catch {
      return apiError(400, "Invalid JSON body");
    }

    // Load intent
    const intent = await getIntentById(ctx.orgId, intentId);
    if (!intent) {
      return apiError(404, "Intent not found");
    }

    // Validate action is allowed
    const allowed = getAllowedActions(intent);
    if (!allowed.includes(action)) {
      return apiError(
        400,
        `Action '${action}' is not allowed for intent in status '${intent.status}' with governance_mode '${intent.governance_mode}'`,
      );
    }

    // Suppress requires reason
    if (action === "suppress" && !body.reason) {
      return apiError(400, "Reason is required for suppress action");
    }

    // Defer requires valid future defer_until
    if (action === "defer") {
      if (!body.defer_until) {
        return apiError(400, "defer_until is required for defer action");
      }
      const deferUntil = new Date(body.defer_until);
      if (isNaN(deferUntil.getTime())) {
        return apiError(400, "defer_until must be a valid ISO 8601 timestamp");
      }
      if (deferUntil.getTime() <= Date.now()) {
        return apiError(400, "defer_until must be in the future");
      }
    }

    const actor = `operator:${ctx.userId}`;
    const newStatus = ACTION_TO_STATUS[action];

    const updated = await updateIntentStatus(
      ctx.orgId,
      intentId,
      newStatus,
      actor,
      body.reason,
      action === "defer" ? body.defer_until : undefined,
      action === "defer" ? actor : undefined,
    );

    if (!updated) {
      return apiError(500, "Failed to update intent status");
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        ok({
          success: true,
          intent: {
            id: updated.id,
            family: updated.family,
            title: updated.title,
            urgency: updated.urgency,
            governance_mode: updated.governance_mode,
            status: updated.status,
            reason_summary: updated.reason_summary,
            scope_summary: updated.scope_summary,
            time_pressure: "Updated",
            created_at: updated.created_at,
          },
        }),
      ),
    };
  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error("[post-p5-intent-action] Error:", e);
    return apiError(500, e.message ?? "Internal server error");
  }
}
