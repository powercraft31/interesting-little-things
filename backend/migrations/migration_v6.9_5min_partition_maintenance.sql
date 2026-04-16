-- ============================================================
-- migration_v6.9_5min_partition_maintenance.sql
-- Ensure solfacil_service can maintain asset_5min_metrics partitions at runtime
-- ============================================================

GRANT CREATE ON SCHEMA public TO solfacil_service;
ALTER TABLE IF EXISTS asset_5min_metrics OWNER TO solfacil_service;

DO $$
DECLARE
  partition_table TEXT;
BEGIN
  FOR partition_table IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_inherits i ON i.inhrelid = c.oid
    JOIN pg_class p ON p.oid = i.inhparent
    WHERE p.relname = 'asset_5min_metrics'
  LOOP
    EXECUTE format('ALTER TABLE %I OWNER TO solfacil_service', partition_table);
  END LOOP;
END $$;
