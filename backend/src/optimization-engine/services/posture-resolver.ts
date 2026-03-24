// ---------------------------------------------------------------------------
// P5 Strategy Triggers — Posture Resolver
// ---------------------------------------------------------------------------
// Applies active posture overrides to strategy intents (in-memory only).
// Does NOT write back to DB — DB writes happen through explicit operator
// actions in Phase 3.
// ---------------------------------------------------------------------------

import { getActiveOverrides } from "../../shared/p5-db";
import type {
  StrategyIntent,
  PostureOverride,
  GovernanceMode,
  IntentStatus,
  StrategyFamily,
} from "../../shared/types/p5";

const ECONOMIC_FAMILIES: ReadonlySet<StrategyFamily> = new Set([
  "peak_shaving",
  "tariff_arbitrage",
]);

const PROTECTIVE_FAMILIES: ReadonlySet<StrategyFamily> = new Set([
  "reserve_protection",
]);

function scopeOverlaps(
  overrideScope: string[],
  intentScope: string[],
): boolean {
  // Empty override scope → applies to all intents
  if (overrideScope.length === 0) return true;
  return overrideScope.some((id) => intentScope.includes(id));
}

function applyOverride(
  intent: StrategyIntent,
  override: PostureOverride,
): StrategyIntent {
  switch (override.override_type) {
    case "force_protective": {
      // Non-protective intents → observe or suppressed
      if (PROTECTIVE_FAMILIES.has(intent.family)) return intent;
      return {
        ...intent,
        governance_mode: "observe" as GovernanceMode,
        arbitration_note: intent.arbitration_note
          ? `${intent.arbitration_note} | Override: force_protective applied`
          : "Override: force_protective applied — non-protective intent set to observe",
      };
    }

    case "suppress_economic": {
      if (!ECONOMIC_FAMILIES.has(intent.family)) return intent;
      return {
        ...intent,
        status: "suppressed" as IntentStatus,
        arbitration_note: intent.arbitration_note
          ? `${intent.arbitration_note} | Override: suppress_economic applied`
          : "Override: suppress_economic applied — economic intent suppressed",
      };
    }

    case "force_approval_gate": {
      if (intent.governance_mode !== "auto_governed") return intent;
      return {
        ...intent,
        governance_mode: "approval_required" as GovernanceMode,
        arbitration_note: intent.arbitration_note
          ? `${intent.arbitration_note} | Override: force_approval_gate applied`
          : "Override: force_approval_gate — auto_governed downgraded to approval_required",
      };
    }

    case "manual_escalation_note": {
      return {
        ...intent,
        arbitration_note: intent.arbitration_note
          ? `${intent.arbitration_note} | Manual escalation: ${override.reason}`
          : `Manual escalation note: ${override.reason}`,
      };
    }

    case "suppress_alerts": {
      // Alert suppression does not change posture or intent state
      return intent;
    }

    default:
      return intent;
  }
}

export async function resolvePosture(
  orgId: string,
  intents: StrategyIntent[],
): Promise<StrategyIntent[]> {
  const overrides = await getActiveOverrides(orgId);

  if (overrides.length === 0) return intents;

  let adjusted = [...intents];

  for (const override of overrides) {
    adjusted = adjusted.map((intent) => {
      if (
        !scopeOverlaps(override.scope_gateway_ids, intent.scope_gateway_ids)
      ) {
        return intent;
      }
      return applyOverride(intent, override);
    });
  }

  return adjusted;
}
