-- v5.22 Phase 3: Unique index for backfill dedup
-- MUST use CONCURRENTLY to avoid locking the partitioned telemetry table
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_telemetry_unique_asset_time
ON telemetry_history (asset_id, recorded_at);
