// ---------------------------------------------------------------------------
// GET /api/p5/intents/:intentId — Single intent detail
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
import { getIntentById } from "../../shared/p5-db";
import type {
  StrategyIntent,
  IntentDetail,
  NextPath,
  IntentEvent,
} from "../../shared/types/p5";

const RESERVE_WARNING_SOC = 30;

function computeRecoveryCondition(intent: StrategyIntent): string | null {
  const evidence = intent.evidence_snapshot;

  if (intent.family === "reserve_protection" && evidence?.avg_soc != null) {
    return `SoC > ${RESERVE_WARNING_SOC}%`;
  }

  if (
    intent.family === "peak_shaving" &&
    evidence?.contracted_demand_kw != null
  ) {
    return "Demanda < contratada";
  }

  if (
    intent.status === "deferred" &&
    intent.arbitration_note?.includes("reserve_protection")
  ) {
    return `SoC > ${RESERVE_WARNING_SOC}%`;
  }

  return null;
}

function computeAvailableActions(intent: StrategyIntent): string[] {
  const { status, governance_mode } = intent;

  if (status !== "active") return [];

  switch (governance_mode) {
    case "approval_required":
      return ["approve", "defer", "suppress", "escalate"];
    case "auto_governed":
      return ["defer", "suppress", "escalate"];
    case "observe":
      return ["defer", "suppress"];
    case "escalate":
      return ["escalate"];
    default:
      return [];
  }
}

function buildNextPath(intent: StrategyIntent): NextPath {
  const familyDispatchMap: Record<string, string> = {
    peak_shaving: "Dispatch peak shaving to",
    tariff_arbitrage: "Dispatch tariff arbitrage to",
    reserve_protection: "Dispatch reserve protection to",
    curtailment_mitigation: "Dispatch curtailment mitigation to",
    resilience_preparation: "Dispatch resilience preparation to",
    external_dr: "Dispatch external DR to",
  };

  const scope = intent.scope_summary ?? "target scope";
  const dispatchDesc = familyDispatchMap[intent.family] ?? "Dispatch to";

  let ifNoAction = "Intent will remain active until expiry";
  if (intent.expires_at) {
    const expiresMs = new Date(intent.expires_at).getTime();
    const remainMin = Math.round((expiresMs - Date.now()) / 60000);
    if (remainMin > 0) {
      ifNoAction = `Intent expires in ${remainMin < 60 ? `${remainMin} min` : `${Math.round(remainMin / 60)}h`}; no action taken on expiry`;
    } else {
      ifNoAction = "Intent has expired; no further action possible";
    }
  }

  return {
    if_approved: `${dispatchDesc} ${scope}`,
    if_deferred: "Intent remains in watch_next, re-evaluated on next cycle",
    if_no_action: ifNoAction,
    suggested_playbook: intent.suggested_playbook,
  };
}

function computeTimePressure(intent: StrategyIntent): string {
  const createdMs = new Date(intent.created_at).getTime();
  const nowMs = Date.now();
  const ageMinutes = Math.round((nowMs - createdMs) / 60000);

  if (intent.expires_at) {
    const expiresMs = new Date(intent.expires_at).getTime();
    const remainMinutes = Math.round((expiresMs - nowMs) / 60000);
    if (remainMinutes <= 0) return "Expired";
    if (remainMinutes < 60) return `Expires in ${remainMinutes} min`;
    return `Expires in ${Math.round(remainMinutes / 60)}h`;
  }

  if (ageMinutes < 1) return "Created just now";
  if (ageMinutes < 60) return `Created ${ageMinutes} min ago`;
  return `Created ${Math.round(ageMinutes / 60)}h ago`;
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
    // Extract intentId from path: /api/p5/intents/:intentId
    const pathParts = event.rawPath.split("/");
    const intentIdStr = pathParts[pathParts.length - 1];
    const intentId = parseInt(intentIdStr, 10);

    if (isNaN(intentId)) {
      return apiError(400, "Invalid intent ID");
    }

    const intent = await getIntentById(ctx.orgId, intentId);
    if (!intent) {
      return apiError(404, "Intent not found");
    }

    // Build history (v6.5: single event from current state)
    const history: IntentEvent[] = [
      {
        status: intent.status,
        actor: intent.actor ?? "platform",
        timestamp: intent.decided_at ?? intent.created_at,
        reason: intent.arbitration_note,
      },
    ];

    const detail: IntentDetail = {
      id: intent.id,
      family: intent.family,
      title: intent.title,
      urgency: intent.urgency,
      governance_mode: intent.governance_mode,
      status: intent.status,
      reason_summary: intent.reason_summary,
      scope_summary: intent.scope_summary,
      time_pressure: computeTimePressure(intent),
      recovery_condition: computeRecoveryCondition(intent),
      created_at: intent.created_at,
      evidence_snapshot: intent.evidence_snapshot,
      constraints: intent.constraints,
      next_path: buildNextPath(intent),
      arbitration_note: intent.arbitration_note,
      handoff_snapshot: intent.handoff_snapshot,
      available_actions: computeAvailableActions(intent),
      history,
    };

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ok(detail)),
    };
  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error("[get-p5-intent-detail] Error:", e);
    return apiError(500, e.message ?? "Internal server error");
  }
}
