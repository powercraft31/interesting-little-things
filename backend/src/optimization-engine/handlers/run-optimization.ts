/**
 * 优化引擎 — 运行优化 Handler
 *
 * 评估电池 SOC 与电价时段，确定最优充放电模式（能量套利）。
 * 将决策发布到 EventBridge，供下游服务（DR Dispatcher）执行。
 *
 * 套利规则（按顺序评估）：
 *   1. 峰时 + SOC > minSoc → 放电（卖出高价电力）
 *   2. 谷时 + SOC < maxSoc → 充电（买入低价电力）
 *   3. 其他情况 → 待机（保护电池 / 平时段）
 *
 * 阈值（minSoc、maxSoc）通过 Lambda Extension Sidecar
 * （http://localhost:2772）从 AppConfig 动态获取。
 * AppConfig 不可用时降级使用 DEFAULT_STRATEGY。
 */
import {
  EventBridgeClient,
  PutEventsCommand,
} from "@aws-sdk/client-eventbridge";

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

interface OptimizationEvent {
  readonly orgId: string;
  readonly assetId: string;
  readonly soc: number;
  readonly currentTariffPeriod: "peak" | "off-peak" | "intermediate";
}

type TargetMode = "discharge" | "charge" | "idle";

interface OptimizationResult {
  readonly success: true;
  readonly data: {
    readonly assetId: string;
    readonly orgId: string;
    readonly targetMode: TargetMode;
    readonly soc: number;
    readonly tariffPeriod: string;
    readonly dispatchId: string;
    readonly eventPublished: true;
  };
}

interface VppStrategyConfig {
  readonly minSoc: number;
  readonly maxSoc: number;
  readonly emergencySoc: number;
  readonly profitMargin: number;
}

interface VppStrategiesConfig {
  readonly [orgId: string]: VppStrategyConfig;
}

// ---------------------------------------------------------------------------
// 环境变量与常量
// ---------------------------------------------------------------------------

const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME ?? "";
const APPCONFIG_BASE =
  process.env.APPCONFIG_BASE_URL ?? "http://localhost:2772";
const APPCONFIG_APP = process.env.APPCONFIG_APP ?? "solfacil-vpp-dev";
const APPCONFIG_ENV = process.env.APPCONFIG_ENV ?? "dev";

const DEFAULT_STRATEGY: VppStrategyConfig = {
  minSoc: 20,
  maxSoc: 90,
  emergencySoc: 10,
  profitMargin: 0.15,
};

// ---------------------------------------------------------------------------
// SDK 客户端（每次 Lambda 冷启动实例化一次）
// ---------------------------------------------------------------------------

const eb = new EventBridgeClient({});

// ---------------------------------------------------------------------------
// AppConfig 获取器
// ---------------------------------------------------------------------------

async function fetchVppStrategy(orgId: string): Promise<VppStrategyConfig> {
  try {
    const url = `${APPCONFIG_BASE}/applications/${APPCONFIG_APP}/environments/${APPCONFIG_ENV}/configurations/vpp-strategies`;
    const res = await fetch(url, { signal: AbortSignal.timeout(500) });
    if (!res.ok) return DEFAULT_STRATEGY;
    const configs = (await res.json()) as VppStrategiesConfig;
    return configs[orgId] ?? DEFAULT_STRATEGY;
  } catch {
    return DEFAULT_STRATEGY;
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

// TODO: v5.6 — Implement real dual-objective optimization.
// Current Demo state: revenue_daily uses pre-seeded values (migration_v5.5.sql).
// Production target: Maximize PLD arbitrage profit subject to:
//   self_consumption_pct >= vpp_strategies.target_self_consumption_pct
// Algorithm candidates: Linear Programming (LP) or Model Predictive Control (MPC).
// Reference: design/backend_architecture/02_OPTIMIZATION_ENGINE_v5.5.md
export async function handler(
  event: OptimizationEvent,
): Promise<OptimizationResult> {
  const traceId = `vpp-${crypto.randomUUID()}`;
  const { orgId, assetId, soc, currentTariffPeriod } = event;

  // ── 输入验证 ───────────────────────────────────────────────────────────
  if (!orgId || !assetId) {
    throw new Error("Missing required field");
  }
  if (soc < 0 || soc > 100) {
    throw new Error("Invalid SOC value");
  }

  // ── 从 AppConfig 获取动态策略 ──────────────────────────────────────────
  const strategy = await fetchVppStrategy(orgId);

  // ── 套利决策 ───────────────────────────────────────────────────────────
  const targetMode = resolveTargetMode(
    currentTariffPeriod,
    soc,
    strategy.minSoc,
    strategy.maxSoc,
  );

  console.info(
    JSON.stringify({
      level: "INFO",
      traceId,
      module: "M2",
      action: "optimization_result",
      assetId,
      orgId,
      targetMode,
      soc,
      tariffPeriod: currentTariffPeriod,
    }),
  );

  // ── 发布到 EventBridge ─────────────────────────────────────────────────
  const dispatchId = crypto.randomUUID();
  const timestamp = new Date().toISOString();

  await eb.send(
    new PutEventsCommand({
      Entries: [
        {
          EventBusName: EVENT_BUS_NAME,
          Source: "solfacil.optimization-engine",
          DetailType: "DRCommandIssued",
          Detail: JSON.stringify({
            dispatchId,
            assetId,
            orgId,
            targetMode,
            soc,
            tariffPeriod: currentTariffPeriod,
            timestamp,
            traceId,
          }),
        },
      ],
    }),
  );

  console.info(
    JSON.stringify({
      level: "INFO",
      traceId,
      module: "M2",
      action: "event_published",
      dispatchId,
    }),
  );

  return {
    success: true,
    data: {
      assetId,
      orgId,
      targetMode,
      soc,
      tariffPeriod: currentTariffPeriod,
      dispatchId,
      eventPublished: true,
    },
  };
}

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

function resolveTargetMode(
  period: "peak" | "off-peak" | "intermediate",
  soc: number,
  minSoc: number,
  maxSoc: number,
): TargetMode {
  if (period === "peak" && soc > minSoc) return "discharge";
  if (period === "off-peak" && soc < maxSoc) return "charge";
  return "idle";
}
