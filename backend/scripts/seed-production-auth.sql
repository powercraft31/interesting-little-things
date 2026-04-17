-- Production auth baseline only.
-- Keeps the production admin identity and intentionally omits Alan/demo auth rows.
-- Requires psql variable ADMIN_PASSWORD_HASH to be injected by the operator.

INSERT INTO users (user_id, email, name, hashed_password, is_active)
VALUES (
  'USER_ADMIN_001',
  'admin@solfacil.com.br',
  'Solfacil Admin',
  :'ADMIN_PASSWORD_HASH',
  true
)
ON CONFLICT (user_id) DO UPDATE SET
  email = EXCLUDED.email,
  name = EXCLUDED.name,
  hashed_password = EXCLUDED.hashed_password,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();

INSERT INTO user_org_roles (user_id, org_id, role)
VALUES ('USER_ADMIN_001', 'ORG_ENERGIA_001', 'SOLFACIL_ADMIN')
ON CONFLICT (user_id, org_id) DO UPDATE SET
  role = EXCLUDED.role;
