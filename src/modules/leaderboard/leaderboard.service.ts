import { query } from '../../db/pool';

export class LeaderboardError extends Error {}

export type LeaderboardScope = 'country' | 'area' | 'friends' | 'lobby';

function flagEmoji(countryCode: string | null): string {
  if (!countryCode || countryCode.length !== 2) return '';
  const codePoints = [...countryCode.toUpperCase()].map((c) => 127397 + c.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

// Monta o "pool" de concorrentes conforme o escopo. Os quatro casos são
// SQL fixo (não vem de input do usuário), então interpolar aqui é seguro.
// "lobby" é o único que usa um terceiro parâmetro ($3, o lobbyId).
function poolCte(scope: LeaderboardScope): string {
  if (scope === 'friends') {
    return `pool AS (
      SELECT followee_id AS id FROM follows WHERE follower_id = $1
      UNION
      SELECT $1
    )`;
  }

  if (scope === 'country') {
    return `pool AS (
      SELECT id FROM app_users
       WHERE status = 'active'
         AND country_code IS NOT NULL
         AND country_code = (SELECT country_code FROM app_users WHERE id = $1)
    )`;
  }

  if (scope === 'lobby') {
    return `pool AS (
      SELECT creator_id AS id FROM lobbies WHERE id = $3
      UNION
      SELECT user_id AS id FROM lobby_members WHERE lobby_id = $3
    )`;
  }

  // area — aproximação simples: mesmo texto de localização no perfil
  // (ex: "Brasília, Brasil"). Não é geolocalização de verdade; se um dia
  // isso importar o suficiente, dá pra trocar por raio em torno de um
  // ponto usando a coluna `center` que territory_cells já tem.
  return `pool AS (
    SELECT id FROM app_users
     WHERE status = 'active'
       AND location IS NOT NULL
       AND location = (SELECT location FROM app_users WHERE id = $1)
  )`;
}

interface LeaderboardRow {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  country_code: string | null;
  area_m2: string;
  rank: string;
}

export async function getLeaderboard(
  userId: string,
  scope: LeaderboardScope,
  activityType: 'run' | 'ride',
  lobbyId?: string
) {
  if (scope === 'lobby') {
    if (!lobbyId) throw new LeaderboardError('Escopo "lobby" exige lobbyId.');

    // só quem faz parte do lobby (dono ou membro) pode ver esse ranking —
    // é um espaço privado, não vale expor pra quem não está dentro
    const membership = await query(
      `SELECT 1 FROM lobbies WHERE id = $1 AND creator_id = $2
       UNION
       SELECT 1 FROM lobby_members WHERE lobby_id = $1 AND user_id = $2`,
      [lobbyId, userId]
    );
    if (membership.length === 0) {
      throw new LeaderboardError('Você não faz parte desse lobby.');
    }
  }

  const params: (string | undefined)[] = [userId, activityType];
  if (scope === 'lobby') params.push(lobbyId);

  const rows = await query<LeaderboardRow>(
    `WITH ${poolCte(scope)},
     totals AS (
       SELECT u.id AS user_id, u.display_name, u.avatar_url, u.country_code,
              COALESCE(SUM(tc.cell_area_m2), 0) AS area_m2
         FROM pool p
         JOIN app_users u ON u.id = p.id
         LEFT JOIN territory_cells tc
           ON tc.owner_user_id = u.id AND tc.activity_type = $2
        GROUP BY u.id, u.display_name, u.avatar_url, u.country_code
     )
     SELECT user_id, display_name, avatar_url, country_code, area_m2,
            RANK() OVER (ORDER BY area_m2 DESC) AS rank
       FROM totals
      ORDER BY area_m2 DESC
      LIMIT 500`,
    params
  );

  const mapped = rows.map((r) => ({
    id: r.user_id,
    rank: Number(r.rank),
    name: r.display_name,
    avatarUrl: r.avatar_url ?? '',
    countryFlag: flagEmoji(r.country_code),
    countryCode: r.country_code ?? '',
    territoryKm2: Number(r.area_m2) / 1_000_000,
    activityType,
  }));

  // "seu rank" nunca faz parte da lista de concorrentes — é separado
  const myRank = mapped.find((e) => e.id === userId) ?? null;
  const entries = mapped.filter((e) => e.id !== userId).slice(0, 50);

  return { entries, myRank };
}
