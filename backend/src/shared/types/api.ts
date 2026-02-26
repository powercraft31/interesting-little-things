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
