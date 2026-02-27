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
} from "../middleware/tenant-context";
import { queryWithOrg } from "../../shared/db";

/**
 * GET /dashboard
 * 返回 VPP 仪表盘的聚合 KPI：
 * - 資產統計（totalAssets, onlineAssets, avgSoc, totalPowerKw, totalPvKw）
 * - 算法 KPI（alpha、mape、selfConsumption）— Stage 5 優化引擎上線後補齊
 * - 財務 KPI — Stage 4 接 revenue_daily 後補齊
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

  // ── 從 DB 聚合（assets JOIN device_state）──────────────────────
  const isAdmin = ctx.role === Role.SOLFACIL_ADMIN;
  const rlsOrgId = isAdmin ? null : ctx.orgId;

  const { rows } = await queryWithOrg(
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
  );

  const agg = rows[0] as Record<string, unknown>;

  const body = ok({
    // === DB 真實聚合 ===
    totalAssets: agg.total_assets as number,
    onlineAssets: agg.online_assets as number,
    avgSoc: Math.round(parseFloat(String(agg.avg_soc))),
    totalPowerKw: parseFloat(String(agg.total_load_kw)).toFixed(1),
    totalPvKw: parseFloat(String(agg.total_pv_kw)).toFixed(1),

    // === 財務 KPI — Stage 4 接 revenue_daily 後補齊（暫時 0）===
    dailyRevenueReais: 0,
    monthlyRevenueReais: 0,

    // === 演算法 KPI — Stage 5 優化引擎資料上線後補齊（暫時靜態）===
    alpha: { value: "76.3", delta: "0.0" },
    mape: { value: "18.5", delta: "0.0" },
    selfConsumption: { value: "98.2", delta: "0.0" },
    dispatchSuccessCount: 156,
    dispatchTotalCount: 160,
    systemHealthBlock: "OPTIMAL",

    // === 其他維持格式相容（前端 DOM ID 依賴）===
    vppDispatchAccuracy: 97.5,
    drResponseLatency: 1.8,
    gatewayUptime: 99.9,
    dispatchSuccessRate: "156/160",

    _tenant: { orgId: ctx.orgId, role: ctx.role },
  });

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
