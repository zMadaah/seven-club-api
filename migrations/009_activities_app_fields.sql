-- 009_activities_app_fields.sql
-- Alinha `activities` com CompletedActivity (src/types/activity.ts do app):
-- faltavam o nome da atividade, o flag de loop fechado e a área capturada
-- (agora calculada de forma autoritativa pelo backend via H3, não mais
-- só localmente no app com polygonArea()).

ALTER TABLE activities
  ADD COLUMN name        VARCHAR(150) NOT NULL DEFAULT 'Atividade',
  ADD COLUMN loop_closed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN capture_m2  NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE activities
  ALTER COLUMN name DROP DEFAULT;

CREATE INDEX idx_activities_capture_m2 ON activities(capture_m2) WHERE capture_m2 > 0;
