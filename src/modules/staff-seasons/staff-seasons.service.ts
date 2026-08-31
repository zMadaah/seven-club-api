import { pool } from '../../db/pool';
import { getCurrentSeason } from '../progress/seasons.service';
import { levelFromTotalXp } from '../progress/xp.service';

export class SeasonResetError extends Error {}

const SEASON_DURATION_MONTHS = 3;

export async function getCurrentSeasonInfo() {
  const season = await getCurrentSeason();
  if (!season) return null;
  return {
    id: season.id,
    number: season.number,
    name: season.name,
    startsAt: season.starts_at,
    endsAt: season.ends_at,
  };
}

// Faz tudo numa transação só: arquiva o resultado final de cada
// usuário da temporada que está terminando, cria a temporada nova, e
// zera o território (o "tabuleiro" — quem é dono de cada hexágono).
// XP e insígnias não precisam de UPDATE físico nenhum: já resetam
// sozinhos assim que a temporada nova existe, porque as consultas
// filtram por season_id da temporada ATUAL (xp_events, badge_unlocks).
export async function resetSeason() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const currentRows = await client.query<{ id: string; number: number }>(
      `SELECT id, number FROM seasons ORDER BY number DESC LIMIT 1`
    );
    if (currentRows.rows.length === 0) {
      throw new SeasonResetError('Nenhuma temporada cadastrada ainda.');
    }
    const current = currentRows.rows[0];

    // Arquiva ANTES de zerar — snapshot de quem tinha o quê no fim
    // dessa temporada. Só gente que teve alguma atividade (território
    // ou XP > 0) entra no arquivo, pra não poluir com milhares de
    // linhas zeradas de quem nunca correu.
    await client.query(
      `INSERT INTO season_results (season_id, user_id, final_territory_m2, final_xp, final_rank)
       WITH territory_totals AS (
         SELECT owner_user_id AS user_id, SUM(cell_area_m2) AS territory_m2
           FROM territory_cells
          WHERE owner_user_id IS NOT NULL
          GROUP BY owner_user_id
       ),
       xp_totals AS (
         SELECT user_id, SUM(amount) AS xp
           FROM xp_events
          WHERE season_id = $1
          GROUP BY user_id
       ),
       combined AS (
         SELECT COALESCE(t.user_id, x.user_id) AS user_id,
                COALESCE(t.territory_m2, 0) AS territory_m2,
                COALESCE(x.xp, 0) AS xp
           FROM territory_totals t
           FULL OUTER JOIN xp_totals x ON x.user_id = t.user_id
       )
       SELECT $1, user_id, territory_m2, xp,
              RANK() OVER (ORDER BY territory_m2 DESC)
         FROM combined
        WHERE territory_m2 > 0 OR xp > 0
       ON CONFLICT (season_id, user_id) DO NOTHING`,
      [current.id]
    );

    // Preenche final_level a partir do XP arquivado (calculado em JS,
    // não em SQL — reaproveita a mesma fórmula que o resto do app usa)
    const archived = await client.query<{ id: string; final_xp: number }>(
      `SELECT id, final_xp FROM season_results WHERE season_id = $1`,
      [current.id]
    );
    for (const row of archived.rows) {
      const { level } = levelFromTotalXp(row.final_xp);
      await client.query(`UPDATE season_results SET final_level = $1 WHERE id = $2`, [level, row.id]);
    }

    // Cria a temporada nova
    const newSeasonRows = await client.query<{ id: string; number: number }>(
      `INSERT INTO seasons (number, name, starts_at, ends_at)
       VALUES ($1, $2, now(), now() + ($3 || ' months')::interval)
       RETURNING id, number`,
      [current.number + 1, `Temporada ${current.number + 1}`, SEASON_DURATION_MONTHS]
    );
    const newSeason = newSeasonRows.rows[0];

    // Zera o tabuleiro — território não tem como "resetar sozinho" via
    // filtro de season_id (h3_index é chave primária, cada célula só
    // existe uma vez representando o dono ATUAL).
    await client.query(`UPDATE territory_cells SET owner_user_id = NULL, captured_at = NULL`);

    await client.query('COMMIT');

    return { previousSeasonNumber: current.number, newSeasonNumber: newSeason.number, newSeasonId: newSeason.id };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
