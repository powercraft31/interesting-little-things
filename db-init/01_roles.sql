-- Create application roles
CREATE ROLE solfacil_app WITH LOGIN PASSWORD 'solfacil_vpp_2026';
CREATE ROLE solfacil_service WITH LOGIN PASSWORD 'solfacil_service_2026' BYPASSRLS;
GRANT CONNECT ON DATABASE solfacil_vpp TO solfacil_app;
GRANT CONNECT ON DATABASE solfacil_vpp TO solfacil_service;
