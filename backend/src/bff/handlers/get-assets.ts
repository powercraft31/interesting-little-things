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
} from "../middleware/tenant-context";
import { queryWithOrg } from "../../shared/db";

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

const DEFAULT_FLAGS: FeatureFlags = {};

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

  // ── config 預設值 lookup（vpp_strategies 尚無資料，依 operation_mode 推導）──
  const CONFIG_DEFAULTS: Record<string, object> = {
    peak_valley_arbitrage: {
      target_mode: "peak_valley_arbitrage",
      min_soc: 20,
      max_charge_rate: 3.3,
      charge_window_start: "23:00",
      charge_window_end: "05:00",
      discharge_window_start: "17:00",
    },
    self_consumption: {
      target_mode: "self_consumption",
      min_soc: 15,
      max_charge_rate: 3.3,
      charge_window_start: "22:00",
      charge_window_end: "06:00",
      discharge_window_start: "07:00",
    },
    peak_shaving: {
      target_mode: "peak_shaving",
      min_soc: 10,
      max_charge_rate: 5.0,
      charge_window_start: "01:00",
      charge_window_end: "06:00",
      discharge_window_start: "09:00",
    },
  };

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
  const isAdmin = ctx.role === Role.SOLFACIL_ADMIN;
  const rlsOrgId = isAdmin ? null : ctx.orgId;

  const { rows } = await queryWithOrg(
    `SELECT
       a.asset_id,
       a.org_id,
       a.name,
       a.region,
       a.capacidade_kw    AS capacidade,
       a.capacity_kwh,
       a.operation_mode,
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
       d.grid_frequency
     FROM assets a
     LEFT JOIN device_state d ON d.asset_id = a.asset_id
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
    capacidade: parseFloat(String(r.capacidade)) || 0,
    capacity_kwh: parseFloat(String(r.capacity_kwh)) || 0,
    socMedio: Math.round(parseFloat(String(r.battery_soc)) || 0),
    operationMode: r.operation_mode as string,
    // 財務欄位 — Stage 4 接 revenue_daily 後補齊
    investimento: 0,
    receitaHoje: 0,
    receitaMes: 0,
    roi: null as number | null,
    custoHoje: 0,
    lucroHoje: 0,
    payback: null as string | null,
    // 遙測（三層嵌套）
    metering: {
      pv_power: parseFloat(String(r.pv_power)) || 0,
      battery_power: parseFloat(String(r.battery_power)) || 0,
      grid_power_kw: parseFloat(String(r.grid_power_kw)) || 0,
      load_power: parseFloat(String(r.load_power)) || 0,
      // 日累計 — Stage 5 接 telemetry_history 後補齊
      grid_import_kwh: 0,
      grid_export_kwh: 0,
      pv_daily_energy: 0,
      bat_charged_today: 0,
      bat_discharged_today: 0,
    },
    status: {
      battery_soc: parseFloat(String(r.battery_soc)) || 0,
      bat_soh: parseFloat(String(r.bat_soh)) || 0,
      bat_work_status: ((r.bat_work_status as string) || "idle") as
        | "charging"
        | "discharging"
        | "idle",
      battery_voltage: parseFloat(String(r.battery_voltage)) || 0,
      bat_cycle_count: parseInt(String(r.bat_cycle_count), 10) || 0,
      inverter_temp: parseFloat(String(r.inverter_temp)) || 0,
      is_online: (r.is_online as boolean) ?? false,
      grid_frequency: parseFloat(String(r.grid_frequency)) || 0,
    },
    config:
      CONFIG_DEFAULTS[r.operation_mode as string] ??
      CONFIG_DEFAULTS["peak_valley_arbitrage"],
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
