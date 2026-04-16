#!/usr/bin/env bash
# ==========================================================================
# scripts/run-local-migrations.sh — Canonical ordered local DB migration runner
# Usage: ./scripts/run-local-migrations.sh
# Env:
#   DB_NAME, DB_ADMIN_USER, DB_HOST, DB_PORT
# ==========================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(dirname "$BACKEND_DIR")"
cd "$REPO_ROOT"

DB_NAME="${DB_NAME:-solfacil_vpp}"
DB_ADMIN_USER="${DB_ADMIN_USER:-postgres}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5433}"
MANIFEST_PATH="${MANIFEST_PATH:-$BACKEND_DIR/scripts/local-migration-manifest.txt}"
PSQL_ADMIN=(psql -v ON_ERROR_STOP=1 -h "$DB_HOST" -p "$DB_PORT" -U "$DB_ADMIN_USER" -d "$DB_NAME")

if [[ ! -f "$MANIFEST_PATH" ]]; then
  echo "[local-migrations] Manifest not found: $MANIFEST_PATH" >&2
  exit 1
fi

echo "[local-migrations] Using manifest: $MANIFEST_PATH"

applied=0
skipped=0
while IFS='|' read -r classification relpath; do
  # Skip blanks/comments
  if [[ -z "${classification// }" ]] || [[ "${classification:0:1}" == "#" ]]; then
    continue
  fi

  relpath="${relpath## }"
  abs_path="$REPO_ROOT/$relpath"
  if [[ ! -f "$abs_path" ]]; then
    echo "[local-migrations] Missing file: $abs_path" >&2
    exit 1
  fi

  echo "[local-migrations] Applying [$classification] $relpath"
  "${PSQL_ADMIN[@]}" -f "$abs_path"
  applied=$((applied + 1))
done < "$MANIFEST_PATH"

echo "[local-migrations] Complete. applied=$applied skipped=$skipped"
