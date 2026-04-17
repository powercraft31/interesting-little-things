SET row_security = off;

-- Production baseline only.
-- No demo org, no demo gateways, no test gateway.
-- Assets are preseeded because the project currently has no add-gateway flow.
-- These are identity/binding assets cloned from the existing test-gateway shape,
-- intentionally with conservative zero-capacity defaults until real device telemetry/config arrives.

INSERT INTO organizations (org_id, name, plan_tier, timezone, created_at, updated_at)
VALUES (
  'ORG_ENERGIA_001',
  'Solfacil Pilot Corp',
  'enterprise',
  'America/Sao_Paulo',
  NOW(),
  NOW()
)
ON CONFLICT (org_id) DO UPDATE
SET
  name = EXCLUDED.name,
  plan_tier = EXCLUDED.plan_tier,
  timezone = EXCLUDED.timezone,
  updated_at = NOW();

DELETE FROM tariff_schedules
WHERE org_id = 'ORG_ENERGIA_001'
  AND schedule_name IN (
    'ANEEL TOU 2025 - SP Residencial',
    'CEMIG Tarifa Branca'
  );

INSERT INTO tariff_schedules (
  org_id,
  schedule_name,
  peak_start,
  peak_end,
  peak_rate,
  offpeak_rate,
  feed_in_rate,
  intermediate_rate,
  intermediate_start,
  intermediate_end,
  disco,
  currency,
  effective_from,
  billing_power_factor
)
VALUES
  ('ORG_ENERGIA_001', 'ANEEL TOU 2025 - SP Residencial', '17:00:00', '21:59:00', 0.9521, 0.2418, 0.0, 0.4832, '16:00:00', '21:00:00', 'ANEEL', 'BRL', '2025-01-01', 0.92),
  ('ORG_ENERGIA_001', 'CEMIG Tarifa Branca', '17:00:00', '20:00:00', 0.8900, 0.2500, 0.0, 0.4100, '16:00:00', '21:00:00', 'CEMIG', 'BRL', '2026-01-01', 0.92);

INSERT INTO gateways (
  gateway_id,
  org_id,
  status,
  name,
  address
)
VALUES
  ('WKRD24070202100144F', 'ORG_ENERGIA_001', 'offline', 'Casa Silva · Home-1', 'São Paulo, SP'),
  ('WKRD24070202100228G', 'ORG_ENERGIA_001', 'offline', 'Casa Santos · Home-2', 'São Paulo, SP'),
  ('WKRD24070202100212P', 'ORG_ENERGIA_001', 'offline', 'Casa Oliveira · Home-3', 'São Paulo, SP')
ON CONFLICT (gateway_id) DO UPDATE
SET
  org_id = EXCLUDED.org_id,
  status = EXCLUDED.status,
  name = EXCLUDED.name,
  address = EXCLUDED.address,
  updated_at = NOW();

INSERT INTO assets (
  asset_id,
  org_id,
  name,
  capacity_kwh,
  submercado,
  retail_buy_rate_kwh,
  retail_sell_rate_kwh,
  asset_type,
  brand,
  model,
  serial_number,
  is_active,
  allow_export,
  gateway_id
)
VALUES
  ('WKRD24070202100144F-INV', 'ORG_ENERGIA_001', 'GoodWe-1', 0.00, 'SUDESTE', 0.8000, 0.2500, 'INVERTER_BATTERY', 'GoodWe', 'inverter-goodwe-Energystore', 'WKRD24070202100144F-INV', true, false, 'WKRD24070202100144F'),
  ('WKRD24070202100144F-SAN', 'ORG_ENERGIA_001', 'SAN-1', 0.00, 'SUDESTE', 0.8000, 0.2500, 'SMART_METER', 'Chint', 'Meter-Chint-DTSU666Three', 'WKRD24070202100144F-SAN', true, false, 'WKRD24070202100144F'),
  ('WKRD24070202100144F-ONE', 'ORG_ENERGIA_001', 'ONE-1', 0.00, 'SUDESTE', 0.8000, 0.2500, 'SMART_METER', 'Chint', 'Meter-Chint-DTSU666Single', 'WKRD24070202100144F-ONE', true, false, 'WKRD24070202100144F'),
  ('WKRD24070202100228G-INV', 'ORG_ENERGIA_001', 'GoodWe-1', 0.00, 'SUDESTE', 0.8000, 0.2500, 'INVERTER_BATTERY', 'GoodWe', 'inverter-goodwe-Energystore', 'WKRD24070202100228G-INV', true, false, 'WKRD24070202100228G'),
  ('WKRD24070202100228G-SAN', 'ORG_ENERGIA_001', 'SAN-1', 0.00, 'SUDESTE', 0.8000, 0.2500, 'SMART_METER', 'Chint', 'Meter-Chint-DTSU666Three', 'WKRD24070202100228G-SAN', true, false, 'WKRD24070202100228G'),
  ('WKRD24070202100228G-ONE', 'ORG_ENERGIA_001', 'ONE-1', 0.00, 'SUDESTE', 0.8000, 0.2500, 'SMART_METER', 'Chint', 'Meter-Chint-DTSU666Single', 'WKRD24070202100228G-ONE', true, false, 'WKRD24070202100228G'),
  ('WKRD24070202100212P-INV', 'ORG_ENERGIA_001', 'GoodWe-1', 0.00, 'SUDESTE', 0.8000, 0.2500, 'INVERTER_BATTERY', 'GoodWe', 'inverter-goodwe-Energystore', 'WKRD24070202100212P-INV', true, false, 'WKRD24070202100212P'),
  ('WKRD24070202100212P-SAN', 'ORG_ENERGIA_001', 'SAN-1', 0.00, 'SUDESTE', 0.8000, 0.2500, 'SMART_METER', 'Chint', 'Meter-Chint-DTSU666Three', 'WKRD24070202100212P-SAN', true, false, 'WKRD24070202100212P'),
  ('WKRD24070202100212P-ONE', 'ORG_ENERGIA_001', 'ONE-1', 0.00, 'SUDESTE', 0.8000, 0.2500, 'SMART_METER', 'Chint', 'Meter-Chint-DTSU666Single', 'WKRD24070202100212P-ONE', true, false, 'WKRD24070202100212P')
ON CONFLICT (asset_id) DO UPDATE
SET
  org_id = EXCLUDED.org_id,
  name = EXCLUDED.name,
  capacity_kwh = EXCLUDED.capacity_kwh,
  submercado = EXCLUDED.submercado,
  retail_buy_rate_kwh = EXCLUDED.retail_buy_rate_kwh,
  retail_sell_rate_kwh = EXCLUDED.retail_sell_rate_kwh,
  asset_type = EXCLUDED.asset_type,
  brand = EXCLUDED.brand,
  model = EXCLUDED.model,
  serial_number = EXCLUDED.serial_number,
  is_active = EXCLUDED.is_active,
  allow_export = EXCLUDED.allow_export,
  gateway_id = EXCLUDED.gateway_id,
  updated_at = NOW();
