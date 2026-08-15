-- 017_progress_xp_badges_seasons.sql

-- Razão (ledger) de XP: cada linha é um evento que concedeu XP, nunca é
-- editada depois de criada. Nível/EXP são sempre SOMA desta tabela, nunca
-- um contador solto — evita XP duplicado e dá pra auditar/recalcular.
CREATE TABLE xp_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  source      VARCHAR(30) NOT NULL, -- 'badge_unlock' | 'challenge_claim'
  source_id   VARCHAR(30) NOT NULL, -- id da insígnia/desafio que gerou o XP
  amount      INTEGER NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- mesma fonte não pode conceder XP duas vezes pro mesmo usuário
  UNIQUE (user_id, source, source_id)
);

CREATE INDEX idx_xp_events_user_id ON xp_events(user_id);

CREATE TABLE seasons (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number     INTEGER NOT NULL UNIQUE,
  name       VARCHAR(100) NOT NULL,
  starts_at  TIMESTAMPTZ NOT NULL,
  ends_at    TIMESTAMPTZ NOT NULL
);

INSERT INTO seasons (number, name, starts_at, ends_at)
VALUES (1, 'Temporada 1', '2026-07-01T00:00:00Z', '2026-09-30T23:59:59Z');

-- Insígnias: o catálogo (nome/descrição/ícone) mora no app, o backend só
-- sabe se está desbloqueada e desde quando — por isso não existe uma
-- tabela "badges" aqui, só o registro de desbloqueio.
CREATE TABLE badge_unlocks (
  user_id      UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  badge_id     VARCHAR(20) NOT NULL, -- b1..b6, mesmo id do catálogo no app
  season_id    UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  unlocked_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, badge_id, season_id)
);

CREATE TABLE challenge_claims (
  user_id       UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  challenge_id  VARCHAR(20) NOT NULL, -- c1..c3, mesmo id do catálogo no app
  claimed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, challenge_id)
);

ALTER TABLE app_users
  ADD COLUMN featured_badge_id VARCHAR(20);
