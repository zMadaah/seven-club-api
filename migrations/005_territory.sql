-- 005_territory.sql
-- Territórios em grid hexagonal H3 (resolução 10, ~65m por célula) e o
-- histórico de capturas gerado a cada atividade processada.

CREATE TABLE territory_cells (
  h3_index        VARCHAR(15) PRIMARY KEY, -- índice H3 resolução 10
  owner_user_id   UUID REFERENCES app_users(id) ON DELETE SET NULL,
  captured_at     TIMESTAMPTZ,
  center          GEOGRAPHY(Point, 4326) NOT NULL
);

CREATE INDEX idx_territory_cells_owner ON territory_cells(owner_user_id);
CREATE INDEX idx_territory_cells_center_gist ON territory_cells USING GIST(center);

CREATE TABLE territory_capture_events (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id             UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  h3_index                VARCHAR(15) NOT NULL REFERENCES territory_cells(h3_index),
  previous_owner_user_id  UUID REFERENCES app_users(id) ON DELETE SET NULL,
  new_owner_user_id       UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  captured_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_territory_capture_events_activity ON territory_capture_events(activity_id);
CREATE INDEX idx_territory_capture_events_h3 ON territory_capture_events(h3_index);
CREATE INDEX idx_territory_capture_events_new_owner ON territory_capture_events(new_owner_user_id);
