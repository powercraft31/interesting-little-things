#!/usr/bin/env bash
# ==========================================================================
# scripts/bootstrap.sh — One-command DB rebuild (v5.10 Dual-Role Architecture)
# Usage: ./scripts/bootstrap.sh [--drop-existing]
# ==========================================================================
set -euo pipefail

# Navigate to backend/ regardless of where the script is called from
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"
cd "$BACKEND_DIR"

DB_NAME="${DB_NAME:-solfacil_vpp}"
DB_ADMIN_USER="${DB_ADMIN_USER:-postgres}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
APP_DB_PASSWORD="${APP_DB_PASSWORD:-app_password}"
SERVICE_DB_PASSWORD="${SERVICE_DB_PASSWORD:-service_password}"

PSQL_ADMIN="psql -h $DB_HOST -p $DB_PORT -U $DB_ADMIN_USER"

echo "=== SOLFACIL VPP Database Bootstrap (v5.10 — Dual-Role Architecture) ==="

# ── Step 0: Optional drop + create ──────────────────────────────────────
if [[ "${1:-}" == "--drop-existing" ]]; then
  echo "[0/7] Dropping existing database..."
  $PSQL_ADMIN -c "DROP DATABASE IF EXISTS $DB_NAME;"
  $PSQL_ADMIN -c "CREATE DATABASE $DB_NAME;"
fi

# ── Step 1: Create dual DB roles (requires superuser) ───────────────────
echo "[1/7] Creating DB roles (solfacil_app + solfacil_service)..."
$PSQL_ADMIN -d "$DB_NAME" <<ROLES_SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'solfacil_app') THEN
    CREATE ROLE solfacil_app LOGIN PASSWORD '${APP_DB_PASSWORD}';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'solfacil_service') THEN
    CREATE ROLE solfacil_service LOGIN PASSWORD '${SERVICE_DB_PASSWORD}' BYPASSRLS;
  END IF;
END
\$\$;
GRANT CONNECT ON DATABASE ${DB_NAME} TO solfacil_app, solfacil_service;
GRANT USAGE ON SCHEMA public TO solfacil_app, solfacil_service;
ROLES_SQL

# ── Step 2: Base DDL (v5.10 consolidated schema — 19 tables) ────────────
echo "[2/7] Applying base DDL..."
$PSQL_ADMIN -d "$DB_NAME" -f scripts/ddl_base.sql

# ── Step 3: v5.4 seed + schema extensions ───────────────────────────────
echo "[3/7] Applying v5.4 seed data..."
$PSQL_ADMIN -d "$DB_NAME" -f scripts/seed_v5.4.sql

# ── Step 4: v5.5 seed data ──────────────────────────────────────────────
echo "[4/7] Applying v5.5 seed data..."
$PSQL_ADMIN -d "$DB_NAME" -f scripts/seed_v5.5.sql

# ── Step 5: v5.10 migration (dual-role RLS + performance index) ─────────
echo "[5/7] Applying v5.10 migration..."
$PSQL_ADMIN -d "$DB_NAME" -f scripts/migration_v5.10.sql

# ── Step 6: Grant table permissions after all tables exist ──────────────
echo "[6/7] Granting permissions to dual roles..."
$PSQL_ADMIN -d "$DB_NAME" -c "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO solfacil_app, solfacil_service;"
$PSQL_ADMIN -d "$DB_NAME" -c "GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO solfacil_app, solfacil_service;"

# ── Step 7: Summary ────────────────────────────────────────────────────
echo "[7/7] Verifying..."
TABLE_COUNT=$($PSQL_ADMIN -d "$DB_NAME" -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';" | tr -d ' ')
echo ""
echo "=== Bootstrap complete. Database '$DB_NAME' is ready. ==="
echo "  Tables: $TABLE_COUNT"
echo "  Roles:"
echo "    - solfacil_app:     BFF handlers (RLS enforced)"
echo "    - solfacil_service: Cron jobs (BYPASSRLS)"
