#!/usr/bin/env bash
# ==========================================================================
# scripts/bootstrap.sh — Canonical local DB rebuild entrypoint
# Usage: ./scripts/bootstrap.sh [--drop-existing] [--with-demo-seed]
# Default: schema+migrations+verification only (no demo seed)
# ==========================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"
cd "$BACKEND_DIR"

DB_NAME="${DB_NAME:-solfacil_vpp}"
DB_ADMIN_USER="${DB_ADMIN_USER:-postgres}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5433}"
APP_DB_PASSWORD="${APP_DB_PASSWORD:-solfacil_vpp_2026}"
SERVICE_DB_PASSWORD="${SERVICE_DB_PASSWORD:-solfacil_service_2026}"
DROP_EXISTING=0
WITH_DEMO_SEED=0

for arg in "$@"; do
  case "$arg" in
    --drop-existing)
      DROP_EXISTING=1
      ;;
    --with-demo-seed)
      WITH_DEMO_SEED=1
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      echo "Usage: ./scripts/bootstrap.sh [--drop-existing] [--with-demo-seed]" >&2
      exit 1
      ;;
  esac
done

PSQL_ADMIN="psql -h $DB_HOST -p $DB_PORT -U $DB_ADMIN_USER"

echo "=== SOLFACIL VPP Database Bootstrap (canonical local rebuild path) ==="
echo "  Mode: schema+migrations$( [[ "$WITH_DEMO_SEED" == "1" ]] && printf '+demo-seed' )"

# ── Step 0: Optional drop + create ──────────────────────────────────────
if [[ "$DROP_EXISTING" == "1" ]]; then
  echo "[0/8] Dropping existing database..."
  $PSQL_ADMIN -c "DROP DATABASE IF EXISTS $DB_NAME;"
  $PSQL_ADMIN -c "CREATE DATABASE $DB_NAME;"
fi

# ── Step 1: Create dual DB roles (requires superuser) ───────────────────
echo "[1/8] Creating DB roles (solfacil_app + solfacil_service)..."
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
GRANT CREATE ON SCHEMA public TO solfacil_service;
ROLES_SQL

# ── Step 2: Base DDL ────────────────────────────────────────────────────
echo "[2/8] Applying base DDL..."
$PSQL_ADMIN -d "$DB_NAME" -f scripts/ddl_base.sql

# ── Step 3: v5.10 base migration ────────────────────────────────────────
echo "[3/8] Applying v5.10 migration..."
$PSQL_ADMIN -d "$DB_NAME" -f scripts/migration_v5.10.sql

# ── Step 4: Canonical ordered post-v5.10 migrations ─────────────────────
echo "[4/8] Applying canonical local migration manifest..."
DB_NAME="$DB_NAME" DB_ADMIN_USER="$DB_ADMIN_USER" DB_HOST="$DB_HOST" DB_PORT="$DB_PORT" \
  ./scripts/run-local-migrations.sh

# ── Step 5: Optional demo seed layer ────────────────────────────────────
if [[ "$WITH_DEMO_SEED" == "1" ]]; then
  echo "[5/8] Applying optional demo seed layer..."
  DB_NAME="$DB_NAME" DB_ADMIN_USER="$DB_ADMIN_USER" DB_HOST="$DB_HOST" DB_PORT="$DB_PORT" \
    bash ./scripts/apply-demo-seeds.sh
else
  echo "[5/8] Skipping optional demo seed layer (schema-only rebuild)."
fi

# ── Step 6: Grant table permissions after all tables exist ──────────────
echo "[6/8] Granting permissions to dual roles..."
$PSQL_ADMIN -d "$DB_NAME" -c "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO solfacil_app, solfacil_service;"
$PSQL_ADMIN -d "$DB_NAME" -c "GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO solfacil_app, solfacil_service;"

# ── Step 7: Contract verifier ────────────────────────────────────────────
echo "[7/8] Running local DB contract verifier..."
SERVICE_DATABASE_URL="postgresql://solfacil_service:${SERVICE_DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}" \
  npx ts-node scripts/verify-local-db-contract.ts

# ── Step 8: Summary ─────────────────────────────────────────────────────
echo "[8/8] Verifying..."
TABLE_COUNT=$($PSQL_ADMIN -d "$DB_NAME" -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';" | tr -d ' ')
echo ""
echo "=== Bootstrap complete. Database '$DB_NAME' is ready. ==="
echo "  Tables: $TABLE_COUNT"
echo "  Roles:"
echo "    - solfacil_app:     BFF handlers (RLS enforced)"
echo "    - solfacil_service: Cron jobs (BYPASSRLS)"
echo "  Canonical migration manifest: backend/scripts/local-migration-manifest.txt"
echo "  Demo seed layer: $( [[ "$WITH_DEMO_SEED" == "1" ]] && printf 'enabled' || printf 'disabled' )"
echo "  Contract verifier: backend/scripts/verify-local-db-contract.ts"
