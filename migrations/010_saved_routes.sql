-- 010_saved_routes.sql
-- Rotas planejadas/salvas pelo usuário (tela RoutePlan do app). São uma
-- referência pessoal, não uma atividade — por isso não passam pelo motor
-- de captura de território; capture_m2_estimate é só uma prévia.

CREATE TABLE saved_routes (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  name                  VARCHAR(150) NOT NULL,
  path                  GEOGRAPHY(LineString, 4326) NOT NULL,
  distance_meters       NUMERIC(10,2) NOT NULL,
  capture_m2_estimate   NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_saved_routes_user_id ON saved_routes(user_id);
