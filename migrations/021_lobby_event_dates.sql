-- 021_lobby_event_dates.sql
-- Opcional: nem todo lobby precisa de janela de evento — só quem quiser
-- agendar (ex: "desafio da semana, roda de segunda a domingo").

ALTER TABLE lobbies
  ADD COLUMN starts_at TIMESTAMPTZ,
  ADD COLUMN ends_at TIMESTAMPTZ;
