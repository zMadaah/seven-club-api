-- 029_season_reset.sql
--
-- Hoje XP é acumulado pra sempre (xp_events nunca tem "temporada"), e
-- território é permanente. Pra dar suporte a reset de temporada
-- (pedido: zerar nível, insígnias — que já reseta sozinho via
-- badge_unlocks.season_id — e território/ranking), este migration:
--
-- 1. Adiciona season_id em xp_events e territory_capture_events — o
--    NÍVEL passa a ser calculado só com o XP da temporada ATUAL
--    (getTotalXp filtra por season_id), sem precisar apagar histórico
--    nenhum. Uma temporada nova = todo mundo volta a 0 XP
--    automaticamente, só porque a soma da temporada nova começa vazia.
--
-- 2. territory_cells NÃO ganha season_id — h3_index é chave primária
--    (cada célula só existe uma vez, representando o dono ATUAL), não
--    dá pra ter uma linha por temporada sem reestruturar a PK inteira.
--    Em vez disso, o reset faz um UPDATE físico zerando os donos.
--
-- 3. season_results arquiva o resultado final de cada usuário ANTES do
--    reset físico do território — sem isso, perderíamos pra sempre
--    quem foi campeão de cada temporada.

ALTER TABLE xp_events
  ADD COLUMN season_id UUID REFERENCES seasons(id);

UPDATE xp_events SET season_id = (SELECT id FROM seasons WHERE number = 1)
 WHERE season_id IS NULL;

ALTER TABLE xp_events ALTER COLUMN season_id SET NOT NULL;
CREATE INDEX idx_xp_events_season ON xp_events(user_id, season_id);

-- A constraint antiga era (user_id, source, source_id) — sem
-- season_id, uma insígnia já resgatada na Temporada 1 nunca mais
-- concederia XP de novo numa temporada futura, mesmo desbloqueando de
-- novo (bateria na mesma constraint pra sempre). Precisa incluir
-- season_id pra "resetar" a idempotência a cada temporada nova.
--
-- O nome dela é descoberto em tempo de execução (em vez de escrever
-- "xp_events_user_id_source_source_id_key" direto) — mais seguro que
-- confiar de olho fechado na convenção de nomenclatura automática do
-- Postgres; se o nome estiver errado, a migration inteira falha e
-- trava o deploy.
DO $$
DECLARE
  old_constraint_name text;
BEGIN
  SELECT conname INTO old_constraint_name
    FROM pg_constraint
   WHERE conrelid = 'xp_events'::regclass
     AND contype = 'u'
     AND conkey = (
       SELECT array_agg(attnum ORDER BY attnum)
         FROM pg_attribute
        WHERE attrelid = 'xp_events'::regclass
          AND attname IN ('user_id', 'source', 'source_id')
     );

  IF old_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE xp_events DROP CONSTRAINT %I', old_constraint_name);
  END IF;
END $$;

ALTER TABLE xp_events ADD CONSTRAINT xp_events_user_source_season_key
  UNIQUE (user_id, source, source_id, season_id);

ALTER TABLE territory_capture_events
  ADD COLUMN season_id UUID REFERENCES seasons(id);

UPDATE territory_capture_events SET season_id = (SELECT id FROM seasons WHERE number = 1)
 WHERE season_id IS NULL;

ALTER TABLE territory_capture_events ALTER COLUMN season_id SET NOT NULL;
CREATE INDEX idx_territory_capture_events_season ON territory_capture_events(season_id);

-- Arquivo do resultado final de cada usuário, capturado no momento do
-- reset — antes de zerar território, guarda "como terminou" essa
-- temporada. Não é atualizado depois de criado (snapshot, não estado
-- vivo).
CREATE TABLE season_results (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id         UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  final_territory_m2 NUMERIC NOT NULL DEFAULT 0,
  final_xp          INTEGER NOT NULL DEFAULT 0,
  final_level       INTEGER NOT NULL DEFAULT 0,
  final_rank        INTEGER,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (season_id, user_id)
);

CREATE INDEX idx_season_results_user ON season_results(user_id);
