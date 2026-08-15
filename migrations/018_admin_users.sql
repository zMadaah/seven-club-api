-- 018_admin_users.sql
-- Contas do dashboard interno — deliberadamente separadas de app_users.
-- Um admin não é um "app_user com permissão especial": é outra tabela,
-- outro login, outro token. Evita qualquer chance de um usuário comum
-- acessar rota administrativa só porque compartilha o mesmo mecanismo de
-- autenticação.

CREATE TABLE admin_users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email          VARCHAR(255) UNIQUE NOT NULL,
  password_hash  TEXT NOT NULL,
  name           VARCHAR(100) NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
