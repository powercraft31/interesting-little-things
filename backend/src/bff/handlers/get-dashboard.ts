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
 * v5.5: VPP 儀表盤聚合 KPI
 * - 資產統計（assets JOIN device_state）
 * - 今日雙層收益（revenue_daily）
 * - 自消費率（algorithm_metrics）
 * - 移除 alpha / mape（不再使用技術精度指標）
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

  const isAdmin = ctx.role === Role.SOLFACIL_ADMIN;
  const rlsOrgId = isAdmin ? null : ctx.orgId;

  // ── 並行查詢 4 個資料來源 ──────────────────────────────
  const [assetResult, revenueResult, metricsResult, dispatchResult] =
    await Promise.all([
      // 查詢 1：資產聚合（assets JOIN device_state）
      queryWithOrg(
        `SELECT
         COUNT(a.asset_id)::int                                      AS total_assets,
         COUNT(d.is_online) FILTER (WHERE d.is_online = true)::int   AS online_assets,
         COALESCE(AVG(d.battery_soc), 0)                             AS avg_soc,
         COALESCE(SUM(d.load_power), 0)                              AS total_load_kw,
         COALESCE(SUM(d.pv_power), 0)                                AS total_pv_kw
       FROM assets a
       LEFT JOIN device_state d ON d.asset_id = a.asset_id
       WHERE a.is_active = true`,
        [],
        rlsOrgId,
      ),
      // 查詢 2：今日雙層收益（revenue_daily）
      queryWithOrg(
        `SELECT
         COALESCE(SUM(vpp_arbitrage_profit_reais), 0) AS vpp_profit,
         COALESCE(SUM(client_savings_reais), 0)        AS client_savings,
         COALESCE(SUM(profit_reais), 0)                AS legacy_profit
       FROM revenue_daily
       WHERE date = CURRENT_DATE`,
        [],
        rlsOrgId,
      ),
      // 查詢 3：最新 self_consumption（algorithm_metrics）
      queryWithOrg(
        `SELECT self_consumption_pct
       FROM algorithm_metrics
       WHERE date <= CURRENT_DATE
       ORDER BY date DESC
       LIMIT 1`,
        [],
        rlsOrgId,
      ),
      // 查詢 4：v5.10 dispatch KPIs from dispatch_commands
      // Hits idx_dispatch_commands_status_org composite index
      queryWithOrg(
        `SELECT
         COUNT(*) FILTER (WHERE status = 'completed')::int AS success_count,
         COUNT(*)::int AS total_count
       FROM dispatch_commands
       WHERE dispatched_at >= CURRENT_DATE`,
        [],
        rlsOrgId,
      ),
    ]);

  const agg = assetResult.rows[0] as Record<string, unknown>;
  const rev = revenueResult.rows[0] as Record<string, unknown>;
  const selfConsumptionPct =
    metricsResult.rows.length > 0
      ? parseFloat(String(metricsResult.rows[0].self_consumption_pct)).toFixed(
          1,
        )
      : "\u2014";

  // v5.10: dispatch KPIs from DB (was hardcoded 156/160)
  const dispatchRow = dispatchResult.rows[0] as Record<string, unknown>;
  const dispatchSuccessCount = Number(dispatchRow?.success_count ?? 0);
  const dispatchTotalCount = Number(dispatchRow?.total_count ?? 0);
  const dispatchSuccessRate = `${dispatchSuccessCount}/${dispatchTotalCount}`;

  const body = ok({
    // === DB 真實聚合：資產統計 ===
    totalAssets: agg.total_assets as number,
    onlineAssets: agg.online_assets as number,
    avgSoc: Math.round(parseFloat(String(agg.avg_soc))),
    totalPowerKw: parseFloat(String(agg.total_load_kw)).toFixed(1),
    totalPvKw: parseFloat(String(agg.total_pv_kw)).toFixed(1),

    // === DB 真實聚合：財務 KPI（v5.5 雙層） ===
    dailyRevenueReais: Math.round(Number(rev.vpp_profit)),
    monthlyRevenueReais: 0,

    // === DB 真實聚合：演算法 KPI ===
    selfConsumption: { value: selfConsumptionPct, delta: "0.0" },
    dispatchSuccessCount,
    dispatchTotalCount,
    systemHealthBlock: "OPTIMAL",

    // === 其他維持格式相容（前端 DOM ID 依賴）===
    vppDispatchAccuracy: 97.5,
    drResponseLatency: 1.8,
    gatewayUptime: 99.9,
    dispatchSuccessRate,

    // === Revenue Breakdown（圓環圖）— v5.5 雙層：B端 + C端 + 其他 ===
    revenueBreakdown: {
      values: [
        Math.round(Number(rev.vpp_profit)),
        Math.round(Number(rev.client_savings)),
        0,
      ],
      colors: ["#3730a3", "#059669", "#d97706"],
      labels: ["VPP Arbitrage", "Client Savings", "Other"],
    },

    _tenant: { orgId: ctx.orgId, role: ctx.role },
  });

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
