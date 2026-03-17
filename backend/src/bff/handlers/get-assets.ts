import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { randomUUID } from "crypto";
import { ok } from "../../shared/types/api";
import { Role } from "../../shared/types/auth";
import {
  extractTenantContext,
  requireRole,
  apiError,
} from "../middleware/auth";
import { queryWithOrg } from "../../shared/db";

/** Parse numeric DB value; returns null if input is null/undefined. */
function toNum(val: unknown): number | null {
  if (val == null) return null;
  const n = parseFloat(String(val));
  return Number.isNaN(n) ? null : n;
}

function toInt(val: unknown): number | null {
  if (val == null) return null;
  const n = parseInt(String(val), 10);
  return Number.isNaN(n) ? null : n;
}

// ---------------------------------------------------------------------------
// AppConfig — 功能开关
// ---------------------------------------------------------------------------

const APPCONFIG_BASE =
  process.env.APPCONFIG_BASE_URL ?? "http://localhost:2772";
const APPCONFIG_APP = process.env.APPCONFIG_APP ?? "solfacil-vpp-dev";
const APPCONFIG_ENV = process.env.APPCONFIG_ENV ?? "dev";

interface FeatureFlags {
  readonly [flagName: string]: {
    readonly isEnabled: boolean;
    readonly targetOrgIds?: string[];
  };
}

const DEFAULT_FLAGS: FeatureFlags = {
  "show-roi-metrics": { isEnabled: true },
};

async function fetchFeatureFlags(): Promise<FeatureFlags> {
  try {
    const url = `${APPCONFIG_BASE}/applications/${APPCONFIG_APP}/environments/${APPCONFIG_ENV}/configurations/feature-flags`;
    const res = await fetch(url, { signal: AbortSignal.timeout(500) });
    if (!res.ok) return DEFAULT_FLAGS;
    return (await res.json()) as FeatureFlags;
  } catch {
    return DEFAULT_FLAGS;
  }
}

function isFlagEnabled(
  flags: FeatureFlags,
  flagName: string,
  orgId: string,
): boolean {
  const flag = flags[flagName];
  if (!flag || !flag.isEnabled) return false;
  if (!flag.targetOrgIds || flag.targetOrgIds.length === 0) return true;
  return flag.targetOrgIds.includes(orgId);
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * GET /assets
 * 返回 VPP 资产组合及运行模式和财务指标。
 * 字段名与前端 INITIAL_DATA.assets 结构完全一致。
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

  const traceId = `vpp-${randomUUID()}`;
  const flags = await fetchFeatureFlags();
  const showRoiMetrics = isFlagEnabled(flags, "show-roi-metrics", ctx.orgId);

  function deriveOperationalStatus(row: {
    is_online: boolean;
    bat_work_status: string;
  }): string {
    if (!row.is_online) return "offline";
    if (row.bat_work_status === "charging") return "carregando";
    return "operando";
  }

  // ── 從 DB 查詢（assets JOIN device_state）──────────────────────
  // RLS handles org isolation: admin sees all, org users see only their org
  const rlsOrgId = ctx.orgId;

  const { rows } = await queryWithOrg(
    `SELECT
       a.asset_id,
       a.org_id,
       a.name,
       a.region,
       a.capacidade_kw          AS capacidade,
       a.capacity_kwh,
       a.operation_mode,
       a.investimento_brl,
       a.roi_pct,
       a.payback_str,
       a.receita_mes_brl,
       d.battery_soc,
       d.bat_soh,
       d.bat_work_status,
       d.battery_voltage,
       d.bat_cycle_count,
       d.pv_power,
       d.battery_power,
       d.grid_power_kw,
       d.load_power,
       d.inverter_temp,
       d.is_online,
       d.grid_frequency,
       d.pv_daily_energy,
       d.bat_charged_today,
       d.bat_discharged_today,
       d.grid_import_kwh,
       d.grid_export_kwh,
       r.revenue_reais           AS receita_hoje_brl,
       r.cost_reais              AS custo_hoje_brl,
       r.profit_reais            AS lucro_hoje_brl,
       vs.min_soc                AS vs_min_soc,
       vs.max_soc                AS vs_max_soc,
       vs.max_charge_rate_kw,
       vs.charge_window_start,
       vs.charge_window_end,
       vs.discharge_window_start,
       vs.target_self_consumption_pct
     FROM assets a
     LEFT JOIN device_state d ON d.asset_id = a.asset_id
     LEFT JOIN revenue_daily r ON r.asset_id = a.asset_id AND r.date = CURRENT_DATE
     LEFT JOIN vpp_strategies vs ON vs.org_id = a.org_id
       AND vs.target_mode = a.operation_mode
       AND vs.is_active = true
     WHERE a.is_active = true
     ORDER BY a.asset_id`,
    [],
    rlsOrgId,
  );

  const ALL_ASSETS = rows.map((r: Record<string, unknown>) => ({
    id: r.asset_id as string,
    assetId: r.asset_id as string,
    orgId: r.org_id as string,
    name: r.name as string,
    region: r.region as string,
    operationalStatus: deriveOperationalStatus({
      is_online: (r.is_online as boolean) ?? false,
      bat_work_status: (r.bat_work_status as string) || "idle",
    }),
    capacidade: toNum(r.capacidade),
    capacity_kwh: toNum(r.capacity_kwh),
    socMedio: r.battery_soc != null ? Math.round(toNum(r.battery_soc)!) : null,
    operationMode: r.operation_mode as string,
    // 財務欄位 — Stage 5: from assets + revenue_daily
    investimento: toNum(r.investimento_brl),
    receitaHoje: toNum(r.receita_hoje_brl),
    receitaMes: toNum(r.receita_mes_brl),
    roi: r.roi_pct != null ? parseFloat(String(r.roi_pct)) : null,
    custoHoje: toNum(r.custo_hoje_brl),
    lucroHoje: toNum(r.lucro_hoje_brl),
    payback: (r.payback_str as string) ?? null,
    // 遙測（三層嵌套）
    metering: {
      pv_power: toNum(r.pv_power),
      battery_power: toNum(r.battery_power),
      grid_power_kw: toNum(r.grid_power_kw),
      load_power: toNum(r.load_power),
      // 日累計 — Stage 5: from device_state
      grid_import_kwh: toNum(r.grid_import_kwh),
      grid_export_kwh: toNum(r.grid_export_kwh),
      pv_daily_energy: toNum(r.pv_daily_energy),
      bat_charged_today: toNum(r.bat_charged_today),
      bat_discharged_today: toNum(r.bat_discharged_today),
    },
    status: {
      battery_soc: toNum(r.battery_soc),
      bat_soh: toNum(r.bat_soh),
      bat_work_status: ((r.bat_work_status as string) || "idle") as
        | "charging"
        | "discharging"
        | "idle",
      battery_voltage: toNum(r.battery_voltage),
      bat_cycle_count: toInt(r.bat_cycle_count),
      inverter_temp: toNum(r.inverter_temp),
      is_online: (r.is_online as boolean) ?? false,
      grid_frequency: toNum(r.grid_frequency),
    },
    config:
      r.vs_min_soc != null
        ? {
            target_mode: r.operation_mode as string,
            min_soc: parseFloat(String(r.vs_min_soc)),
            max_soc: parseFloat(String(r.vs_max_soc)),
            max_charge_rate: parseFloat(String(r.max_charge_rate_kw)) || 3.3,
            charge_window_start: (r.charge_window_start as string) || "23:00",
            charge_window_end: (r.charge_window_end as string) || "05:00",
            discharge_window_start:
              (r.discharge_window_start as string) || "17:00",
            target_self_consumption_pct:
              parseFloat(String(r.target_self_consumption_pct)) || 80,
          }
        : null, // null when no strategy configured for this asset
  }));

  // RLS already filters by org for non-admin; no additional JS filter needed.
  // 应用功能开关：按条件决定是否包含 ROI 指标
  const assets = ALL_ASSETS.map((a) => ({
    ...a,
    roi: showRoiMetrics ? a.roi : undefined,
    payback: showRoiMetrics ? a.payback : undefined,
  }));

  const body = ok({ assets, _tenant: { orgId: ctx.orgId, role: ctx.role } });

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", "x-trace-id": traceId },
    body: JSON.stringify(body),
  };
}
