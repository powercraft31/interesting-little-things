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
 * GET /revenue-trend
 * v5.5: 從 revenue_daily 表查詢近 7 天雙軌收益趨勢。
 * 保持舊 field names（receita/custo/lucro）讓前端折線圖相容，
 * 同時新增雙層欄位（vppArbitrageProfit/clientSavings）。
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

  const { rows } = await queryWithOrg(
    `SELECT
       date,
       COALESCE(SUM(vpp_arbitrage_profit_reais), 0) AS arbitrage_profit,
       COALESCE(SUM(client_savings_reais), 0)        AS client_savings,
       COALESCE(SUM(profit_reais), 0)                AS legacy_lucro,
       COALESCE(SUM(revenue_reais), 0)               AS legacy_receita,
       COALESCE(SUM(cost_reais), 0)                  AS legacy_custo
     FROM revenue_daily
     WHERE date >= CURRENT_DATE - INTERVAL '7 days'
       AND date < CURRENT_DATE
     GROUP BY date
     ORDER BY date ASC`,
    [],
    ctx.role === Role.SOLFACIL_ADMIN ? null : ctx.orgId,
  );

  const revenueTrend = {
    // 舊 field names（前端折線圖依賴，保持不變）
    receita: rows.map(
      (r) => Number(r.legacy_receita) || Number(r.arbitrage_profit),
    ),
    custo: rows.map((r) => Number(r.legacy_custo)),
    lucro: rows.map(
      (r) => Number(r.legacy_lucro) || Number(r.arbitrage_profit),
    ),
    // v5.5 新增：雙層收益（前端 Phase 3 會用）
    vppArbitrageProfit: rows.map((r) => Number(r.arbitrage_profit)),
    clientSavings: rows.map((r) => Number(r.client_savings)),
    dates: rows.map((r) => r.date),
    _tenant: { orgId: ctx.orgId, role: ctx.role },
  };

  const body = ok(revenueTrend);

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
