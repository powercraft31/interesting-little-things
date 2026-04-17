#!/usr/bin/env bash
# ==========================================================================
# scripts/bootstrap-production.sh — Reset Solfacil DB to clean production baseline
# Usage: ./scripts/bootstrap-production.sh
# Env:
#   DB_NAME, DB_ADMIN_USER, DB_HOST, DB_PORT, APP_DB_PASSWORD, SERVICE_DB_PASSWORD
# ==========================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"
cd "$BACKEND_DIR"

DB_NAME="${DB_NAME:-solfacil_vpp}"
DB_ADMIN_USER="${DB_ADMIN_USER:-postgres}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5433}"
SERVICE_DB_PASSWORD="${SERVICE_DB_PASSWORD:-solfacil_service_2026}"
ADMIN_PASSWORD_HASH="${ADMIN_PASSWORD_HASH:-}"

if [[ -z "$ADMIN_PASSWORD_HASH" ]]; then
  echo "[prod-bootstrap] ADMIN_PASSWORD_HASH is required." >&2
  exit 1
fi

echo "[prod-bootstrap] Rebuilding schema+migrations via canonical bootstrap..."
DB_NAME="$DB_NAME" DB_ADMIN_USER="$DB_ADMIN_USER" DB_HOST="$DB_HOST" DB_PORT="$DB_PORT" \
  bash ./scripts/bootstrap.sh --drop-existing

echo "[prod-bootstrap] Applying production-only seed layer..."
DB_NAME="$DB_NAME" DB_ADMIN_USER="$DB_ADMIN_USER" DB_HOST="$DB_HOST" DB_PORT="$DB_PORT" ADMIN_PASSWORD_HASH="$ADMIN_PASSWORD_HASH" \
  bash ./scripts/apply-production-seeds.sh

echo "[prod-bootstrap] Re-running contract verifier on seeded production baseline..."
SERVICE_DATABASE_URL="postgresql://solfacil_service:${SERVICE_DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}" \
  npx ts-node scripts/verify-local-db-contract.ts

echo "[prod-bootstrap] Complete. Production baseline is ready for application acceptance."
