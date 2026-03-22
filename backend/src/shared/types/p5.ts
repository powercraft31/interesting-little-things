// ---------------------------------------------------------------------------
// P5 Strategy Triggers — Type Definitions
// ---------------------------------------------------------------------------

// ── Enums as union types ────────────────────────────────────────────────

export type StrategyFamily =
  | 'peak_shaving'
  | 'tariff_arbitrage'
  | 'reserve_protection'
  | 'curtailment_mitigation'
  | 'resilience_preparation'
  | 'external_dr';

export type IntentStatus =
  | 'active'
  | 'approved'
  | 'deferred'
  | 'suppressed'
  | 'escalated'
  | 'expired'
  | 'executed';

export type GovernanceMode =
  | 'observe'
  | 'approval_required'
  | 'auto_governed'
  | 'escalate';

export type Urgency = 'immediate' | 'soon' | 'watch';

export type OverrideType =
  | 'force_protective'
  | 'suppress_economic'
  | 'force_approval_gate'
  | 'manual_escalation_note';

export type Posture = 'calm' | 'approval_gated' | 'protective' | 'escalation';

export type CalmReason =
  | 'no_conditions_detected'
  | 'telemetry_stale'
  | 'override_suppressing'
  | 'protection_dominant'
  | 'all_deferred';

// ── DB row types ────────────────────────────────────────────────────────

export interface StrategyIntent {
  readonly id: number;
  readonly org_id: string;
  readonly family: StrategyFamily;
  readonly status: IntentStatus;
  readonly governance_mode: GovernanceMode;
  readonly urgency: Urgency;
  readonly title: string;
  readonly reason_summary: string;
  readonly evidence_snapshot: Record<string, unknown>;
  readonly scope_gateway_ids: string[];
  readonly scope_summary: string | null;
  readonly constraints: Record<string, unknown> | null;
  readonly suggested_playbook: string | null;
  readonly handoff_snapshot: Record<string, unknown> | null;
  readonly arbitration_note: string | null;
  readonly actor: string | null;
  readonly decided_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly expires_at: string | null;
}

export interface PostureOverride {
  readonly id: number;
  readonly org_id: string;
  readonly override_type: OverrideType;
  readonly reason: string;
  readonly scope_gateway_ids: string[];
  readonly actor: string;
  readonly active: boolean;
  readonly starts_at: string;
  readonly expires_at: string;
  readonly cancelled_at: string | null;
  readonly cancelled_by: string | null;
  readonly created_at: string;
}

// ── API response shapes ─────────────────────────────────────────────────

export interface IntentCard {
  readonly id: number;
  readonly family: StrategyFamily;
  readonly title: string;
  readonly urgency: Urgency;
  readonly governance_mode: GovernanceMode;
  readonly status: IntentStatus;
  readonly reason_summary: string;
  readonly scope_summary: string | null;
  readonly time_pressure: string;
  readonly created_at: string;
}

export interface NextPath {
  readonly if_approved: string;
  readonly if_deferred: string;
  readonly if_no_action: string;
  readonly suggested_playbook: string | null;
}

export interface IntentDetail extends IntentCard {
  readonly evidence_snapshot: Record<string, unknown>;
  readonly constraints: Record<string, unknown> | null;
  readonly next_path: NextPath;
  readonly arbitration_note: string | null;
  readonly handoff_snapshot: Record<string, unknown> | null;
  readonly available_actions: string[];
  readonly history: IntentEvent[];
}

export interface IntentEvent {
  readonly status: IntentStatus;
  readonly actor: string;
  readonly timestamp: string;
  readonly reason: string | null;
}

export interface CalmExplanation {
  readonly reason: CalmReason;
  readonly detail: string;
  readonly contributing_factors: string[];
}

export interface HeroPosture {
  readonly posture: Posture;
  readonly dominant_driver: string;
  readonly governance_mode: GovernanceMode;
  readonly governance_summary: string;
  readonly override_active: boolean;
  readonly conflict_active: boolean;
  readonly operator_action_needed: boolean;
}

export interface PostureSummary {
  readonly active_overrides: number;
  readonly dominant_override_type: OverrideType | null;
  readonly scope_description: string;
}

export interface ProtectorSummary {
  readonly family: StrategyFamily;
  readonly title: string;
  readonly scope_summary: string | null;
  readonly governance_mode: GovernanceMode;
}

export interface HandoffSummary {
  readonly intent_id: number;
  readonly family: StrategyFamily;
  readonly title: string;
  readonly escalated_at: string;
}

export interface P5Overview {
  readonly hero: HeroPosture;
  readonly calm_explanation: CalmExplanation | null;
  readonly need_decision_now: IntentCard[];
  readonly platform_acting: IntentCard[];
  readonly watch_next: IntentCard[];
  readonly context: {
    readonly operating_posture: PostureSummary;
    readonly dominant_protector: ProtectorSummary | null;
    readonly recent_handoffs: HandoffSummary[];
    readonly suppressed_count: number;
    readonly deferred_count: number;
  };
}
