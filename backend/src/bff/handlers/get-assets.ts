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

  const ALL_ASSETS = [
    {
      // === 顯示/財務欄位（前端 UI 用）===
      id: "ASSET_SP_001",
      assetId: "ASSET_SP_001",
      orgId: "ORG_ENERGIA_001",
      name: "São Paulo - Casa Verde",
      region: "SP",
      operationalStatus: "operando",
      investimento: 4200000,
      capacidade: 5.2,
      capacity_kwh: 13.5,
      socMedio: 65,
      receitaHoje: 18650,
      receitaMes: 412300,
      roi: 19.2,
      custoHoje: 4250,
      lucroHoje: 14400,
      payback: "3,8",
      operationMode: "peak_valley_arbitrage",
      // === v5.3 三層嵌套（能量守恆驗證通過）===
      metering: {
        pv_power: 3.2,
        battery_power: -1.8, // 負=放電
        grid_power_kw: 0.0,
        load_power: 5.0,
        grid_import_kwh: 0.0,
        grid_export_kwh: 0.0,
        pv_daily_energy: 22.4,
        bat_charged_today: 8.1,
        bat_discharged_today: 12.3,
      },
      status: {
        battery_soc: 65,
        bat_soh: 98,
        bat_work_status: "discharging" as const,
        battery_voltage: 51.6,
        bat_cycle_count: 312,
        inverter_temp: 38.2,
        is_online: true,
        grid_frequency: 60.02,
      },
      config: {
        target_mode: "peak_valley_arbitrage",
        min_soc: 20,
        max_charge_rate: 3.3,
        charge_window_start: "23:00",
        charge_window_end: "05:00",
        discharge_window_start: "17:00",
      },
    },
    {
      id: "ASSET_RJ_002",
      assetId: "ASSET_RJ_002",
      orgId: "ORG_ENERGIA_001",
      name: "Rio de Janeiro - Copacabana",
      region: "RJ",
      operationalStatus: "operando",
      investimento: 3800000,
      capacidade: 4.8,
      capacity_kwh: 10.0,
      socMedio: 72,
      receitaHoje: 16420,
      receitaMes: 378500,
      roi: 17.8,
      custoHoje: 3890,
      lucroHoje: 12530,
      payback: "4,1",
      operationMode: "self_consumption",
      metering: {
        pv_power: 4.5,
        battery_power: 1.0, // 正=充電
        grid_power_kw: -0.5, // 負=賣電
        load_power: 3.0,
        grid_import_kwh: 0.0,
        grid_export_kwh: 8.6,
        pv_daily_energy: 28.6,
        bat_charged_today: 14.2,
        bat_discharged_today: 0.0,
      },
      status: {
        battery_soc: 72,
        bat_soh: 97,
        bat_work_status: "charging" as const,
        battery_voltage: 51.8,
        bat_cycle_count: 198,
        inverter_temp: 35.1,
        is_online: true,
        grid_frequency: 60.0,
      },
      config: {
        target_mode: "self_consumption",
        min_soc: 15,
        max_charge_rate: 3.3,
        charge_window_start: "22:00",
        charge_window_end: "06:00",
        discharge_window_start: "07:00",
      },
    },
    {
      id: "ASSET_MG_003",
      assetId: "ASSET_MG_003",
      orgId: "ORG_SOLARBR_002",
      name: "Belo Horizonte - Pampulha",
      region: "MG",
      operationalStatus: "operando",
      investimento: 2900000,
      capacidade: 3.6,
      capacity_kwh: 11.5,
      socMedio: 58,
      receitaHoje: 11280,
      receitaMes: 298400,
      roi: 16.4,
      custoHoje: 2680,
      lucroHoje: 8600,
      payback: "4,5",
      operationMode: "peak_valley_arbitrage",
      metering: {
        pv_power: 2.8,
        battery_power: -1.5, // 負=放電
        grid_power_kw: 0.0,
        load_power: 4.3,
        grid_import_kwh: 0.0,
        grid_export_kwh: 0.0,
        pv_daily_energy: 18.9,
        bat_charged_today: 5.4,
        bat_discharged_today: 10.8,
      },
      status: {
        battery_soc: 58,
        bat_soh: 95,
        bat_work_status: "discharging" as const,
        battery_voltage: 49.8,
        bat_cycle_count: 421,
        inverter_temp: 42.7,
        is_online: true,
        grid_frequency: 59.98,
      },
      config: {
        target_mode: "peak_valley_arbitrage",
        min_soc: 20,
        max_charge_rate: 5.0,
        charge_window_start: "23:00",
        charge_window_end: "05:00",
        discharge_window_start: "17:00",
      },
    },
    {
      id: "ASSET_PR_004",
      assetId: "ASSET_PR_004",
      orgId: "ORG_SOLARBR_002",
      name: "Curitiba - Batel",
      region: "PR",
      operationalStatus: "carregando",
      investimento: 1500000,
      capacidade: 2.0,
      capacity_kwh: 14.0,
      socMedio: 34,
      receitaHoje: 6100,
      receitaMes: 145800,
      roi: 15.1,
      custoHoje: 1895,
      lucroHoje: 4205,
      payback: "4,8",
      operationMode: "peak_shaving",
      metering: {
        pv_power: 3.6,
        battery_power: 2.0, // 正=充電
        grid_power_kw: 1.4, // 正=買電
        load_power: 3.0,
        grid_import_kwh: 12.4,
        grid_export_kwh: 0.0,
        pv_daily_energy: 24.1,
        bat_charged_today: 9.8,
        bat_discharged_today: 0.0,
      },
      status: {
        battery_soc: 34,
        bat_soh: 99,
        bat_work_status: "charging" as const,
        battery_voltage: 47.2,
        bat_cycle_count: 87,
        inverter_temp: 33.6,
        is_online: true,
        grid_frequency: 60.01,
      },
      config: {
        target_mode: "peak_shaving",
        min_soc: 10,
        max_charge_rate: 5.0,
        charge_window_start: "01:00",
        charge_window_end: "06:00",
        discharge_window_start: "09:00",
      },
    },
  ];

  // 数据隔离：SOLFACIL_ADMIN 可查看所有组织；其他角色按 orgId 过滤
  const filtered =
    ctx.role === Role.SOLFACIL_ADMIN
      ? ALL_ASSETS
      : ALL_ASSETS.filter((a) => a.orgId === ctx.orgId);

  // 应用功能开关：按条件决定是否包含 ROI 指标
  const assets = filtered.map((a) => ({
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
