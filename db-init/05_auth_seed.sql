-- v5.23: Seed admin users for JWT auth
-- Password: solfacil2026 (bcrypt 12 rounds)

INSERT INTO users (user_id, email, name, hashed_password, is_active)
VALUES
  ('USER_ADMIN_001', 'admin@solfacil.com.br', 'Solfacil Admin',
   '$2b$12$VOnQl5nJaZVOO9gXkP5aU.R1WwEFvWdcz3mCdmjt0XcveWl8JefKO', true),
  ('USER_ALAN_001', 'alan@xuheng.com', 'Alan Xu',
   '$2b$12$VOnQl5nJaZVOO9gXkP5aU.R1WwEFvWdcz3mCdmjt0XcveWl8JefKO', true)
ON CONFLICT (user_id) DO UPDATE SET
  hashed_password = EXCLUDED.hashed_password,
  updated_at = NOW();

INSERT INTO user_org_roles (user_id, org_id, role)
VALUES
  ('USER_ADMIN_001', 'ORG_ENERGIA_001', 'SOLFACIL_ADMIN'),
  ('USER_ALAN_001', 'ORG_ENERGIA_001', 'SOLFACIL_ADMIN')
ON CONFLICT (user_id, org_id) DO UPDATE SET role = EXCLUDED.role;
