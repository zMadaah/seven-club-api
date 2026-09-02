-- 030_reports.sql
--
-- Denúncia de post/comentário já existia visualmente no app (o Alert
-- de "Denunciar" em PostCard e CommentsModal), mas sem endpoint real
-- por trás — era um TODO conhecido, o botão nunca fazia nada.

CREATE TABLE reports (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id   UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  target_type   VARCHAR(10) NOT NULL CHECK (target_type IN ('post', 'comment')),
  target_id     UUID NOT NULL,
  status        VARCHAR(20) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'reviewed', 'dismissed')),
  reviewed_by   UUID REFERENCES staff_users(id) ON DELETE SET NULL,
  reviewed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- a mesma pessoa não pode denunciar o mesmo post/comentário mais de
  -- uma vez — evita inflar a fila de moderação com repetição
  UNIQUE (reporter_id, target_type, target_id)
);

CREATE INDEX idx_reports_status ON reports(status, created_at DESC);
CREATE INDEX idx_reports_target ON reports(target_type, target_id);
