#!/usr/bin/env bash
# ==========================================================================
# scripts/apply-production-seeds.sh — Production baseline seed layer
# Usage: ./scripts/apply-production-seeds.sh
# Env:
#   DB_NAME, DB_ADMIN_USER, DB_HOST, DB_PORT
# ==========================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"
cd "$BACKEND_DIR"

DB_NAME="${DB_NAME:-solfacil_vpp}"
DB_ADMIN_USER="${DB_ADMIN_USER:-postgres}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5433}"
ADMIN_PASSWORD_HASH="${ADMIN_PASSWORD_HASH:-}"
PSQL_ADMIN="psql -v ON_ERROR_STOP=1 -h $DB_HOST -p $DB_PORT -U $DB_ADMIN_USER"

if [[ -z "$ADMIN_PASSWORD_HASH" ]]; then
  echo "[production-seeds] ADMIN_PASSWORD_HASH is required." >&2
  exit 1
fi

echo "[production-seeds] Applying production baseline seed..."
$PSQL_ADMIN -d "$DB_NAME" -f scripts/seed-production-baseline.sql

echo "[production-seeds] Applying production auth seed..."
$PSQL_ADMIN -v ADMIN_PASSWORD_HASH="$ADMIN_PASSWORD_HASH" -d "$DB_NAME" -f scripts/seed-production-auth.sql

echo "[production-seeds] Complete."
