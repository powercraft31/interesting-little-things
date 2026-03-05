-- ==========================================================================
-- DEPRECATED (v5.10): This file references non-existent columns
-- (organizations.metadata, assets.metadata). These columns were removed in
-- v5.4 when PostgreSQL replaced DynamoDB. Do NOT run this file.
-- Use scripts/bootstrap.sh instead, which runs seed_v5.4.sql + seed_v5.5.sql.
-- ==========================================================================
-- Seed Data — Rich metadata for demo / integration tests (DEPRECATED)
-- ==========================================================================

-- ── Organization metadata ─────────────────────────────────────────────────
UPDATE organizations SET metadata = '{
  "tier": "enterprise",
  "country": "BR",
  "timezone": "America/Sao_Paulo",
  "contact": { "name": "Carlos Silva", "email": "carlos@energia-solar.com.br" }
}'::jsonb WHERE org_id = 'ORG_ENERGIA_001';

-- ── Asset metadata (hardware specs + geo) ─────────────────────────────────
UPDATE assets SET metadata = '{
  "geo": { "lat": -23.5505, "lng": -46.6333, "region": "SP" },
  "hardware": {
    "inverterModel": "SUN2000-100KTL-M1",
    "batteryModel": "LUNA2000-200KWH-2H",
    "manufacturer": "Huawei"
  },
  "warranty": { "expiresAt": "2030-06-30", "years": 10 },
  "commissioning": "2024-03-15"
}'::jsonb WHERE asset_id = 'ASSET_SP_001';

UPDATE assets SET metadata = '{
  "geo": { "lat": -22.9068, "lng": -43.1729, "region": "RJ" },
  "hardware": {
    "inverterModel": "SG250HX",
    "batteryModel": "SBR096",
    "manufacturer": "Sungrow"
  },
  "warranty": { "expiresAt": "2031-12-31", "years": 10 },
  "commissioning": "2024-07-22"
}'::jsonb WHERE asset_id = 'ASSET_RJ_002';
