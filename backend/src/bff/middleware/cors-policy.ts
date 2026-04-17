type CorsOriginCallback = (err: Error | null, allow?: boolean) => void;

const ALLOWED_ORIGIN_PATTERN =
  /^https?:\/\/(localhost|127\.0\.0\.1|152\.42\.235\.155|188\.166\.184\.87|solfacil\.alwayscontrol\.net)(:\d+)?$/;

export function isAllowedCorsOrigin(origin?: string): boolean {
  return !origin || ALLOWED_ORIGIN_PATTERN.test(origin);
}

export function createCorsOriginValidator(): (
  origin: string | undefined,
  callback: CorsOriginCallback,
) => void {
  return (origin, callback) => {
    callback(null, isAllowedCorsOrigin(origin));
  };
}