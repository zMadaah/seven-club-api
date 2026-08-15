-- 016_profile_privacy_referrals.sql

ALTER TABLE app_users
  ADD COLUMN first_name          VARCHAR(100),
  ADD COLUMN last_name           VARCHAR(100),
  ADD COLUMN date_of_birth       DATE,
  ADD COLUMN gender              VARCHAR(20),
  ADD COLUMN profile_color       VARCHAR(7),
  ADD COLUMN profile_visibility  VARCHAR(10) NOT NULL DEFAULT 'followers',
  ADD COLUMN map_visibility      VARCHAR(10) NOT NULL DEFAULT 'everyone',
  ADD COLUMN referral_code       VARCHAR(10) UNIQUE,
  ADD COLUMN referred_by         UUID REFERENCES app_users(id) ON DELETE SET NULL;

ALTER TABLE app_users
  ADD CONSTRAINT chk_app_users_profile_visibility CHECK (profile_visibility IN ('public', 'followers')),
  ADD CONSTRAINT chk_app_users_map_visibility CHECK (map_visibility IN ('everyone', 'crew', 'nobody'));

-- Bloqueio é intencionalmente separado de "follows": bloquear alguém que
-- te segue não deveria só parar de seguir, deveria impedir contato dos
-- dois lados. Fica registrado à parte pra isso ficar explícito.
CREATE TABLE blocked_users (
  blocker_id  UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  blocked_id  UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT chk_no_self_block CHECK (blocker_id <> blocked_id)
);

CREATE INDEX idx_blocked_users_blocked ON blocked_users(blocked_id);
