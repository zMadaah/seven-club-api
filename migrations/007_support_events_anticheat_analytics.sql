-- 007_support_events_anticheat_analytics.sql
-- Módulos restantes: suporte/chat, eventos, anti-cheat e analytics.

-- Suporte -------------------------------------------------------------

CREATE TABLE support_tickets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  subject     VARCHAR(200) NOT NULL,
  status      VARCHAR(20) NOT NULL DEFAULT 'open', -- open, pending, resolved, closed
  priority    VARCHAR(10) NOT NULL DEFAULT 'normal',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE support_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  sender_type VARCHAR(10) NOT NULL, -- user, admin
  sender_id   UUID,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_support_tickets_user_id ON support_tickets(user_id);
CREATE INDEX idx_support_tickets_status ON support_tickets(status);
CREATE INDEX idx_support_messages_ticket_id ON support_messages(ticket_id);

-- Eventos -------------------------------------------------------------

CREATE TABLE events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         VARCHAR(150) NOT NULL,
  description  TEXT,
  starts_at    TIMESTAMPTZ NOT NULL,
  ends_at      TIMESTAMPTZ NOT NULL,
  region       VARCHAR(100),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE event_participants (
  event_id   UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id)
);

-- Anti-cheat ------------------------------------------------------------

CREATE TABLE anticheat_flags (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id   UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  flag_type     VARCHAR(50) NOT NULL, -- speed_impossible, teleport, gps_jump, duplicate_route
  severity      VARCHAR(10) NOT NULL DEFAULT 'low', -- low, medium, high
  status        VARCHAR(20) NOT NULL DEFAULT 'pending_review', -- pending_review, confirmed, dismissed
  detected_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at   TIMESTAMPTZ,
  reviewed_by   UUID
);

CREATE INDEX idx_anticheat_flags_activity ON anticheat_flags(activity_id);
CREATE INDEX idx_anticheat_flags_status ON anticheat_flags(status);

-- Analytics ---------------------------------------------------------------

CREATE TABLE analytics_events (
  id           BIGSERIAL PRIMARY KEY,
  user_id      UUID REFERENCES app_users(id) ON DELETE SET NULL,
  event_name   VARCHAR(100) NOT NULL,
  properties   JSONB,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_analytics_events_name ON analytics_events(event_name);
CREATE INDEX idx_analytics_events_occurred_at ON analytics_events(occurred_at);
