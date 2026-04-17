-- v6.9 compatibility: restore gateways.home_alias expected by /api/gateways runtime
ALTER TABLE public.gateways
  ADD COLUMN IF NOT EXISTS home_alias character varying(100);

COMMENT ON COLUMN public.gateways.home_alias IS
  'Human-readable alias for the Home site this gateway belongs to. Nullable — fallback to gateway name.';
