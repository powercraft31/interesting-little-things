// ---------------------------------------------------------------------------
// GET /api/p5/overview — P5 Strategy Triggers homepage read model
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
import { queryWithOrg } from "../../shared/db";
import { getActiveOverrides } from "../../shared/p5-db";
import { evaluateStrategies } from "../../optimization-engine/services/strategy-evaluator";
import { resolvePosture } from "../../optimization-engine/services/posture-resolver";
import type {
  StrategyIntent,
  IntentCard,
  P5Overview,
  HeroPosture,
  CalmExplanation,
  CalmReason,
  PostureSummary,
  ProtectorSummary,
  HandoffSummary,
  Posture,
  GovernanceMode,
} from "../../shared/types/p5";

// ── Governance mode restrictiveness (higher = more restrictive) ──────────
const MODE_RESTRICTIVENESS: Record<GovernanceMode, number> = {
  observe: 1,
  approval_required: 2,
  auto_governed: 3,
  escalate: 4,
};

function mostRestrictiveMode(intents: StrategyIntent[]): GovernanceMode {
  const activeIntents = intents.filter((i) => i.status === "active");
  if (activeIntents.length === 0) return "observe";
  return activeIntents.reduce<GovernanceMode>((best, i) => {
    return MODE_RESTRICTIVENESS[i.governance_mode] > MODE_RESTRICTIVENESS[best]
      ? i.governance_mode
      : best;
  }, "observe");
}

function intentToCard(intent: StrategyIntent): IntentCard {
  return {
    id: intent.id,
    family: intent.family,
    title: intent.title,
    urgency: intent.urgency,
    governance_mode: intent.governance_mode,
    status: intent.status,
    reason_summary: intent.reason_summary,
    scope_summary: intent.scope_summary,
    time_pressure: computeTimePressure(intent),
    created_at: intent.created_at,
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
    const orgId = ctx.orgId;

    // Step 2-3: Evaluate + resolve posture
    const rawIntents = await evaluateStrategies(orgId);
    const resolvedIntents = await resolvePosture(orgId, rawIntents);

    // Step 4: Active overrides
    const overrides = await getActiveOverrides(orgId);

    // Step 5: Suppressed/deferred counts (including terminal)
    const { rows: statusCounts } = await queryWithOrg<{
      status: string;
      count: string;
    }>(
      `SELECT status, COUNT(*)::text AS count FROM strategy_intents
       WHERE org_id = $1 AND status IN ('suppressed','deferred')
       GROUP BY status`,
      [orgId],
      orgId,
    );
    const suppressedCount = Number(
      statusCounts.find((r) => r.status === "suppressed")?.count ?? 0,
    );
    const deferredCount = Number(
      statusCounts.find((r) => r.status === "deferred")?.count ?? 0,
    );

    // Step 6: Partition into lanes
    const needDecisionNow = resolvedIntents.filter(
      (i) => i.governance_mode === "approval_required" && i.status === "active",
    );
    const platformActing = resolvedIntents.filter(
      (i) => i.governance_mode === "auto_governed" && i.status === "active",
    );
    const watchNext = resolvedIntents.filter(
      (i) =>
        (i.governance_mode === "observe" && i.status === "active") ||
        i.status === "deferred",
    );

    // Step 7: Hero posture
    const conflictActive = resolvedIntents.some(
      (i) => i.governance_mode === "escalate" && i.status === "active",
    );

    let posture: Posture;
    if (conflictActive) {
      posture = "escalation";
    } else if (needDecisionNow.length > 0) {
      posture = "approval_gated";
    } else if (platformActing.length > 0) {
      posture = "protective";
    } else {
      posture = "calm";
    }

    const activeIntents = resolvedIntents.filter((i) => i.status === "active");
    const highestUrgencyIntent = activeIntents.sort((a, b) => {
      const urgMap = { immediate: 0, soon: 1, watch: 2 };
      return (urgMap[a.urgency] ?? 3) - (urgMap[b.urgency] ?? 3);
    })[0];

    const governanceSummaryParts: string[] = [];
    if (needDecisionNow.length > 0) {
      governanceSummaryParts.push(
        `${needDecisionNow.length} intent${needDecisionNow.length > 1 ? "s" : ""} awaiting approval`,
      );
    }
    if (platformActing.length > 0) {
      governanceSummaryParts.push(`${platformActing.length} auto-governed`);
    }
    if (watchNext.length > 0) {
      governanceSummaryParts.push(`${watchNext.length} under observation`);
    }

    const hero: HeroPosture = {
      posture,
      dominant_driver: highestUrgencyIntent?.title ?? "No active conditions",
      governance_mode: mostRestrictiveMode(resolvedIntents),
      governance_summary:
        governanceSummaryParts.length > 0
          ? governanceSummaryParts.join(", ")
          : "No active strategy intents",
      override_active: overrides.length > 0,
      conflict_active: conflictActive,
      operator_action_needed: needDecisionNow.length > 0 || conflictActive,
    };

    // Step 8: Calm explanation
    let calmExplanation: CalmExplanation | null = null;
    if (needDecisionNow.length === 0 && platformActing.length === 0) {
      let reason: CalmReason;
      let detail: string;
      const factors: string[] = [];

      if (overrides.length > 0) {
        reason = "override_suppressing";
        detail = "Active posture override is suppressing strategy evaluation.";
        factors.push(`${overrides.length} active override(s)`);
      } else if (deferredCount > 0 && activeIntents.length === 0) {
        reason = "all_deferred";
        detail = "All strategy intents have been deferred by the operator.";
        factors.push(`${deferredCount} deferred intent(s)`);
      } else if (
        resolvedIntents.some(
          (i) =>
            i.evidence_snapshot &&
            (i.evidence_snapshot as Record<string, unknown>).telemetry_stale ===
              true,
        )
      ) {
        reason = "telemetry_stale";
        detail =
          "Telemetry data is stale; conditions cannot be reliably assessed.";
        factors.push("Stale telemetry data");
      } else {
        reason = "no_conditions_detected";
        detail = "No strategy-relevant conditions detected across the fleet.";
        factors.push("All gateways within normal operating parameters");
      }

      calmExplanation = { reason, detail, contributing_factors: factors };
    }

    // Step 9: Context rail
    const dominantProtector = resolvedIntents.find(
      (i) => i.family === "reserve_protection" && i.status === "active",
    );

    const recentHandoffs: HandoffSummary[] = resolvedIntents
      .filter((i) => {
        if (i.status !== "escalated") return false;
        const updatedMs = new Date(i.updated_at).getTime();
        return Date.now() - updatedMs < 24 * 60 * 60 * 1000;
      })
      .map((i) => ({
        intent_id: i.id,
        family: i.family,
        title: i.title,
        escalated_at: i.updated_at,
      }));

    const operatingPosture: PostureSummary = {
      active_overrides: overrides.length,
      dominant_override_type:
        overrides.length > 0 ? overrides[0].override_type : null,
      scope_description:
        overrides.length > 0
          ? overrides[0].scope_gateway_ids.length > 0
            ? `Scoped to ${overrides[0].scope_gateway_ids.length} gateway(s)`
            : "Fleet-wide"
          : "No overrides active",
    };

    const dominantProtectorSummary: ProtectorSummary | null = dominantProtector
      ? {
          family: dominantProtector.family,
          title: dominantProtector.title,
          scope_summary: dominantProtector.scope_summary,
          governance_mode: dominantProtector.governance_mode,
        }
      : null;

    // Step 10-11: Build response
    const overview: P5Overview = {
      hero,
      calm_explanation: calmExplanation,
      need_decision_now: needDecisionNow.map(intentToCard),
      platform_acting: platformActing.map(intentToCard),
      watch_next: watchNext.map(intentToCard),
      context: {
        operating_posture: operatingPosture,
        dominant_protector: dominantProtectorSummary,
        recent_handoffs: recentHandoffs,
        suppressed_count: suppressedCount,
        deferred_count: deferredCount,
      },
    };

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ok(overview)),
    };
  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error("[get-p5-overview] Error:", e);
    return apiError(500, e.message ?? "Internal server error");
  }
}
