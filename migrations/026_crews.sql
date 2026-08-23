-- 026_crews.sql

CREATE TABLE crews (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                      VARCHAR(150) NOT NULL,
  picture_url               TEXT,
  city                      VARCHAR(100) NOT NULL,
  is_public                 BOOLEAN NOT NULL DEFAULT true,
  creator_id                UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  allow_previous_imports    BOOLEAN NOT NULL DEFAULT true,
  allow_member_invitations  BOOLEAN NOT NULL DEFAULT true,
  in_game_chat_enabled      BOOLEAN NOT NULL DEFAULT true,
  max_crew_size             INTEGER,
  -- numérico puro (6 dígitos) — diferente do código alfanumérico do
  -- lobby, de propósito: a tela de entrar usa OtpCodeInput, um
  -- componente compartilhado que só aceita dígito (mesmo usado na
  -- verificação de SMS/e-mail do cadastro) — trocar isso globalmente
  -- pra aceitar letra arriscava quebrar aquele outro fluxo.
  invite_code               VARCHAR(6) NOT NULL UNIQUE,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE crew_members (
  crew_id     UUID NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (crew_id, user_id)
);

CREATE INDEX idx_crew_members_user ON crew_members(user_id);

CREATE TABLE crew_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crew_id     UUID NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
  sender_id   UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_crew_messages_crew_created ON crew_messages(crew_id, created_at);
