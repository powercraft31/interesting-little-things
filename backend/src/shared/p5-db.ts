// ---------------------------------------------------------------------------
// P5 Strategy Triggers — DB Helpers
// All queries use queryWithOrg for RLS-scoped access.
// ---------------------------------------------------------------------------

import { queryWithOrg } from "./db";
import type { StrategyIntent, PostureOverride, IntentStatus } from "./types/p5";

// queryWithOrg generic requires Record<string, unknown>; TS interfaces don't
// satisfy that constraint directly. These intersection types bridge the gap.
type IntentRow = StrategyIntent & Record<string, unknown>;
type OverrideRow = PostureOverride & Record<string, unknown>;

// ── Strategy Intents ────────────────────────────────────────────────────

const TERMINAL_STATUSES = `('expired','executed','suppressed')`;

export async function upsertIntent(
  orgId: string,
  intent: Omit<StrategyIntent, "id" | "created_at" | "updated_at">,
): Promise<StrategyIntent> {
  const sql = `
    WITH existing AS (
      SELECT id
      FROM strategy_intents
      WHERE org_id = $1
        AND family = $2
        AND status NOT IN ${TERMINAL_STATUSES}
        AND scope_gateway_ids = $9::jsonb
      ORDER BY created_at DESC
      LIMIT 1
    ), updated AS (
      UPDATE strategy_intents
      SET status             = $3,
          governance_mode    = $4,
          urgency            = $5,
          title              = $6,
          reason_summary     = $7,
          evidence_snapshot  = $8::jsonb,
          scope_gateway_ids  = $9::jsonb,
          scope_summary      = $10,
          constraints        = $11::jsonb,
          suggested_playbook = $12,
          handoff_snapshot   = $13::jsonb,
          arbitration_note   = $14,
          actor              = $15,
          decided_at         = $16,
          expires_at         = $17,
          updated_at         = NOW()
      WHERE id = (SELECT id FROM existing)
      RETURNING *
    ), inserted AS (
      INSERT INTO strategy_intents (
        org_id, family, status, governance_mode, urgency,
        title, reason_summary, evidence_snapshot,
        scope_gateway_ids, scope_summary, constraints,
        suggested_playbook, handoff_snapshot, arbitration_note,
        actor, decided_at, expires_at
      )
      SELECT
        $1, $2, $3, $4, $5,
        $6, $7, $8::jsonb,
        $9::jsonb, $10, $11::jsonb,
        $12, $13::jsonb, $14,
        $15, $16, $17
      WHERE NOT EXISTS (SELECT 1 FROM updated)
      RETURNING *
    )
    SELECT * FROM updated
    UNION ALL
    SELECT * FROM inserted
  `;

  const params = [
    intent.org_id,
    intent.family,
    intent.status,
    intent.governance_mode,
    intent.urgency,
    intent.title,
    intent.reason_summary,
    JSON.stringify(intent.evidence_snapshot),
    JSON.stringify(intent.scope_gateway_ids),
    intent.scope_summary,
    intent.constraints ? JSON.stringify(intent.constraints) : null,
    intent.suggested_playbook,
    intent.handoff_snapshot ? JSON.stringify(intent.handoff_snapshot) : null,
    intent.arbitration_note,
    intent.actor,
    intent.decided_at,
    intent.expires_at,
  ];

  const { rows } = await queryWithOrg<IntentRow>(sql, params, orgId);
  return rows[0];
}

export async function getActiveIntents(
  orgId: string,
): Promise<StrategyIntent[]> {
  const sql = `
    SELECT * FROM strategy_intents
    WHERE org_id = $1
      AND status NOT IN ${TERMINAL_STATUSES}
    ORDER BY
      CASE urgency
        WHEN 'immediate' THEN 1
        WHEN 'soon'      THEN 2
        WHEN 'watch'     THEN 3
      END,
      created_at DESC
  `;
  const { rows } = await queryWithOrg<IntentRow>(sql, [orgId], orgId);
  return rows;
}

export async function getIntentById(
  orgId: string,
  id: number,
): Promise<StrategyIntent | null> {
  const sql = `SELECT * FROM strategy_intents WHERE org_id = $1 AND id = $2`;
  const { rows } = await queryWithOrg<IntentRow>(sql, [orgId, id], orgId);
  return rows[0] ?? null;
}

export async function updateIntentStatus(
  orgId: string,
  id: number,
  status: IntentStatus,
  actor: string,
  reason?: string,
  deferUntil?: string,
  deferredBy?: string,
): Promise<StrategyIntent | null> {
  const sql = `
    UPDATE strategy_intents
    SET status         = $3,
        actor          = $4,
        arbitration_note = COALESCE($5, arbitration_note),
        decided_at     = NOW(),
        updated_at     = NOW(),
        defer_until    = $6,
        deferred_by    = $7
    WHERE org_id = $1 AND id = $2
    RETURNING *
  `;
  const { rows } = await queryWithOrg<IntentRow>(
    sql,
    [
      orgId,
      id,
      status,
      actor,
      reason ?? null,
      deferUntil ?? null,
      deferredBy ?? null,
    ],
    orgId,
  );
  return rows[0] ?? null;
}

export async function expireStaleIntents(orgId: string): Promise<number> {
  const sql = `
    UPDATE strategy_intents
    SET status     = 'expired',
        actor      = 'platform',
        decided_at = NOW(),
        updated_at = NOW()
    WHERE org_id = $1
      AND status NOT IN ${TERMINAL_STATUSES}
      AND expires_at IS NOT NULL
      AND expires_at < NOW()
  `;
  const { rows } = await queryWithOrg<{ id: number }>(
    sql + " RETURNING id",
    [orgId],
    orgId,
  );
  return rows.length;
}

// ── Posture Overrides ───────────────────────────────────────────────────

export async function createPostureOverride(
  orgId: string,
  override: Omit<
    PostureOverride,
    "id" | "created_at" | "cancelled_at" | "cancelled_by" | "active"
  >,
): Promise<PostureOverride> {
  const sql = `
    INSERT INTO posture_overrides (
      org_id, override_type, reason, scope_gateway_ids,
      actor, starts_at, expires_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *
  `;
  const params = [
    override.org_id,
    override.override_type,
    override.reason,
    JSON.stringify(override.scope_gateway_ids),
    override.actor,
    override.starts_at,
    override.expires_at,
  ];
  const { rows } = await queryWithOrg<OverrideRow>(sql, params, orgId);
  return rows[0];
}

export async function getActiveOverrides(
  orgId: string,
): Promise<PostureOverride[]> {
  const sql = `
    SELECT * FROM posture_overrides
    WHERE org_id = $1
      AND active = true
      AND expires_at > NOW()
    ORDER BY created_at DESC
  `;
  const { rows } = await queryWithOrg<OverrideRow>(sql, [orgId], orgId);
  return rows;
}

export async function cancelOverride(
  orgId: string,
  id: number,
  actor: string,
  reason?: string,
): Promise<PostureOverride | null> {
  const sql = `
    UPDATE posture_overrides
    SET active       = false,
        cancelled_at = NOW(),
        cancelled_by = $3,
        reason       = CASE WHEN $4::text IS NOT NULL
                         THEN reason || ' [cancelled: ' || $4 || ']'
                         ELSE reason
                       END
    WHERE org_id = $1 AND id = $2 AND active = true
    RETURNING *
  `;
  const { rows } = await queryWithOrg<OverrideRow>(
    sql,
    [orgId, id, actor, reason ?? null],
    orgId,
  );
  return rows[0] ?? null;
}
