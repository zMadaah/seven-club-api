-- 024_notifications.sql

CREATE TABLE notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  category    VARCHAR(20) NOT NULL DEFAULT 'sevenclub',
  title       VARCHAR(150) NOT NULL,
  subtitle    VARCHAR(300) NOT NULL,
  read        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user_created ON notifications(user_id, created_at DESC);
