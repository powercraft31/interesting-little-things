// ---------------------------------------------------------------------------
// Domain entities
// ---------------------------------------------------------------------------

export interface Organization {
  readonly orgId: string;
  readonly name: string;
  readonly planTier: string;
  readonly metadata?: Record<string, unknown>; // JSONB flexible extension slot
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
  readonly metadata?: Record<string, unknown>; // JSONB flexible extension slot
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ---------------------------------------------------------------------------
// API response envelope
// ---------------------------------------------------------------------------

/**
 * Shared API response envelope.
 * All BFF handlers return this shape.
 */
export interface ApiResponse<T = unknown> {
  readonly success: boolean;
  readonly data: T | null;
  readonly error: string | null;
  readonly timestamp: string;
}

/** Convenience factory for success responses */
export function ok<T>(data: T): ApiResponse<T> {
  return {
    success: true,
    data,
    error: null,
    timestamp: new Date().toISOString(),
  };
}

/** Convenience factory for error responses */
export function fail(message: string): ApiResponse<null> {
  return {
    success: false,
    data: null,
    error: message,
    timestamp: new Date().toISOString(),
  };
}

// ==========================================
// M8 Admin Control Plane Types
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

// Request payloads
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

// Response envelopes (M8 Admin API shape)
export interface AdminListResponse<T> {
  readonly data: T[];
  readonly total: number;
  readonly orgId: string;
}

export interface AdminItemResponse<T> {
  readonly data: T;
  readonly orgId: string;
}
