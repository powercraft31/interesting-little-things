-- rollback_v7.0.sql
-- Reverts migration_v7.0.sql changes (except COMMENTs which are harmless)

BEGIN;

-- 1. Migrate any ESS rows back before dropping the value from CHECK
UPDATE public.assets SET asset_type = 'INVERTER_BATTERY' WHERE asset_type = 'ESS';

-- 2. Drop alarm table
DROP TABLE IF EXISTS public.gateway_alarm_events CASCADE;

-- 3. Restore original CHECK constraint
ALTER TABLE public.assets DROP CONSTRAINT IF EXISTS assets_asset_type_check;
ALTER TABLE public.assets ADD CONSTRAINT assets_asset_type_check
  CHECK (asset_type IN ('INVERTER_BATTERY', 'SMART_METER', 'HVAC', 'EV_CHARGER', 'SOLAR_PANEL'));

-- 4. COMMENTs are not rolled back (harmless, can stay)

COMMIT;
