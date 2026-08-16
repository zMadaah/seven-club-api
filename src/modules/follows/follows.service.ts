import { query } from '../../db/pool';

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
