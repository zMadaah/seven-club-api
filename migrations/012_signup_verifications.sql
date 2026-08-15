-- 012_signup_verifications.sql
-- Suporta o cadastro em 3 etapas: 1) nome/e-mail/celular, 2) validação de
-- código, 3) criação de senha. Guarda o cadastro pendente até a senha ser
-- definida — só aí uma linha em app_users é criada de verdade.

CREATE TABLE signup_verifications (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           VARCHAR(100) NOT NULL,
  email          VARCHAR(255) NOT NULL,
  phone          VARCHAR(20) NOT NULL,
  code_hash      TEXT NOT NULL,
  attempts       INTEGER NOT NULL DEFAULT 0,
  verified_at    TIMESTAMPTZ,
  expires_at     TIMESTAMPTZ NOT NULL,
  last_sent_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_signup_verifications_email ON signup_verifications(email);
