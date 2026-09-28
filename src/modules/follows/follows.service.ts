import { query } from '../../db/pool';
import { env } from '../../config/env';

export class FollowError extends Error {}

function flagEmoji(countryCode: string | null): string {
  if (!countryCode || countryCode.length !== 2) return '';
  const codePoints = [...countryCode.toUpperCase()].map((c) => 127397 + c.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

export async function followUser(followerId: string, followeeId: string) {
  if (followerId === followeeId) {
    throw new FollowError('Não é possível seguir a própria conta.');
  }

  const exists = await query(`SELECT id FROM app_users WHERE id = $1`, [followeeId]);
  if (exists.length === 0) throw new FollowError('Usuário não encontrado.');

  const blocked = await query(
    `SELECT 1 FROM blocked_users
      WHERE (blocker_id = $1 AND blocked_id = $2)
         OR (blocker_id = $2 AND blocked_id = $1)`,
    [followerId, followeeId]
  );
  if (blocked.length > 0) {
    throw new FollowError('Não é possível seguir esse usuário.');
  }

  await query(
    `INSERT INTO follows (follower_id, followee_id) VALUES ($1, $2)
     ON CONFLICT (follower_id, followee_id) DO NOTHING`,
    [followerId, followeeId]
  );
}

export async function unfollowUser(followerId: string, followeeId: string) {
  await query(`DELETE FROM follows WHERE follower_id = $1 AND followee_id = $2`, [followerId, followeeId]);
}

export async function getFollowCounts(userId: string) {
  const [followingRows, followersRows] = await Promise.all([
    query<{ count: string }>(`SELECT COUNT(*) AS count FROM follows WHERE follower_id = $1`, [userId]),
    query<{ count: string }>(`SELECT COUNT(*) AS count FROM follows WHERE followee_id = $1`, [userId]),
  ]);

  return {
    followingCount: Number(followingRows[0].count),
    followersCount: Number(followersRows[0].count),
  };
}

interface UserSearchRow {
  id: string;
  display_name: string;
  avatar_url: string | null;
  level: number;
  location: string | null;
  country_code: string | null;
  is_following: boolean;
}

export async function searchUsers(currentUserId: string, term: string) {
  const rows = await query<UserSearchRow>(
    `SELECT u.id, u.display_name, u.avatar_url, u.level, u.location, u.country_code,
            EXISTS (
              SELECT 1 FROM follows WHERE follower_id = $1 AND followee_id = u.id
            ) AS is_following
       FROM app_users u
      WHERE u.id <> $1
        AND u.status = 'active'
        AND u.display_name ILIKE $2
        AND NOT EXISTS (
          SELECT 1 FROM blocked_users
           WHERE (blocker_id = $1 AND blocked_id = u.id)
              OR (blocker_id = u.id AND blocked_id = $1)
        )
      ORDER BY u.display_name
      LIMIT 20`,
    [currentUserId, `%${term}%`]
  );

  return rows.map((r) => ({
    id: r.id,
    name: r.display_name,
    avatarUrl: r.avatar_url ?? '',
    level: r.level,
    location: r.location ?? '',
    countryFlag: flagEmoji(r.country_code),
    isFollowing: r.is_following,
  }));
}

// ---------------------------------------------------------------------
// Sugestões de quem seguir ("Não sabe quem seguir?" na tela de amigos)
// ---------------------------------------------------------------------

export type SuggestionReason = 'founder' | 'top_week';

interface SuggestionRow extends UserSearchRow {
  is_blocked: boolean;
  weekly_distance_m?: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function toSuggestion(row: SuggestionRow, reason: SuggestionReason) {
  return {
    id: row.id,
    name: row.display_name,
    // mesmo formato da busca: string vazia quando não tem foto
    avatarUrl: row.avatar_url ?? '',
    level: row.level,
    location: row.location ?? '',
    countryFlag: flagEmoji(row.country_code),
    isFollowing: row.is_following,
    reason,
    ...(reason === 'top_week' && row.weekly_distance_m != null
      ? { weeklyDistanceKm: Math.round((Number(row.weekly_distance_m) / 1000) * 10) / 10 }
      : {}),
  };
}

// Até 2 sugestões: o fundador (fixo, via FOUNDER_USER_ID) e o "top da
// semana" (quem mais percorreu nos últimos 7 dias). As mesmas regras da
// busca valem aqui: só contas ativas, nunca a própria pessoa, e nada de
// quem tem bloqueio em qualquer direção.
export async function getFollowSuggestions(currentUserId: string) {
  const suggestions: ReturnType<typeof toSuggestion>[] = [];

  const founderId = env.founderUserId;
  const founderValid = founderId !== '' && UUID_RE.test(founderId);
  if (founderId !== '' && !founderValid) {
    console.warn('FOUNDER_USER_ID não é um UUID válido, sugestão do fundador ignorada.');
  }

  if (founderValid && founderId !== currentUserId) {
    const rows = await query<SuggestionRow>(
      `SELECT u.id, u.display_name, u.avatar_url, u.level, u.location, u.country_code,
              EXISTS (SELECT 1 FROM follows WHERE follower_id = $1 AND followee_id = u.id) AS is_following,
              EXISTS (
                SELECT 1 FROM blocked_users
                 WHERE (blocker_id = $1 AND blocked_id = u.id)
                    OR (blocker_id = u.id AND blocked_id = $1)
              ) AS is_blocked
         FROM app_users u
        WHERE u.id = $2 AND u.status = 'active'`,
      [currentUserId, founderId]
    );
    if (rows[0] && !rows[0].is_blocked) suggestions.push(toSuggestion(rows[0], 'founder'));
  }

  // Top da semana: soma da distância dos últimos 7 dias. Usa created_at
  // (horário do servidor), porque started_at vem do celular e pode ser
  // forjado. Ignora atividades barradas pelo anti-cheat e contas em
  // modo anônimo (não faz sentido destacar publicamente quem pediu pra
  // não aparecer).
  const topRows = await query<SuggestionRow>(
    `SELECT u.id, u.display_name, u.avatar_url, u.level, u.location, u.country_code,
            EXISTS (SELECT 1 FROM follows WHERE follower_id = $1 AND followee_id = u.id) AS is_following,
            EXISTS (
              SELECT 1 FROM blocked_users
               WHERE (blocker_id = $1 AND blocked_id = u.id)
                  OR (blocker_id = u.id AND blocked_id = $1)
            ) AS is_blocked,
            SUM(a.distance_meters) AS weekly_distance_m
       FROM activities a
       JOIN app_users u ON u.id = a.user_id
      WHERE a.created_at >= now() - interval '7 days'
        AND a.status NOT IN ('flagged', 'rejected')
        AND u.status = 'active'
        AND u.anonymous_mode = FALSE
      GROUP BY u.id
      ORDER BY weekly_distance_m DESC, u.created_at ASC
      LIMIT 1`,
    [currentUserId]
  );

  // O título é "Top da semana", então só mostra se o primeiro colocado
  // de verdade puder ser sugerido pra essa pessoa (não é ela mesma, nem
  // o fundador que já aparece acima, nem alguém bloqueado). Não pula pro
  // segundo colocado pra não rotular errado.
  const top = topRows[0];
  if (top && top.id !== currentUserId && top.id !== founderId && !top.is_blocked) {
    suggestions.push(toSuggestion(top, 'top_week'));
  }

  return suggestions;
}
