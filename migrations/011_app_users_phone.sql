-- 011_app_users_phone.sql
-- Celular passa a fazer parte do cadastro (etapa 1 do fluxo de signup:
-- nome, e-mail, celular).

ALTER TABLE app_users
  ADD COLUMN phone VARCHAR(20),
  ADD COLUMN phone_verified BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX idx_app_users_phone ON app_users(phone) WHERE phone IS NOT NULL;
