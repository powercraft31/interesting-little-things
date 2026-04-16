-- v5.22 Phase 3: Unique index for backfill dedup
-- Canonical local rebuild runs offline, so CONCURRENTLY is unnecessary and
-- can fail on some PostgreSQL partitioned-table setups.
CREATE UNIQUE INDEX IF NOT EXISTS idx_telemetry_unique_asset_time
ON telemetry_history (asset_id, recorded_at);
