-- 022_lobby_messages.sql

CREATE TABLE lobby_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lobby_id    UUID NOT NULL REFERENCES lobbies(id) ON DELETE CASCADE,
  sender_id   UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_lobby_messages_lobby_created ON lobby_messages(lobby_id, created_at);
