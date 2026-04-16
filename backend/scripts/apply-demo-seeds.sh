#!/usr/bin/env bash
# ==========================================================================
# scripts/apply-demo-seeds.sh — Optional demo/dev seed layer for local rebuilds
# Usage: ./scripts/apply-demo-seeds.sh
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
PSQL_ADMIN="psql -h $DB_HOST -p $DB_PORT -U $DB_ADMIN_USER"

echo "[demo-seeds] Applying v5.4 demo seed data..."
$PSQL_ADMIN -d "$DB_NAME" -f scripts/seed_v5.4.sql

echo "[demo-seeds] Applying v5.5 demo seed data..."
$PSQL_ADMIN -d "$DB_NAME" -f scripts/seed_v5.5.sql

echo "[demo-seeds] Complete."
