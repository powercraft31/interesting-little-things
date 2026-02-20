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
