-- 015_lobbies.sql
-- Lobby privado: criado por um usuário, outros entram por código de
-- convite. O criador não entra na lista de members — fica só em
-- creator_id, espelhando como o app já modela isso (CreateLobby cria com
-- members: [] mesmo sendo o dono).

CREATE TABLE lobbies (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                      VARCHAR(150) NOT NULL,
  picture_url               TEXT,
  creator_id                UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  allow_previous_imports    BOOLEAN NOT NULL DEFAULT TRUE,
  allow_member_invitations  BOOLEAN NOT NULL DEFAULT FALSE,
  in_game_chat_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  max_lobby_size            INTEGER,
  invite_code               VARCHAR(6) NOT NULL UNIQUE,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_lobbies_creator ON lobbies(creator_id);

CREATE TABLE lobby_members (
  lobby_id   UUID NOT NULL REFERENCES lobbies(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (lobby_id, user_id)
);

CREATE INDEX idx_lobby_members_user ON lobby_members(user_id);
