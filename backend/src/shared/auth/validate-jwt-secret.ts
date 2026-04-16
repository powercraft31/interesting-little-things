/**
 * Startup JWT secret validation — v6.9 B2 Secret Fail-Fast.
 *
 * Call once at process startup. Throws immediately if:
 *   - JWT_SECRET is missing or empty (any mode)
 *   - JWT_SECRET is a known weak/legacy placeholder in non-dev mode
 *
 * Returns the validated secret string for convenience.
 */

const LEGACY_PLACEHOLDERS = new Set([
  "solfacil-dev-secret",
]);

export function validateJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();

  if (!secret) {
    throw new Error(
      "FATAL: JWT_SECRET environment variable is missing or empty. " +
      "Set JWT_SECRET before starting the server.",
    );
  }

  const isDev = process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";

  if (!isDev && LEGACY_PLACEHOLDERS.has(secret)) {
    throw new Error(
      "FATAL: JWT_SECRET is set to a weak legacy placeholder. " +
      "Use a strong, unique secret in non-development environments.",
    );
  }

  return secret;
}
