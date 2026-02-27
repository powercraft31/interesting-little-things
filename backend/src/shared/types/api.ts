// ---------------------------------------------------------------------------
// 领域实体
// ---------------------------------------------------------------------------

export interface Organization {
  readonly orgId: string;
  readonly name: string;
  readonly planTier: string;
  readonly metadata?: Record<string, unknown>; // JSONB 灵活扩展字段
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Asset {
  readonly assetId: string;
  readonly orgId: string;
  readonly deviceType: string;
  readonly ratedPowerKw: number;
  readonly location: string | null;
  readonly status: string;
  readonly metadata?: Record<string, unknown>; // JSONB 灵活扩展字段
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ---------------------------------------------------------------------------
// API 响应信封
// ---------------------------------------------------------------------------

/**
 * 统一 API 响应信封。
 * 所有 BFF handler 返回此结构。
 */
export interface ApiResponse<T = unknown> {
  readonly success: boolean;
  readonly data: T | null;
  readonly error: string | null;
  readonly timestamp: string;
}

/** 成功响应工厂函数 */
export function ok<T>(data: T): ApiResponse<T> {
  return {
    success: true,
    data,
    error: null,
    timestamp: new Date().toISOString(),
  };
}

/** 错误响应工厂函数 */
export function fail(message: string): ApiResponse<null> {
  return {
    success: false,
    data: null,
    error: message,
    timestamp: new Date().toISOString(),
  };
}

// ==========================================
// M8 Admin 控制面板类型定义
// ==========================================

export interface DeviceParserRule {
  readonly id: string;
  readonly orgId: string;
  readonly manufacturer: string;
  readonly modelVersion: string;
  readonly mappingRule: Record<string, string>;
  readonly unitConversions: Record<string, { factor: number; offset?: number }>;
  readonly isActive: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface VppStrategy {
  readonly id: string;
  readonly orgId: string;
  readonly strategyName: string;
  readonly minSoc: number;
  readonly maxSoc: number;
  readonly emergencySoc: number;
  readonly profitMargin: number;
  readonly activeHours: { start: number; end: number };
  readonly activeWeekdays: number[];
  readonly isDefault: boolean;
  readonly isActive: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// 请求负载
export interface CreateDeviceParserRuleRequest {
  readonly manufacturer: string;
  readonly modelVersion?: string;
  readonly mappingRule: Record<string, string>;
  readonly unitConversions?: Record<
    string,
    { factor: number; offset?: number }
  >;
  readonly isActive?: boolean;
}

export interface UpdateVppStrategyRequest {
  readonly strategyName?: string;
  readonly minSoc?: number;
  readonly maxSoc?: number;
  readonly emergencySoc?: number;
  readonly profitMargin?: number;
  readonly activeHours?: { start: number; end: number };
  readonly activeWeekdays?: number[];
  readonly isDefault?: boolean;
  readonly isActive?: boolean;
}

export interface CreateVppStrategyRequest {
  readonly strategyName: string;
  readonly minSoc: number;
  readonly maxSoc: number;
  readonly emergencySoc: number;
  readonly profitMargin?: number;
  readonly activeHours?: { start: number; end: number };
  readonly activeWeekdays?: number[];
  readonly isDefault?: boolean;
}

// 响应信封（M8 Admin API 格式）
export interface AdminListResponse<T> {
  readonly data: T[];
  readonly total: number;
  readonly orgId: string;
}

export interface AdminItemResponse<T> {
  readonly data: T;
  readonly orgId: string;
}

// ==========================================
// M1 Dynamic Parser Engine 类型定义
// ==========================================

export interface ParserRuleMapping {
  readonly domain: "metering" | "status" | "config";
  readonly sourcePath: string; // e.g. "properties.bat_soc"
  readonly valueType: "number" | "string" | "boolean";
}

export interface ParserRule {
  readonly parserType: "dynamic";
  readonly iterator?: string; // e.g. "data.batList" — split one message into N StandardTelemetry
  readonly deviceIdPath?: string; // path inside each iterator item, e.g. "id"
  readonly mappings: {
    readonly [fieldId: string]: ParserRuleMapping;
  };
}

// ==========================================
// v5.3 HEMS 單戶場景核心類型
// ==========================================

/**
 * AssetRecord v5.3 — HEMS 單戶家庭場景
 * 取代舊版 Asset 介面中的聚合器欄位（unidades）
 * 三層嵌套結構與 StandardTelemetry Business Trilogy 保持一致
 */
export interface AssetRecord {
  readonly assetId: string;
  readonly orgId: string;
  readonly region: string;
  readonly capacidade: number; // kW 逆變器額定功率
  readonly capacity_kwh: number; // kWh 電池系統裝機容量（取代 unidades）
  readonly operationalStatus: string; // 'operando' | 'carregando' | 'offline'
  readonly metering: {
    pv_power: number; // kW
    battery_power: number; // kW，正=充電，負=放電
    grid_power_kw: number; // kW，正=買電，負=賣電
    load_power: number; // kW
    grid_import_kwh: number; // kWh 今日
    grid_export_kwh: number; // kWh 今日
    pv_daily_energy: number; // kWh 今日
    bat_charged_today: number; // kWh
    bat_discharged_today: number; // kWh
  };
  readonly status: {
    battery_soc: number; // % 電量百分比
    bat_soh: number; // % 電池健康度
    bat_work_status: "charging" | "discharging" | "idle";
    battery_voltage: number; // V
    bat_cycle_count: number;
    inverter_temp: number; // °C
    is_online: boolean;
    grid_frequency: number; // Hz
  };
  readonly config: {
    target_mode: string;
    min_soc: number; // %
    max_charge_rate: number; // kW
    charge_window_start: string; // 'HH:MM'
    charge_window_end: string;
    discharge_window_start: string;
  };
}

/**
 * DashboardMetrics v5.3
 * M5 BFF 聚合各模組數據後回傳的儀表板 KPI
 */
export interface DashboardMetrics {
  readonly orgId: string;
  readonly totalAssets: number;
  readonly onlineAssets: number;
  readonly avgSoc: number; // % 平均電池 SoC
  readonly totalPowerKw: number; // kW 聚合功率
  readonly dailyRevenueReais: number; // R$ 今日收益
  readonly monthlyRevenueReais: number; // R$ 月度收益
  readonly vppDispatchAccuracy?: number; // % VPP 調度精準率
  readonly drResponseLatency?: number; // s DR 響應延遲
  readonly gatewayUptime?: number; // % 閘道器在線率
  readonly dispatchSuccessRate?: string; // e.g. "156/160" 成功/總次數
}
