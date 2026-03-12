SET row_security = off;

-- Organizations
INSERT INTO organizations VALUES ('ORG_ENERGIA_001', 'Solfacil Pilot Corp', 'ENTERPRISE', 'America/Sao_Paulo', NOW(), NOW());

-- Gateways (4 real XuHeng gateways)
INSERT INTO gateways (gateway_id, org_id, mqtt_broker_host, mqtt_broker_port, mqtt_username, mqtt_password, device_name, product_key, status, name, address) VALUES
  ('WKRD24070202100144F', 'ORG_ENERGIA_001', '18.141.63.142', 1883, 'xuheng', 'xuheng8888!', 'EMS_N2', 'ems', 'offline', 'Casa Silva · Home-1', 'São Paulo, SP'),
  ('WKRD24070202100228G', 'ORG_ENERGIA_001', '18.141.63.142', 1883, 'xuheng', 'xuheng8888!', 'EMS_N2', 'ems', 'offline', 'Casa Santos · Home-2', 'São Paulo, SP'),
  ('WKRD24070202100212P', 'ORG_ENERGIA_001', '18.141.63.142', 1883, 'xuheng', 'xuheng8888!', 'EMS_N2', 'ems', 'offline', 'Casa Oliveira · Home-3', 'São Paulo, SP'),
  ('WKRD24070202100141I', 'ORG_ENERGIA_001', '18.141.63.142', 1883, 'xuheng', 'xuheng8888!', 'EMS_N2', 'ems', 'offline', 'Test Gateway', NULL);

-- Tariff schedules
INSERT INTO tariff_schedules (org_id, schedule_name, peak_start, peak_end, peak_rate, offpeak_rate, feed_in_rate, intermediate_rate, intermediate_start, intermediate_end, disco, currency, effective_from, billing_power_factor) VALUES
  ('ORG_ENERGIA_001', 'ANEEL TOU 2025 - SP Residencial', '17:00:00', '21:59:00', 0.9521, 0.2418, 0.0, 0.4832, '16:00:00', '21:00:00', 'ANEEL', 'BRL', '2025-01-01', 0.92),
  ('ORG_ENERGIA_001', 'CEMIG Tarifa Branca', '17:00:00', '20:00:00', 0.8900, 0.2500, 0.0, 0.4100, '16:00:00', '21:00:00', 'CEMIG', 'BRL', '2026-01-01', 0.92);
