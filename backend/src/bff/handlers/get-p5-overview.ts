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
import { getActiveOverrides, getActiveIntents } from "../../shared/p5-db";
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

// ── Worsening-detection constants (DESIGN §11.4) ────────────────────────
const RESERVE_EMERGENCY_SOC = 15; // % — absolute emergency threshold
const SOC_WORSENING_DELTA = 10; // percentage points drop from defer-time
const DEMAND_IMMEDIATE_THRESHOLD = 90; // % — grid demand ratio "immediate" level

// ── Case fingerprint (read-time grouping, not stored in DB) ─────────────
function computeCaseFingerprint(intent: StrategyIntent): string {
  const scopeIds = Array.isArray(intent.scope_gateway_ids)
    ? [...intent.scope_gateway_ids].sort().join(",")
    : "";
  let driverType: string = intent.family;
  if (intent.family === "reserve_protection") {
    const soc = (intent.evidence_snapshot as Record<string, unknown>)?.avg_soc;
    if (typeof soc === "number" && soc < 15)
      driverType = "reserve_protection:emergency";
    else driverType = "reserve_protection:low_soc";
  }
  return `${intent.family}:${scopeIds}:${driverType}`;
}

// ── Material worsening detection (DESIGN §11.4) ─────────────────────────
/**
 * Detect if conditions have materially worsened since the deferral was created.
 * Compares evidence snapshots between the deferred intent and the newest active intent
 * in the same fingerprint group.
 *
 * Returns true if worsening detected → defer should be broken.
 * Returns false if no worsening → defer should be honored.
 */
function detectMaterialWorsening(
  deferredIntent: StrategyIntent,
  newestIntent: StrategyIntent,
): boolean {
  const deferSnap = deferredIntent.evidence_snapshot as Record<
    string,
    unknown
  > | null;
  const newSnap = newestIntent.evidence_snapshot as Record<
    string,
    unknown
  > | null;
  if (!deferSnap || !newSnap) return false;

  // Reserve protection: SoC-based worsening
  if (newestIntent.family === "reserve_protection") {
    const deferSoc =
      typeof deferSnap.avg_soc === "number" ? deferSnap.avg_soc : null;
    const newSoc = typeof newSnap.avg_soc === "number" ? newSnap.avg_soc : null;

    if (newSoc !== null) {
      // Absolute emergency: SoC below 15%
      if (newSoc < RESERVE_EMERGENCY_SOC) return true;

      // Relative worsening: SoC dropped ≥ 10pp from defer time
      if (deferSoc !== null && deferSoc - newSoc >= SOC_WORSENING_DELTA)
        return true;
    }
  }

  // Peak shaving: demand ratio crossing from soon to immediate
  if (newestIntent.family === "peak_shaving") {
    const deferRatio =
      typeof deferSnap.demand_ratio === "number"
        ? deferSnap.demand_ratio
        : null;
    const newRatio =
      typeof newSnap.demand_ratio === "number" ? newSnap.demand_ratio : null;

    if (deferRatio !== null && newRatio !== null) {
      // Was at "soon" level (< 90%), now at "immediate" level (≥ 90%)
      if (
        deferRatio < DEMAND_IMMEDIATE_THRESHOLD &&
        newRatio >= DEMAND_IMMEDIATE_THRESHOLD
      )
        return true;
    }
  }

  return false;
}

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
    recovery_condition: null,
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

    // Step 3a: Merge deferred intents from DB (evaluator creates fresh rows,
    // so operator-deferred intents are only in the DB, not in resolvedIntents)
    const dbIntents = await getActiveIntents(orgId);
    const resolvedIds = new Set(resolvedIntents.map((i) => i.id));
    const deferredFromDb = dbIntents.filter(
      (i) => i.status === "deferred" && !resolvedIds.has(i.id),
    );
    const allIntents = [...resolvedIntents, ...deferredFromDb];

    // --- Step 3b: Defer-aware case grouping ---
    const now = new Date();
    const deferredCaseIntentIds = new Set<number>();
    let activeDeferContext: {
      case_fingerprint: string;
      deferred_intent_id: number;
      defer_until: string;
      deferred_by: string | null;
      deferred_at: string | null;
    } | null = null;

    const fingerprintGroups = new Map<string, StrategyIntent[]>();
    // Base fingerprint index (family:scopeIds without driver subtype) for
    // cross-group worsening lookup — needed because SoC-based fingerprint
    // subdivision puts emergency vs low_soc intents in different groups.
    const baseFpIndex = new Map<string, StrategyIntent[]>();
    for (const intent of allIntents) {
      const fp = computeCaseFingerprint(intent);
      if (!fingerprintGroups.has(fp)) fingerprintGroups.set(fp, []);
      fingerprintGroups.get(fp)!.push(intent);

      const scopeIds = Array.isArray(intent.scope_gateway_ids)
        ? [...intent.scope_gateway_ids].sort().join(",")
        : "";
      const baseFp = `${intent.family}:${scopeIds}`;
      if (!baseFpIndex.has(baseFp)) baseFpIndex.set(baseFp, []);
      baseFpIndex.get(baseFp)!.push(intent);
    }

    for (const [fp, group] of fingerprintGroups) {
      const activeDefer = group.find(
        (i) =>
          i.status === "deferred" &&
          i.defer_until &&
          new Date(i.defer_until) > now,
      );
      if (activeDefer) {
        // Check for material worsening: find the newest active intent across
        // all sibling groups (same family+scope) to handle SoC-based
        // fingerprint subdivision where worsening crosses group boundaries.
        const scopeIds = Array.isArray(activeDefer.scope_gateway_ids)
          ? [...activeDefer.scope_gateway_ids].sort().join(",")
          : "";
        const baseFp = `${activeDefer.family}:${scopeIds}`;
        const siblingIntents = baseFpIndex.get(baseFp) ?? [];
        const newestActive = siblingIntents
          .filter((i) => i.status === "active")
          .sort(
            (a, b) =>
              new Date(b.created_at).getTime() -
              new Date(a.created_at).getTime(),
          )[0];

        // If worsening detected, skip defer suppression for this group
        if (
          newestActive &&
          detectMaterialWorsening(activeDefer, newestActive)
        ) {
          continue;
        }

        // No worsening — honor the defer
        for (const i of group) {
          deferredCaseIntentIds.add(i.id);
        }
        if (!activeDeferContext) {
          activeDeferContext = {
            case_fingerprint: fp,
            deferred_intent_id: activeDefer.id,
            defer_until: activeDefer.defer_until!,
            deferred_by: activeDefer.deferred_by,
            deferred_at: activeDefer.decided_at,
          };
        }
      }
    }
    // --- end Step 3b ---

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
    const needDecisionNow = allIntents.filter(
      (i) =>
        i.status === "active" &&
        (i.governance_mode === "approval_required" ||
          i.governance_mode === "escalate") &&
        !deferredCaseIntentIds.has(i.id),
    );
    const platformActing = allIntents.filter(
      (i) => i.governance_mode === "auto_governed" && i.status === "active",
    );
    const watchNext = allIntents.filter(
      (i) =>
        (i.governance_mode === "observe" && i.status === "active") ||
        i.status === "deferred" ||
        (i.status === "active" && deferredCaseIntentIds.has(i.id)),
    );

    // Step 7: Hero posture
    const conflictActive = allIntents.some(
      (i) =>
        i.governance_mode === "escalate" &&
        i.status === "active" &&
        !deferredCaseIntentIds.has(i.id),
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

    const activeIntents = allIntents.filter(
      (i) => i.status === "active" && !deferredCaseIntentIds.has(i.id),
    );
    const highestUrgencyIntent = [...activeIntents].sort((a, b) => {
      const urgMap = { immediate: 0, soon: 1, watch: 2 };
      return (urgMap[a.urgency] ?? 3) - (urgMap[b.urgency] ?? 3);
    })[0];

    const escalateActive = allIntents.filter(
      (i) =>
        i.governance_mode === "escalate" &&
        i.status === "active" &&
        !deferredCaseIntentIds.has(i.id),
    );

    const governanceSummaryParts: string[] = [];
    if (escalateActive.length > 0) {
      governanceSummaryParts.push(
        `${escalateActive.length} intent${escalateActive.length > 1 ? "s" : ""} requiring operator arbitration`,
      );
    }
    if (needDecisionNow.length - escalateActive.length > 0) {
      const approvalCount = needDecisionNow.length - escalateActive.length;
      governanceSummaryParts.push(
        `${approvalCount} intent${approvalCount > 1 ? "s" : ""} awaiting approval`,
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
      governance_mode: mostRestrictiveMode(
        allIntents.filter((i) => !deferredCaseIntentIds.has(i.id)),
      ),
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
    if (posture === "calm") {
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
        allIntents.some(
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
    const dominantProtector = allIntents.find(
      (i) => i.family === "reserve_protection" && i.status === "active",
    );

    const recentHandoffs: HandoffSummary[] = allIntents
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
          current_soc:
            typeof (
              dominantProtector.evidence_snapshot as Record<string, unknown>
            )?.avg_soc === "number"
              ? ((
                  dominantProtector.evidence_snapshot as Record<string, unknown>
                ).avg_soc as number)
              : null,
          threshold:
            typeof (
              dominantProtector.evidence_snapshot as Record<string, unknown>
            )?.threshold === "number"
              ? ((
                  dominantProtector.evidence_snapshot as Record<string, unknown>
                ).threshold as number)
              : null,
        }
      : null;

    // Step 10-11: Build response
    const overview: P5Overview = {
      hero,
      calm_explanation: calmExplanation,
      need_decision_now: needDecisionNow.map(intentToCard),
      platform_acting: platformActing.map(intentToCard),
      watch_next: watchNext.map(intentToCard),
      defer_context: activeDeferContext,
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
