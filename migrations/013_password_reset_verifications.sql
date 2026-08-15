-- 013_password_reset_verifications.sql
-- Suporta "esqueci a senha": código de 6 dígitos por e-mail ou celular,
-- depois nova senha. user_id fica nulo quando o contato informado não
-- corresponde a nenhuma conta — isso existe de propósito (ver
-- password-reset.service.ts): a resposta da API é idêntica em ambos os
-- casos, pra não revelar se um e-mail/celular tem conta ou não.

CREATE TABLE password_reset_verifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES app_users(id) ON DELETE CASCADE,
  channel       VARCHAR(10) NOT NULL CHECK (channel IN ('email', 'phone')),
  code_hash     TEXT NOT NULL,
  attempts      INTEGER NOT NULL DEFAULT 0,
  verified_at   TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ NOT NULL,
  last_sent_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_password_reset_verifications_user ON password_reset_verifications(user_id);
