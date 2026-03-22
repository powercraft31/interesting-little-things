// ---------------------------------------------------------------------------
// P5 Strategy Triggers — Strategy Evaluator (M2 Brain)
// ---------------------------------------------------------------------------
// Reads evidence from upstream tables (device_state, gateways, assets,
// vpp_strategies, tariff_schedules) via getServicePool() (BYPASSRLS).
// Writes intents via p5-db helpers (queryWithOrg with RLS).
// ---------------------------------------------------------------------------

import { getServicePool } from "../../shared/db";
import {
  upsertIntent,
  expireStaleIntents,
  getActiveIntents,
} from "../../shared/p5-db";
import type {
  StrategyFamily,
  StrategyIntent,
  GovernanceMode,
  Urgency,
} from "../../shared/types/p5";

// ── Internal types (transient, not persisted) ─────────────────────────────

interface AssetEvidence {
  readonly asset_id: string;
  readonly battery_soc: number;
  readonly pv_power: number;
  readonly battery_power: number;
  readonly grid_power_kw: number;
  readonly load_power: number;
  readonly is_online: boolean;
  readonly telemetry_age_minutes: number;
  readonly capacidade_kw: number;
}

interface GatewayAggregate {
  readonly total_soc_avg: number;
  readonly total_grid_kw: number;
  readonly total_load_kw: number;
  readonly total_pv_kw: number;
  readonly online_asset_ratio: number;
  readonly max_telemetry_age: number;
}

interface GatewayEvidence {
  readonly gateway_id: string;
  readonly contracted_demand_kw: number | null;
  readonly assets: AssetEvidence[];
  readonly aggregate: GatewayAggregate;
}

interface TariffContext {
  readonly peak_start: string; // TIME as "HH:MM:SS"
  readonly peak_end: string;
  readonly peak_rate: number;
  readonly offpeak_rate: number;
}

interface VppStrategy {
  readonly min_soc: number;
  readonly max_soc: number;
  readonly target_mode: string;
  readonly is_active: boolean;
}

interface Condition {
  readonly family: StrategyFamily;
  readonly triggered: boolean;
  readonly urgency: Urgency;
  readonly title: string;
  readonly reason_summary: string;
  readonly scope_gateway_ids: string[];
  readonly evidence_snapshot: Record<string, unknown>;
  readonly constraints: Record<string, unknown> | null;
  readonly suggested_playbook: string | null;
  readonly confidence: number;
}

// ── Family baseline governance map (DESIGN 4.5) ──────────────────────────

const FAMILY_BASELINE: Record<StrategyFamily, GovernanceMode> = {
  reserve_protection: "auto_governed",
  peak_shaving: "approval_required",
  tariff_arbitrage: "approval_required",
  curtailment_mitigation: "observe",
  resilience_preparation: "observe",
  external_dr: "observe",
};

// ── Thresholds ────────────────────────────────────────────────────────────

const STALE_TELEMETRY_MINUTES = 15;
const LOW_CONFIDENCE_THRESHOLD = 0.5;
const LOW_ONLINE_RATIO = 0.5;
const PEAK_GRID_IMMEDIATE = 0.9;
const PEAK_GRID_SOON = 0.8;
const RESERVE_EMERGENCY_SOC = 15;
const RESERVE_WARNING_SOC = 30;
const TARIFF_CHARGE_SOC = 70;
const TARIFF_DISCHARGE_SOC = 60;
const PEAK_APPROACH_HOURS = 1;

// ── Step 1: Gather Evidence ──────────────────────────────────────────────

async function gatherEvidence(orgId: string): Promise<{
  gateways: GatewayEvidence[];
  tariff: TariffContext | null;
  vppStrategies: VppStrategy[];
}> {
  const pool = getServicePool();

  // Online gateways for this org
  const gwResult = await pool.query<{
    gateway_id: string;
    contracted_demand_kw: number | null;
  }>(
    `SELECT gateway_id, contracted_demand_kw
     FROM gateways
     WHERE org_id = $1 AND status = 'online'`,
    [orgId],
  );

  // Assets + device_state for this org's online gateways
  const gatewayEvidences: GatewayEvidence[] = [];

  for (const gw of gwResult.rows) {
    const assetResult = await pool.query<{
      asset_id: string;
      battery_soc: number;
      pv_power: number;
      battery_power: number;
      grid_power_kw: number;
      load_power: number;
      is_online: boolean;
      telemetry_age_minutes: number;
      capacidade_kw: number;
    }>(
      `SELECT
         a.asset_id,
         COALESCE(d.battery_soc, 0) AS battery_soc,
         COALESCE(d.pv_power, 0) AS pv_power,
         COALESCE(d.battery_power, 0) AS battery_power,
         COALESCE(d.grid_power_kw, 0) AS grid_power_kw,
         COALESCE(d.load_power, 0) AS load_power,
         COALESCE(d.is_online, false) AS is_online,
         COALESCE(EXTRACT(EPOCH FROM (NOW() - d.updated_at)) / 60, 999) AS telemetry_age_minutes,
         COALESCE(a.capacidade_kw, 0) AS capacidade_kw
       FROM assets a
       LEFT JOIN device_state d ON d.asset_id = a.asset_id
       WHERE a.gateway_id = $1 AND a.is_active = true`,
      [gw.gateway_id],
    );

    const assets: AssetEvidence[] = assetResult.rows.map((r) => ({
      asset_id: r.asset_id,
      battery_soc: Number(r.battery_soc),
      pv_power: Number(r.pv_power),
      battery_power: Number(r.battery_power),
      grid_power_kw: Number(r.grid_power_kw),
      load_power: Number(r.load_power),
      is_online: r.is_online,
      telemetry_age_minutes: Number(r.telemetry_age_minutes),
      capacidade_kw: Number(r.capacidade_kw),
    }));

    const aggregate = computeAggregate(assets);
    gatewayEvidences.push({
      gateway_id: gw.gateway_id,
      contracted_demand_kw: gw.contracted_demand_kw
        ? Number(gw.contracted_demand_kw)
        : null,
      assets,
      aggregate,
    });
  }

  // Tariff schedule (current effective)
  const tariffResult = await pool.query<TariffContext>(
    `SELECT peak_start, peak_end, peak_rate, offpeak_rate
     FROM tariff_schedules
     WHERE org_id = $1
       AND effective_from <= CURRENT_DATE
       AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
     ORDER BY effective_from DESC
     LIMIT 1`,
    [orgId],
  );
  const tariff = tariffResult.rows[0] ?? null;

  // VPP strategies (active)
  const stratResult = await pool.query<VppStrategy>(
    `SELECT min_soc, max_soc, target_mode, is_active
     FROM vpp_strategies
     WHERE org_id = $1 AND is_active = true`,
    [orgId],
  );

  return {
    gateways: gatewayEvidences,
    tariff,
    vppStrategies: stratResult.rows,
  };
}

function computeAggregate(assets: AssetEvidence[]): GatewayAggregate {
  if (assets.length === 0) {
    return {
      total_soc_avg: 0,
      total_grid_kw: 0,
      total_load_kw: 0,
      total_pv_kw: 0,
      online_asset_ratio: 0,
      max_telemetry_age: 999,
    };
  }

  const onlineCount = assets.filter((a) => a.is_online).length;
  return {
    total_soc_avg:
      assets.reduce((sum, a) => sum + a.battery_soc, 0) / assets.length,
    total_grid_kw: assets.reduce((sum, a) => sum + a.grid_power_kw, 0),
    total_load_kw: assets.reduce((sum, a) => sum + a.load_power, 0),
    total_pv_kw: assets.reduce((sum, a) => sum + a.pv_power, 0),
    online_asset_ratio: onlineCount / assets.length,
    max_telemetry_age: Math.max(...assets.map((a) => a.telemetry_age_minutes)),
  };
}

// ── Step 2: Evaluate Conditions ──────────────────────────────────────────

function evaluatePeakShaving(gateways: GatewayEvidence[]): Condition[] {
  const conditions: Condition[] = [];

  for (const gw of gateways) {
    if (gw.contracted_demand_kw === null) continue;

    const ratio = gw.aggregate.total_grid_kw / gw.contracted_demand_kw;
    if (ratio <= PEAK_GRID_SOON) continue;

    const urgency: Urgency = ratio > PEAK_GRID_IMMEDIATE ? "immediate" : "soon";
    conditions.push({
      family: "peak_shaving",
      triggered: true,
      urgency,
      title: `Peak demand risk at ${gw.gateway_id}`,
      reason_summary: `Grid import at ${Math.round(ratio * 100)}% of contracted demand (${gw.aggregate.total_grid_kw.toFixed(1)} / ${gw.contracted_demand_kw} kW)`,
      scope_gateway_ids: [gw.gateway_id],
      evidence_snapshot: {
        gateway_id: gw.gateway_id,
        grid_kw: gw.aggregate.total_grid_kw,
        contracted_demand_kw: gw.contracted_demand_kw,
        ratio,
      },
      constraints: {
        max_discharge_kw: gw.assets.reduce((s, a) => s + a.capacidade_kw, 0),
      },
      suggested_playbook: "Discharge batteries to reduce grid import",
      confidence:
        gw.aggregate.online_asset_ratio >= LOW_ONLINE_RATIO ? 0.85 : 0.4,
    });
  }

  return conditions;
}

function evaluateTariffArbitrage(
  gateways: GatewayEvidence[],
  tariff: TariffContext | null,
): Condition[] {
  if (!tariff) return [];

  const now = new Date();
  const currentHour = now.getHours();
  const currentMinutes = currentHour * 60 + now.getMinutes();

  const peakStartMinutes = parseTimeToMinutes(tariff.peak_start);
  const peakEndMinutes = parseTimeToMinutes(tariff.peak_end);

  const isOffPeak =
    currentMinutes < peakStartMinutes || currentMinutes >= peakEndMinutes;
  const minutesToPeak = peakStartMinutes - currentMinutes;
  const isPeakApproaching =
    minutesToPeak > 0 && minutesToPeak <= PEAK_APPROACH_HOURS * 60;
  const isPeak =
    currentMinutes >= peakStartMinutes && currentMinutes < peakEndMinutes;

  const conditions: Condition[] = [];

  for (const gw of gateways) {
    const avgSoc = gw.aggregate.total_soc_avg;

    // Off-peak + low SoC → charge opportunity
    if (isOffPeak && avgSoc < TARIFF_CHARGE_SOC) {
      conditions.push({
        family: "tariff_arbitrage",
        triggered: true,
        urgency: "soon",
        title: `Tariff arbitrage opportunity — charge`,
        reason_summary: `Off-peak window active, avg SoC ${avgSoc.toFixed(1)}% (< ${TARIFF_CHARGE_SOC}%). Charging at off-peak rate saves cost.`,
        scope_gateway_ids: [gw.gateway_id],
        evidence_snapshot: {
          gateway_id: gw.gateway_id,
          avg_soc: avgSoc,
          tariff_period: "off_peak",
          offpeak_rate: tariff.offpeak_rate,
          peak_rate: tariff.peak_rate,
        },
        constraints: null,
        suggested_playbook: "Charge during off-peak / Discharge during peak",
        confidence:
          gw.aggregate.online_asset_ratio >= LOW_ONLINE_RATIO ? 0.8 : 0.4,
      });
    }

    // Peak approaching + high enough SoC → discharge opportunity
    if ((isPeakApproaching || isPeak) && avgSoc > TARIFF_DISCHARGE_SOC) {
      conditions.push({
        family: "tariff_arbitrage",
        triggered: true,
        urgency: isPeakApproaching ? "immediate" : "soon",
        title: `Tariff arbitrage opportunity — discharge`,
        reason_summary: `Peak ${isPeakApproaching ? "starts within 1 hour" : "active"}, avg SoC ${avgSoc.toFixed(1)}% (> ${TARIFF_DISCHARGE_SOC}%). Discharging at peak rate is profitable.`,
        scope_gateway_ids: [gw.gateway_id],
        evidence_snapshot: {
          gateway_id: gw.gateway_id,
          avg_soc: avgSoc,
          tariff_period: isPeakApproaching ? "approaching_peak" : "peak",
          peak_rate: tariff.peak_rate,
          offpeak_rate: tariff.offpeak_rate,
        },
        constraints: null,
        suggested_playbook: "Charge during off-peak / Discharge during peak",
        confidence:
          gw.aggregate.online_asset_ratio >= LOW_ONLINE_RATIO ? 0.8 : 0.4,
      });
    }
  }

  return conditions;
}

function evaluateReserveProtection(gateways: GatewayEvidence[]): Condition[] {
  const conditions: Condition[] = [];

  for (const gw of gateways) {
    const avgSoc = gw.aggregate.total_soc_avg;
    if (avgSoc >= RESERVE_WARNING_SOC) continue;

    const urgency: Urgency =
      avgSoc < RESERVE_EMERGENCY_SOC ? "immediate" : "soon";
    conditions.push({
      family: "reserve_protection",
      triggered: true,
      urgency,
      title: `Low reserve warning — SoC ${avgSoc.toFixed(0)}%`,
      reason_summary: `Average SoC across ${gw.assets.length} assets is ${avgSoc.toFixed(1)}%, below ${RESERVE_WARNING_SOC}% threshold.`,
      scope_gateway_ids: [gw.gateway_id],
      evidence_snapshot: {
        gateway_id: gw.gateway_id,
        avg_soc: avgSoc,
        asset_count: gw.assets.length,
        online_ratio: gw.aggregate.online_asset_ratio,
      },
      constraints: { soc_floor: RESERVE_EMERGENCY_SOC },
      suggested_playbook: "Force charge to restore reserve",
      confidence:
        gw.aggregate.online_asset_ratio >= LOW_ONLINE_RATIO ? 0.9 : 0.4,
    });
  }

  return conditions;
}

function parseTimeToMinutes(time: string): number {
  const parts = time.split(":");
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

// ── Step 3: Qualify ──────────────────────────────────────────────────────

function qualifyConditions(
  conditions: Condition[],
  gateways: GatewayEvidence[],
): Condition[] {
  const gwMap = new Map(gateways.map((g) => [g.gateway_id, g]));

  return conditions.map((c) => {
    let confidence = c.confidence;

    // Freshness degradation
    const maxAge = Math.max(
      ...c.scope_gateway_ids.map(
        (id) => gwMap.get(id)?.aggregate.max_telemetry_age ?? 999,
      ),
    );
    if (maxAge > STALE_TELEMETRY_MINUTES) {
      confidence = Math.min(confidence, 0.4);
    }

    // Online ratio degradation
    const minOnlineRatio = Math.min(
      ...c.scope_gateway_ids.map(
        (id) => gwMap.get(id)?.aggregate.online_asset_ratio ?? 0,
      ),
    );
    if (minOnlineRatio < LOW_ONLINE_RATIO) {
      confidence = Math.min(confidence, 0.3);
    }

    return { ...c, confidence };
  });
}

// ── Step 4: Governance Mode Assignment ───────────────────────────────────

interface GovernedCondition extends Condition {
  readonly governance_mode: GovernanceMode;
}

function assignGovernance(
  conditions: Condition[],
  gateways: GatewayEvidence[],
  allConditions: Condition[],
): GovernedCondition[] {
  const gwMap = new Map(gateways.map((g) => [g.gateway_id, g]));

  // Detect scope collisions
  const scopeCollisions = detectScopeCollisions(allConditions);

  return conditions.map((c) => {
    let mode: GovernanceMode = FAMILY_BASELINE[c.family];

    const maxAge = Math.max(
      ...c.scope_gateway_ids.map(
        (id) => gwMap.get(id)?.aggregate.max_telemetry_age ?? 999,
      ),
    );

    // Demotion rules (safe — more oversight)
    if (maxAge > STALE_TELEMETRY_MINUTES) mode = "observe";
    if (c.confidence < LOW_CONFIDENCE_THRESHOLD) mode = "observe";
    if (scopeCollisions.has(conditionKey(c))) mode = "escalate";
    if (!c.suggested_playbook) mode = "observe";

    // Promotion rules
    if (c.family === "reserve_protection" && c.urgency === "immediate") {
      const avgSoc =
        c.scope_gateway_ids.reduce((sum, id) => {
          const gw = gwMap.get(id);
          return sum + (gw?.aggregate.total_soc_avg ?? 100);
        }, 0) / (c.scope_gateway_ids.length || 1);

      if (avgSoc < RESERVE_EMERGENCY_SOC) {
        mode = "auto_governed";
      }
    }

    return { ...c, governance_mode: mode };
  });
}

function conditionKey(c: Condition): string {
  return `${c.family}:${[...c.scope_gateway_ids].sort().join(",")}`;
}

function detectScopeCollisions(conditions: Condition[]): Set<string> {
  const collisions = new Set<string>();

  for (let i = 0; i < conditions.length; i++) {
    for (let j = i + 1; j < conditions.length; j++) {
      const a = conditions[i];
      const b = conditions[j];
      if (a.family === b.family) continue; // same family is handled by arbitration

      const overlap = a.scope_gateway_ids.some((id) =>
        b.scope_gateway_ids.includes(id),
      );
      if (!overlap) continue;

      // Only mark collision if both are actionable (not observe families)
      const aBaseline = FAMILY_BASELINE[a.family];
      const bBaseline = FAMILY_BASELINE[b.family];
      if (aBaseline === "observe" || bBaseline === "observe") continue;

      collisions.add(conditionKey(a));
      collisions.add(conditionKey(b));
    }
  }

  return collisions;
}

// ── Step 5: Arbitrate ────────────────────────────────────────────────────

interface ArbitratedIntent extends GovernedCondition {
  readonly arbitration_note: string | null;
  readonly status: "active" | "suppressed";
}

const FAMILY_PRIORITY: Record<StrategyFamily, number> = {
  reserve_protection: 1,
  peak_shaving: 2,
  tariff_arbitrage: 3,
  curtailment_mitigation: 4,
  resilience_preparation: 5,
  external_dr: 6,
};

const URGENCY_PRIORITY: Record<Urgency, number> = {
  immediate: 1,
  soon: 2,
  watch: 3,
};

function arbitrate(governed: GovernedCondition[]): ArbitratedIntent[] {
  // Group by overlapping gateway scope
  const results: ArbitratedIntent[] = governed.map((g) => ({
    ...g,
    arbitration_note: null,
    status: "active" as const,
  }));

  // For each pair, check scope overlap and apply dominance
  for (let i = 0; i < results.length; i++) {
    for (let j = i + 1; j < results.length; j++) {
      const a = results[i];
      const b = results[j];

      const overlap = a.scope_gateway_ids.some((id) =>
        b.scope_gateway_ids.includes(id),
      );
      if (!overlap) continue;

      // Same family, same scope, different directions → escalate both
      if (a.family === b.family) {
        results[i] = {
          ...a,
          governance_mode: "escalate",
          arbitration_note: `Scope collision with another ${a.family} intent`,
        };
        results[j] = {
          ...b,
          governance_mode: "escalate",
          arbitration_note: `Scope collision with another ${b.family} intent`,
        };
        continue;
      }

      // Protective > Economic
      const aPri = FAMILY_PRIORITY[a.family];
      const bPri = FAMILY_PRIORITY[b.family];

      if (aPri !== bPri) {
        const [winner, loser, , loseIdx] =
          aPri < bPri ? [a, b, i, j] : [b, a, j, i];
        results[loseIdx] = {
          ...loser,
          arbitration_note: `Dominated by ${winner.family} (protective > economic). Deferred.`,
        };
        continue;
      }

      // Same priority → higher urgency wins
      const aUrg = URGENCY_PRIORITY[a.urgency];
      const bUrg = URGENCY_PRIORITY[b.urgency];
      if (aUrg !== bUrg) {
        const [, loser, , loseIdx] = aUrg < bUrg ? [a, b, i, j] : [b, a, j, i];
        results[loseIdx] = {
          ...loser,
          arbitration_note: `Lower urgency than competing intent on same scope.`,
        };
      }
    }
  }

  return results;
}

// ── Step 6: Persist ──────────────────────────────────────────────────────

async function persistIntents(
  orgId: string,
  intents: ArbitratedIntent[],
): Promise<StrategyIntent[]> {
  // Expire stale intents first
  await expireStaleIntents(orgId);

  const results: StrategyIntent[] = [];

  for (const intent of intents) {
    const persisted = await upsertIntent(orgId, {
      org_id: orgId,
      family: intent.family,
      status: intent.status === "suppressed" ? "suppressed" : "active",
      governance_mode: intent.governance_mode,
      urgency: intent.urgency,
      title: intent.title,
      reason_summary: intent.reason_summary,
      evidence_snapshot: intent.evidence_snapshot,
      scope_gateway_ids: intent.scope_gateway_ids,
      scope_summary: `Gateways: ${intent.scope_gateway_ids.join(", ")}`,
      constraints: intent.constraints,
      suggested_playbook: intent.suggested_playbook,
      handoff_snapshot: null,
      arbitration_note: intent.arbitration_note,
      actor: "platform",
      decided_at: null,
      expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), // 2h TTL
    });
    results.push(persisted);
  }

  return results;
}

// ── Public API ────────────────────────────────────────────────────────────

export async function evaluateStrategies(
  orgId: string,
): Promise<StrategyIntent[]> {
  // Step 1: Gather evidence
  const {
    gateways,
    tariff,
    vppStrategies: _vppStrategies,
  } = await gatherEvidence(orgId);

  if (gateways.length === 0) {
    await expireStaleIntents(orgId);
    return getActiveIntents(orgId);
  }

  // Step 2: Evaluate conditions (per family)
  const rawConditions: Condition[] = [
    ...evaluatePeakShaving(gateways),
    ...evaluateTariffArbitrage(gateways, tariff),
    ...evaluateReserveProtection(gateways),
    // curtailment_mitigation, resilience_preparation, external_dr: not evaluated in v6.5
  ];

  if (rawConditions.length === 0) {
    await expireStaleIntents(orgId);
    return getActiveIntents(orgId);
  }

  // Step 3: Qualify
  const qualified = qualifyConditions(rawConditions, gateways);

  // Step 4: Governance mode assignment
  const governed = assignGovernance(
    qualified.filter((c) => c.triggered),
    gateways,
    qualified,
  );

  // Step 5: Arbitrate
  const arbitrated = arbitrate(governed);

  // Step 6: Persist
  const persisted = await persistIntents(orgId, arbitrated);
  return persisted;
}

// ── Exported for testing ─────────────────────────────────────────────────

export const _internal = {
  computeAggregate,
  evaluatePeakShaving,
  evaluateTariffArbitrage,
  evaluateReserveProtection,
  qualifyConditions,
  assignGovernance,
  arbitrate,
  parseTimeToMinutes,
  FAMILY_BASELINE,
  STALE_TELEMETRY_MINUTES,
};
