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

interface Metric {
  readonly name: string;
  readonly value: number | string | null;
  readonly unit: string;
  readonly target: number | string;
  readonly status: "pass" | "near" | "warn";
}

/**
 * GET /api/performance/scorecard
 * EP-14: Pilot acceptance scorecard — 14 metrics in 3 categories.
 * v5.14: Savings Alpha replaced by Actual Savings + Optimization Efficiency + Self-Sufficiency
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
      Role.ORG_VIEWER,
    ]);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    return apiError(e.statusCode ?? 500, e.message ?? "Error");
  }

  const rlsOrgId = ctx.orgId;

  const [
    uptimeResult,
    dispatchResult,
    offlineResult,
    costsResult,
    scResult,
    ssResult,
    commissionResult,
    manualResult,
  ] = await Promise.all([
    // 4-week uptime average
    queryWithOrg(
      `SELECT ROUND(AVG(uptime_pct), 1) AS avg_uptime
         FROM daily_uptime_snapshots
         WHERE date >= CURRENT_DATE - 28`,
      [],
      rlsOrgId,
    ),
    // Dispatch accuracy (last 7 days)
    queryWithOrg(
      `SELECT
           ROUND(100.0 * COUNT(*) FILTER (WHERE success = true) / NULLIF(COUNT(*), 0), 1) AS accuracy,
           ROUND(AVG(response_latency_ms) / 1000.0, 1) AS avg_latency_s
         FROM dispatch_records
         WHERE dispatched_at >= CURRENT_DATE - 7
           AND response_latency_ms IS NOT NULL`,
      [],
      rlsOrgId,
    ),
    // Offline resilience (backfill rate)
    queryWithOrg(
      `SELECT
           ROUND(100.0 * COUNT(*) FILTER (WHERE backfill = true) / NULLIF(COUNT(*), 0), 1) AS backfill_rate
         FROM offline_events`,
      [],
      rlsOrgId,
    ),
    // v5.14: Read pre-computed baseline/actual/bestTou from revenue_daily (last 30 days)
    queryWithOrg(
      `SELECT
           COALESCE(SUM(baseline_cost_reais), 0) AS total_baseline,
           COALESCE(SUM(actual_cost_reais), 0)   AS total_actual,
           COALESCE(SUM(best_tou_cost_reais), 0) AS total_best_tou
         FROM revenue_daily
         WHERE date >= CURRENT_DATE - 30
           AND baseline_cost_reais IS NOT NULL`,
      [],
      rlsOrgId,
    ),
    // Self-Consumption — latest 7-day average
    queryWithOrg(
      `SELECT ROUND(AVG(actual_self_consumption_pct), 1) AS avg_sc
         FROM revenue_daily
         WHERE date >= CURRENT_DATE - 7
           AND actual_self_consumption_pct IS NOT NULL`,
      [],
      rlsOrgId,
    ),
    // v5.14: Self-Sufficiency — latest 7-day average
    queryWithOrg(
      `SELECT ROUND(AVG(self_sufficiency_pct)::numeric, 1) AS avg_ss
         FROM revenue_daily
         WHERE date >= CURRENT_DATE - 7
           AND self_sufficiency_pct IS NOT NULL`,
      [],
      rlsOrgId,
    ),
    // Commissioning Time (avg minutes from commissioned_at to first telemetry)
    queryWithOrg(
      `SELECT ROUND(AVG(
         EXTRACT(EPOCH FROM (
           (SELECT MIN(recorded_at) FROM telemetry_history th WHERE th.asset_id = a.asset_id)
           - a.commissioned_at
         )) / 60
       ), 0) AS avg_commission_min
       FROM assets a
       WHERE a.is_active = true AND a.commissioned_at IS NOT NULL`,
      [],
      rlsOrgId,
    ),
    // Manual Interventions (last 7 days)
    queryWithOrg(
      `SELECT COUNT(*)::int AS manual_count
       FROM device_command_logs
       WHERE command_type = 'manual'
         AND created_at > NOW() - INTERVAL '7 days'`,
      [],
      rlsOrgId,
    ),
  ]);

  const uptimeRaw = (uptimeResult.rows[0] as Record<string, unknown>)
    ?.avg_uptime;
  const avgUptime = uptimeRaw != null ? parseFloat(String(uptimeRaw)) : null;
  const dispatchRow = dispatchResult.rows[0] as
    | Record<string, unknown>
    | undefined;
  const dispatchAccuracy = parseFloat(String(dispatchRow?.accuracy ?? 0));
  const backfillRate = parseFloat(
    String(
      (offlineResult.rows[0] as Record<string, unknown>)?.backfill_rate ?? 0,
    ),
  );

  // v5.14: Actual Savings % and Optimization Efficiency % from pre-computed columns
  const costsRow = costsResult.rows[0] as Record<string, unknown>;
  const totalBaseline = parseFloat(String(costsRow?.total_baseline ?? 0));
  const totalActual = parseFloat(String(costsRow?.total_actual ?? 0));
  const totalBestTou = parseFloat(String(costsRow?.total_best_tou ?? 0));

  const actualSavingsPct: number | null =
    totalBaseline > 0
      ? Math.round(((totalBaseline - totalActual) / totalBaseline) * 1000) / 10
      : null;

  const savingsGap = totalBaseline - totalBestTou;
  const optimizationEfficiency: number | null =
    savingsGap > 0
      ? Math.round(((totalBaseline - totalActual) / savingsGap) * 1000) / 10
      : null;

  // Self-consumption from query
  const scRow = scResult.rows[0] as Record<string, unknown>;
  const selfConsumptionPct =
    scRow?.avg_sc != null ? parseFloat(String(scRow.avg_sc)) : null;

  // v5.14: Self-Sufficiency from query
  const ssRow = ssResult.rows[0] as Record<string, unknown>;
  const selfSufficiencyPct =
    ssRow?.avg_ss != null ? parseFloat(String(ssRow.avg_ss)) : null;

  // Extract commissioning time and manual intervention count
  const commissionRow = commissionResult.rows[0] as
    | Record<string, unknown>
    | undefined;
  const commissioningTime =
    commissionRow?.avg_commission_min != null
      ? parseFloat(String(commissionRow.avg_commission_min))
      : null;

  const manualRow = manualResult.rows[0] as Record<string, unknown> | undefined;
  const manualInterventions = parseInt(
    String(manualRow?.manual_count ?? 0),
    10,
  );

  function evalStatus(
    value: number | null,
    target: number,
    nearThreshold: number,
  ): "pass" | "near" | "warn" {
    if (value === null) return "warn";
    if (value >= target) return "pass";
    if (value >= nearThreshold) return "near";
    return "warn";
  }

  const hardware: Metric[] = [
    {
      name: "Commissioning Time",
      value: commissioningTime,
      unit: "min",
      target: 60,
      status:
        commissioningTime != null
          ? commissioningTime <= 60
            ? "pass"
            : commissioningTime <= 90
              ? "near"
              : "warn"
          : "warn",
    },
    {
      name: "Offline Resilience",
      value: backfillRate,
      unit: "%",
      target: 80,
      status: evalStatus(backfillRate, 80, 60),
    },
    {
      name: "Uptime (4 weeks)",
      value: avgUptime,
      unit: "%",
      target: 95,
      status: evalStatus(avgUptime, 95, 90),
    },
    {
      name: "First Telemetry",
      value: null,
      unit: "min",
      target: 10,
      status: "warn",
    },
  ];

  const optimization: Metric[] = [
    {
      name: "Actual Savings",
      value: actualSavingsPct,
      unit: "%",
      target: ">60%",
      status: evalStatus(actualSavingsPct, 60, 40),
    },
    {
      name: "Optimization Efficiency",
      value: optimizationEfficiency,
      unit: "%",
      target: ">80%",
      status: evalStatus(optimizationEfficiency, 80, 60),
    },
    {
      name: "Self-Consumption",
      value: selfConsumptionPct,
      unit: "%",
      target: 80,
      status: evalStatus(selfConsumptionPct, 80, 60),
    },
    {
      name: "Self-Sufficiency",
      value: selfSufficiencyPct,
      unit: "%",
      target: ">50%",
      status: evalStatus(selfSufficiencyPct, 50, 30),
    },
    {
      name: "PV Forecast MAPE",
      value: null,
      unit: "%",
      target: 15,
      status: "warn",
    },
    {
      name: "Load Forecast Adapt",
      value: null,
      unit: "%",
      target: 85,
      status: "warn",
    },
  ];

  const operations: Metric[] = [
    {
      name: "Dispatch Accuracy",
      value: dispatchAccuracy,
      unit: "%",
      target: 95,
      status: evalStatus(dispatchAccuracy, 95, 85),
    },
    {
      name: "Training Time",
      value: null,
      unit: "h",
      target: 4,
      status: "warn",
    },
    {
      name: "Manual Interventions",
      value: manualInterventions,
      unit: "/semana",
      target: 2,
      status:
        manualInterventions <= 2
          ? "pass"
          : manualInterventions <= 4
            ? "near"
            : "warn",
    },
    {
      name: "App Uptime",
      value: null,
      unit: "%",
      target: 99.5,
      status: "warn",
    },
  ];

  const body = ok({
    hardware,
    optimization,
    operations,
    _tenant: { orgId: ctx.orgId, role: ctx.role },
  });

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
