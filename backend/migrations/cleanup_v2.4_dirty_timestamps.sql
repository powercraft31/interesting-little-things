-- cleanup_v2.4_dirty_timestamps.sql
-- Run AFTER migration_v7.0.sql and BEFORE M1 v7.0 deployment.
-- Idempotent: safe to run multiple times.
-- On dev new-home: data already TRUNCATED, this is a no-op.
-- On production: this cleans up 1970 dirty timestamps from V1.x parseInt() bug.

BEGIN;

-- Phase 1: Clean telemetry_history (1970 data in default partition)
DELETE FROM public.telemetry_history
WHERE recorded_at < '1971-01-01'::timestamptz;

-- Phase 2+3: Clean gateways (merged into single UPDATE per REVIEW-10 [DIRTY-01])
UPDATE public.gateways SET
  last_seen_at  = CASE WHEN last_seen_at  < '1971-01-01'::timestamptz THEN NULL ELSE last_seen_at  END,
  ems_health_at = CASE WHEN ems_health_at < '1971-01-01'::timestamptz THEN NULL ELSE ems_health_at END,
  updated_at    = NOW()
WHERE last_seen_at < '1971-01-01'::timestamptz
   OR ems_health_at < '1971-01-01'::timestamptz;

-- Phase 4: Clean device_command_logs
UPDATE public.device_command_logs SET device_timestamp = NULL
WHERE device_timestamp < '1971-01-01'::timestamptz;

-- Phase 5: Verify (raise exception if dirty data remains)
DO $$
DECLARE
  cnt BIGINT;
BEGIN
  SELECT COUNT(*) INTO cnt FROM public.telemetry_history WHERE recorded_at < '1971-01-01'::timestamptz;
  IF cnt > 0 THEN RAISE EXCEPTION 'Dirty telemetry_history remaining: %', cnt; END IF;

  SELECT COUNT(*) INTO cnt FROM public.gateways WHERE last_seen_at < '1971-01-01'::timestamptz;
  IF cnt > 0 THEN RAISE EXCEPTION 'Dirty gateways.last_seen_at remaining: %', cnt; END IF;

  SELECT COUNT(*) INTO cnt FROM public.gateways WHERE ems_health_at < '1971-01-01'::timestamptz;
  IF cnt > 0 THEN RAISE EXCEPTION 'Dirty gateways.ems_health_at remaining: %', cnt; END IF;

  SELECT COUNT(*) INTO cnt FROM public.device_command_logs WHERE device_timestamp < '1971-01-01'::timestamptz;
  IF cnt > 0 THEN RAISE EXCEPTION 'Dirty device_command_logs remaining: %', cnt; END IF;

  RAISE NOTICE 'All dirty timestamp cleanup verified successfully';
END $$;

COMMIT;
