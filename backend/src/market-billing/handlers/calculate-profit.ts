/**
 * 市场与计费 — 利润计算
 *
 * 纯计算 Lambda：使用白色电价加权能量分布，
 * 按资产按天计算收入/成本/利润。
 *
 * 输入：ProfitRequest 事件（直接调用，非 API Gateway）。
 * 无需数据库连接 — 电价数据通过事件传入。
 */
import type { Handler } from "aws-lambda";
import { randomUUID } from "crypto";
import { ok, fail } from "../../shared/types/api";

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

interface Tariff {
  readonly peakRate: number;
  readonly offPeakRate: number;
  readonly intermediateRate: number;
  readonly peakHours: number;
  readonly offPeakHours: number;
  readonly intermediateHours: number;
}

interface ProfitRequest {
  readonly orgId?: string;
  readonly assetId?: string;
  readonly date?: string;
  readonly energyKwh?: number;
  readonly tariff?: Partial<Tariff>;
  readonly operatingCostPerKwh?: number;
  readonly role?: string;
}

// ---------------------------------------------------------------------------
// AppConfig — 动态计费规则
// ---------------------------------------------------------------------------

const APPCONFIG_BASE =
  process.env.APPCONFIG_BASE_URL ?? "http://localhost:2772";
const APPCONFIG_APP = process.env.APPCONFIG_APP ?? "solfacil-vpp-dev";
const APPCONFIG_ENV = process.env.APPCONFIG_ENV ?? "dev";

interface BillingRulesConfig {
  readonly [orgId: string]: {
    readonly tariffPenaltyMultiplier?: number;
    readonly operatingCostPerKwh?: number;
  };
}

const DEFAULT_BILLING_RULES = {
  tariffPenaltyMultiplier: 1.0,
};

async function fetchBillingRules(
  orgId: string,
): Promise<typeof DEFAULT_BILLING_RULES> {
  try {
    const url = `${APPCONFIG_BASE}/applications/${APPCONFIG_APP}/environments/${APPCONFIG_ENV}/configurations/billing-rules`;
    const res = await fetch(url, { signal: AbortSignal.timeout(500) });
    if (!res.ok) return DEFAULT_BILLING_RULES;
    const configs = (await res.json()) as BillingRulesConfig;
    const orgRules = configs[orgId];
    if (!orgRules) return DEFAULT_BILLING_RULES;
    return {
      tariffPenaltyMultiplier: orgRules.tariffPenaltyMultiplier ?? 1.0,
    };
  } catch {
    return DEFAULT_BILLING_RULES;
  }
}

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

const TOTAL_HOURS = 24;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function isTariffComplete(t: Partial<Tariff> | undefined): t is Tariff {
  if (!t) return false;
  return (
    t.peakRate != null &&
    t.offPeakRate != null &&
    t.intermediateRate != null &&
    t.peakHours != null &&
    t.offPeakHours != null &&
    t.intermediateHours != null
  );
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

// TODO: v5.6 — Implement real two-tier profit calculation.
// Current Demo state: arbitrage_profit_reais and savings_reais pre-seeded in revenue_daily.
// Production target:
//   B-side: JOIN pld_horario + trade history → vppArbitrageProfit (R$/MWh)
//   C-side: retail_buy_rate_kwh × self-consumed kWh → clientSavings (R$/kWh)
// Reference: design/backend_architecture/04_MARKET_BILLING_MODULE_v5.5.md
export const handler: Handler = async (event: ProfitRequest) => {
  // ── 鉴权门禁：必须提供 orgId ──────────────────────────────────────────
  if (!event.orgId) {
    return {
      statusCode: 401,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fail("Unauthorized: missing orgId")),
    };
  }

  const { orgId, assetId, date, energyKwh, tariff, operatingCostPerKwh, role } =
    event;
  const traceId = `vpp-${randomUUID()}`;

  // ── 零值或负值能量 → 全部归零（非错误）────────────────────────────────
  if (!energyKwh || energyKwh <= 0) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        ok({
          orgId,
          assetId,
          date,
          energyKwh: energyKwh ?? 0,
          grossRevenue: 0,
          operatingCost: 0,
          profit: 0,
          breakdown: {
            peakEnergy: 0,
            peakRevenue: 0,
            offPeakEnergy: 0,
            offPeakRevenue: 0,
            intermediateEnergy: 0,
            intermediateRevenue: 0,
          },
          traceId,
          _tenant: { orgId, role },
        }),
      ),
    };
  }

  // ── 验证电价数据完整性 ─────────────────────────────────────────────────
  if (!isTariffComplete(tariff)) {
    throw new Error("Missing tariff data");
  }

  // ── 验证时段小时数之和为 24 ────────────────────────────────────────────
  const hoursSum =
    tariff.peakHours + tariff.offPeakHours + tariff.intermediateHours;
  if (hoursSum !== TOTAL_HOURS) {
    throw new Error("Invalid tariff hours: must sum to 24");
  }

  // ── 从 AppConfig 获取动态计费规则 ──────────────────────────────────────
  const billingRules = await fetchBillingRules(orgId);

  // ── 能量分配（按分时电价加权）──────────────────────────────────────────
  const peakEnergy = round2(energyKwh * (tariff.peakHours / TOTAL_HOURS));
  const offPeakEnergy = round2(energyKwh * (tariff.offPeakHours / TOTAL_HOURS));
  const intermediateEnergy = round2(
    energyKwh * (tariff.intermediateHours / TOTAL_HOURS),
  );

  // ── 各时段收入 ─────────────────────────────────────────────────────────
  const peakRevenue = round2(peakEnergy * tariff.peakRate);
  const offPeakRevenue = round2(offPeakEnergy * tariff.offPeakRate);
  const intermediateRevenue = round2(
    intermediateEnergy * tariff.intermediateRate,
  );

  // ── 汇总 ──────────────────────────────────────────────────────────────
  const grossRevenue = round2(
    peakRevenue + offPeakRevenue + intermediateRevenue,
  );
  const operatingCost = round2(
    energyKwh *
      (operatingCostPerKwh ?? 0) *
      billingRules.tariffPenaltyMultiplier,
  );
  const profit = round2(grossRevenue - operatingCost);

  console.info(
    JSON.stringify({
      level: "INFO",
      traceId,
      module: "M4",
      action: "profit_calculated",
      orgId,
      assetId,
      grossRevenue,
      operatingCost,
      profit,
    }),
  );

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      ok({
        orgId,
        assetId,
        date,
        energyKwh,
        grossRevenue,
        operatingCost,
        profit,
        breakdown: {
          peakEnergy,
          peakRevenue,
          offPeakEnergy,
          offPeakRevenue,
          intermediateEnergy,
          intermediateRevenue,
        },
        traceId,
        _tenant: { orgId, role },
      }),
    ),
  };
};
