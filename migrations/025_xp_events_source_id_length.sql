-- 025_xp_events_source_id_length.sql
-- source_id foi dimensionado originalmente só pra ids curtos de desafio/
-- insígnia ('c1', 'b3'...). Ao passar a conceder XP por atividade
-- também (source='activity'), o id passado é um UUID de verdade
-- (36 caracteres) — estourava o VARCHAR(30) e quebrava o registro de
-- toda atividade com loop fechado, com "value too long for type
-- character varying(30)".

ALTER TABLE xp_events
  ALTER COLUMN source_id TYPE VARCHAR(64);
