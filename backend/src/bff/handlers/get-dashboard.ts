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

/**
 * GET /dashboard
 * v5.13: VPP Dashboard KPIs
 * - Revenue KPIs switched to Tarifa Branca client_savings
 * - Self-consumption from revenue_daily.actual_self_consumption_pct
 * - Gateway uptime from daily_uptime_snapshots (de-hardcoded)
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
    assetResult,
    revenueResult,
    selfConsumptionResult,
    dispatchResult,
    monthlyResult,
    deltaResult,
    accuracyLatencyResult,
    uptimeResult,
    selfSufficiencyResult,
    selfSufficiencyDeltaResult,
  ] = await Promise.all([
    // Query 1: Asset aggregation (assets JOIN device_state)
    queryWithOrg(
      `SELECT
         COUNT(a.asset_id)::int                                      AS total_assets,
         COUNT(d.is_online) FILTER (WHERE d.is_online = true)::int   AS online_assets,
         COALESCE(AVG(d.battery_soc), 0)                             AS avg_soc,
         COALESCE(SUM(d.load_power), 0)                              AS total_load_kw,
         COALESCE(SUM(d.pv_power), 0)                                AS total_pv_kw,
         ROUND(100.0 * COUNT(d.is_online) FILTER (WHERE d.is_online = true)
           / NULLIF(COUNT(a.asset_id), 0), 1)                        AS online_rate
       FROM assets a
       LEFT JOIN device_state d ON d.asset_id = a.asset_id
       WHERE a.is_active = true`,
      [],
      rlsOrgId,
    ),
    // Query 2: Today's revenue — v5.13: use client_savings as primary
    queryWithOrg(
      `SELECT
         COALESCE(SUM(vpp_arbitrage_profit_reais), 0) AS vpp_profit,
         COALESCE(SUM(client_savings_reais), 0)        AS client_savings,
         COALESCE(SUM(client_savings_reais), 0)        AS legacy_profit
       FROM revenue_daily
       WHERE date = CURRENT_DATE`,
      [],
      rlsOrgId,
    ),
    // Query 3: v5.13: Self-consumption from revenue_daily instead of algorithm_metrics
    queryWithOrg(
      `SELECT ROUND(AVG(actual_self_consumption_pct), 1) AS self_consumption_pct
       FROM revenue_daily
       WHERE date >= CURRENT_DATE - 7
         AND actual_self_consumption_pct IS NOT NULL`,
      [],
      rlsOrgId,
    ),
    // Query 4: dispatch KPIs from dispatch_commands
    queryWithOrg(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'completed')::int AS success_count,
         COUNT(*)::int AS total_count
       FROM dispatch_commands
       WHERE dispatched_at >= CURRENT_DATE`,
      [],
      rlsOrgId,
    ),
    // Query 5: v5.13: monthly revenue — use client_savings
    queryWithOrg(
      `SELECT COALESCE(SUM(client_savings_reais), 0) AS monthly_revenue
       FROM revenue_daily
       WHERE date >= date_trunc('month', CURRENT_DATE)`,
      [],
      rlsOrgId,
    ),
    // Query 6: self-consumption delta (today vs yesterday) — v5.13: from revenue_daily
    queryWithOrg(
      `SELECT
         (SELECT ROUND(AVG(actual_self_consumption_pct), 1) FROM revenue_daily
          WHERE date = CURRENT_DATE AND actual_self_consumption_pct IS NOT NULL) -
         (SELECT ROUND(AVG(actual_self_consumption_pct), 1) FROM revenue_daily
          WHERE date = CURRENT_DATE - 1 AND actual_self_consumption_pct IS NOT NULL) AS delta`,
      [],
      rlsOrgId,
    ),
    // Query 7: dispatch accuracy + latency from dispatch_records (last 7 days)
    queryWithOrg(
      `SELECT
         ROUND(100.0 * COUNT(*) FILTER (WHERE success = true)
           / NULLIF(COUNT(*), 0), 1) AS accuracy,
         ROUND(AVG(response_latency_ms) / 1000.0, 1) AS avg_latency_s
       FROM dispatch_records
       WHERE dispatched_at >= CURRENT_DATE - 7
         AND response_latency_ms IS NOT NULL`,
      [],
      rlsOrgId,
    ),
    // Query 8: v5.13 NEW: Gateway uptime from daily_uptime_snapshots
    queryWithOrg(
      `SELECT ROUND(AVG(uptime_pct), 1) AS gateway_uptime
       FROM daily_uptime_snapshots
       WHERE date >= CURRENT_DATE - 7`,
      [],
      rlsOrgId,
    ),
    // Query 9: v5.14 NEW: Self-Sufficiency value
    queryWithOrg(
      `SELECT ROUND(AVG(self_sufficiency_pct)::numeric, 1) AS avg_ss
       FROM revenue_daily
       WHERE date >= CURRENT_DATE - 7
         AND self_sufficiency_pct IS NOT NULL`,
      [],
      rlsOrgId,
    ),
    // Query 10: v5.14 NEW: Self-Sufficiency delta (today vs yesterday)
    queryWithOrg(
      `SELECT
         (SELECT ROUND(AVG(self_sufficiency_pct)::numeric, 1) FROM revenue_daily
          WHERE date = CURRENT_DATE AND self_sufficiency_pct IS NOT NULL) -
         (SELECT ROUND(AVG(self_sufficiency_pct)::numeric, 1) FROM revenue_daily
          WHERE date = CURRENT_DATE - 1 AND self_sufficiency_pct IS NOT NULL) AS delta`,
      [],
      rlsOrgId,
    ),
  ]);

  const agg = assetResult.rows[0] as Record<string, unknown>;
  const rev = revenueResult.rows[0] as Record<string, unknown>;

  // v5.13: Self-consumption from revenue_daily
  const selfConsumptionPct =
    selfConsumptionResult.rows.length > 0 &&
    selfConsumptionResult.rows[0].self_consumption_pct !== null
      ? parseFloat(
          String(selfConsumptionResult.rows[0].self_consumption_pct),
        ).toFixed(1)
      : "\u2014";

  const dispatchRow = dispatchResult.rows[0] as Record<string, unknown>;
  const dispatchSuccessCount = Number(dispatchRow?.success_count ?? 0);
  const dispatchTotalCount = Number(dispatchRow?.total_count ?? 0);
  const dispatchSuccessRate = `${dispatchSuccessCount}/${dispatchTotalCount}`;

  const monthlyRevenueReais = Math.round(
    Number(
      (monthlyResult.rows[0] as Record<string, unknown>)?.monthly_revenue ?? 0,
    ),
  );
  const selfConsumptionDelta = parseFloat(
    String((deltaResult.rows[0] as Record<string, unknown>)?.delta ?? 0),
  ).toFixed(1);
  const onlineRate = parseFloat(String(agg.online_rate ?? 0));
  const systemHealthBlock =
    onlineRate >= 95 ? "OPTIMAL" : onlineRate >= 85 ? "DEGRADED" : "CRITICAL";
  const accLatRow = accuracyLatencyResult.rows[0] as
    | Record<string, unknown>
    | undefined;
  const vppDispatchAccuracy = parseFloat(String(accLatRow?.accuracy ?? 0));
  const drResponseLatency = parseFloat(String(accLatRow?.avg_latency_s ?? 0));

  // v5.13: Gateway uptime from DB (was hardcoded 99.9)
  const gatewayUptime = parseFloat(
    String(
      (uptimeResult.rows[0] as Record<string, unknown>)?.gateway_uptime ?? 99.9,
    ),
  );

  // v5.14: Self-Sufficiency from revenue_daily
  const selfSufficiencyPct =
    selfSufficiencyResult.rows.length > 0 &&
    selfSufficiencyResult.rows[0].avg_ss !== null
      ? parseFloat(String(selfSufficiencyResult.rows[0].avg_ss)).toFixed(1)
      : "\u2014";
  const selfSufficiencyDelta = parseFloat(
    String(
      (selfSufficiencyDeltaResult.rows[0] as Record<string, unknown>)?.delta ??
        0,
    ),
  ).toFixed(1);

  const body = ok({
    // === DB: Asset statistics ===
    totalAssets: agg.total_assets as number,
    onlineAssets: agg.online_assets as number,
    avgSoc: Math.round(parseFloat(String(agg.avg_soc))),
    totalPowerKw: parseFloat(String(agg.total_load_kw)).toFixed(1),
    totalPvKw: parseFloat(String(agg.total_pv_kw)).toFixed(1),

    // === v5.13: Revenue KPIs — Tarifa Branca client_savings as primary ===
    dailyRevenueReais: Math.round(Number(rev.client_savings)),
    monthlyRevenueReais,

    // === v5.13: Self-consumption from revenue_daily ===
    selfConsumption: { value: selfConsumptionPct, delta: selfConsumptionDelta },
    // === v5.14: Self-sufficiency from revenue_daily ===
    selfSufficiency: { value: selfSufficiencyPct, delta: selfSufficiencyDelta },
    dispatchSuccessCount,
    dispatchTotalCount,
    systemHealthBlock,

    // === v5.13: de-hardcoded gatewayUptime ===
    vppDispatchAccuracy,
    drResponseLatency,
    gatewayUptime,
    dispatchSuccessRate,

    // === Revenue Breakdown — v5.13: Tarifa Branca Savings primary ===
    revenueBreakdown: {
      values: [
        Math.round(Number(rev.client_savings)),
        Math.round(Number(rev.vpp_profit)),
        0,
      ],
      colors: ["#059669", "#3730a3", "#d97706"],
      labels: ["Tarifa Branca Savings", "VPP Arbitrage (Future)", "Other"],
    },

    _tenant: { orgId: ctx.orgId, role: ctx.role },
  });

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
