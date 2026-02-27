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

/**
 * GET /dashboard
 * 返回 VPP 仪表盘的聚合 KPI：
 * - 算法 KPI（alpha、mape、selfConsumption）
 * - 收入分布（环形图数据）
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

  const baseAlpha = 76.3;
  const deltaAlpha = parseFloat(((Math.random() - 0.5) * 2).toFixed(1));

  const baseMape = 18.5;
  const deltaMape = parseFloat(((Math.random() - 0.5) * 1).toFixed(1));

  const baseSelfCon = 98.2;
  const deltaSelfCon = parseFloat(((Math.random() - 0.5) * 0.5).toFixed(1));

  const dispatchBase = 156;
  const dispatchTotal = 160;
  const dispatchDelta = Math.floor((Math.random() - 0.5) * 4);

  const body = ok({
    // === 原有 KPI（保留）===
    alpha: {
      value: (baseAlpha + deltaAlpha).toFixed(1),
      delta: deltaAlpha.toFixed(1),
    },
    mape: {
      value: (baseMape + deltaMape).toFixed(1),
      delta: (-deltaMape).toFixed(1),
    },
    selfConsumption: {
      value: (baseSelfCon + deltaSelfCon).toFixed(1),
      delta: deltaSelfCon.toFixed(1),
    },
    revenueBreakdown: {
      values: [32450, 12385, 3400],
      colors: ["#3730a3", "#059669", "#d97706"],
    },
    // === v5.3 新增 KPI（DashboardMetrics）===
    totalAssets: 4,
    onlineAssets: 3,
    avgSoc: 57.3,
    totalPowerKw: 18.4,
    dailyRevenueReais: 52450,
    monthlyRevenueReais: 1235000,
    vppDispatchAccuracy: parseFloat(
      (95.1 + (Math.random() - 0.5) * 1.5).toFixed(1),
    ),
    drResponseLatency: parseFloat(
      (1.94 + (Math.random() - 0.5) * 0.3).toFixed(2),
    ),
    gatewayUptime: 99.9,
    dispatchSuccessRate: `${dispatchBase + dispatchDelta}/${dispatchTotal}`,
    _tenant: { orgId: ctx.orgId, role: ctx.role },
  });

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
