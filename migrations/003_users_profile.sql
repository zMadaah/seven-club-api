-- 003_users_profile.sql
-- Dados de perfil e estatísticas agregadas exibidas no app e no dashboard.
-- Obs: campo de região fica para uma migration futura (ver README) quando o
-- widget "Usuários por região" for conectado a dados reais.

ALTER TABLE app_users
  ADD COLUMN display_name         VARCHAR(100),
  ADD COLUMN avatar_url           TEXT,
  ADD COLUMN bio                  VARCHAR(280),
  ADD COLUMN total_distance_km    NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN total_territory_km2  NUMERIC(10,4) NOT NULL DEFAULT 0,
  ADD COLUMN rival_count          INTEGER NOT NULL DEFAULT 0;
