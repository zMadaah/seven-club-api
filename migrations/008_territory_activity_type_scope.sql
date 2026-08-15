-- 008_territory_activity_type_scope.sql
-- Correção de arquitetura: analisando o app (SevenClub), os mocks de
-- território e leaderboard são agrupados por ActivityType
-- (Record<'run' | 'ride', ...>) — ou seja, corrida e pedal têm grids H3
-- independentes. Um mesmo hexágono pode ter donos diferentes em cada um.
-- Esta migration adiciona activity_type como parte da chave em vez de
-- reformular tudo, já que a 005 tinha sido escrita antes de olharmos o
-- código real do app.

ALTER TABLE territory_capture_events
  DROP CONSTRAINT territory_capture_events_h3_index_fkey;

ALTER TABLE territory_cells
  DROP CONSTRAINT territory_cells_pkey;

ALTER TABLE territory_cells
  ADD COLUMN activity_type VARCHAR(10) NOT NULL DEFAULT 'run',
  ADD COLUMN cell_area_m2  NUMERIC(10,2);

ALTER TABLE territory_cells
  ALTER COLUMN activity_type DROP DEFAULT;

ALTER TABLE territory_cells
  ADD CONSTRAINT chk_territory_cells_activity_type CHECK (activity_type IN ('run', 'ride'));

ALTER TABLE territory_cells
  ADD PRIMARY KEY (h3_index, activity_type);

ALTER TABLE territory_capture_events
  ADD COLUMN activity_type VARCHAR(10) NOT NULL DEFAULT 'run';

ALTER TABLE territory_capture_events
  ALTER COLUMN activity_type DROP DEFAULT;

ALTER TABLE territory_capture_events
  ADD CONSTRAINT chk_tce_activity_type CHECK (activity_type IN ('run', 'ride'));

ALTER TABLE territory_capture_events
  ADD CONSTRAINT territory_capture_events_h3_fkey
    FOREIGN KEY (h3_index, activity_type) REFERENCES territory_cells(h3_index, activity_type);
