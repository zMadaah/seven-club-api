import { query, pool } from '../../db/pool';

export class PostError extends Error {}

interface FeedRow {
  id: string;
  title: string | null;
  caption: string | null;
  activity_type: 'run' | 'ride';
  is_group: boolean;
  created_at: string;
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  level: number;
  location: string | null;
  country_code: string | null;
  distance_meters: string | null;
  duration_seconds: number | null;
  avg_pace_sec_per_km: string | null;
  capture_m2: string | null;
  like_count: string;
  comment_count: string;
  liked_by_me: boolean;
  is_following: boolean;
  global_rank: string | null;
  photos: string[];
}

// Converte um código de país (ISO 3166-1 alpha-2, ex: "BR") num emoji de
// bandeira. Evita guardar o emoji em si no banco — o código é o dado
// estável, a bandeira é só apresentação.
function flagEmoji(countryCode: string | null): string {
  if (!countryCode || countryCode.length !== 2) return '';
  const codePoints = [...countryCode.toUpperCase()].map((c) => 127397 + c.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

function formatPaceLabel(secPerKm: number | null): string | undefined {
  if (secPerKm === null) return undefined;
  const min = Math.floor(secPerKm / 60);
  const sec = Math.round(secPerKm % 60);
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

function formatDurationLabel(totalSeconds: number | null): string | undefined {
  if (totalSeconds === null) return undefined;
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map((n) => n.toString().padStart(2, '0')).join(':');
}

function mapFeedRow(row: FeedRow) {
  return {
    id: row.id,
    runner: {
      id: row.user_id,
      name: row.display_name,
      avatarUrl: row.avatar_url ?? '',
      level: row.level,
      location: row.location ?? '',
      countryFlag: flagEmoji(row.country_code),
    },
    createdAt: row.created_at,
    title: row.title ?? undefined,
    caption: row.caption ?? undefined,
    photos: row.photos ?? [],
    distanceKm: row.distance_meters !== null ? Number(row.distance_meters) / 1000 : undefined,
    durationLabel: formatDurationLabel(row.duration_seconds),
    avgPaceLabel: formatPaceLabel(row.avg_pace_sec_per_km !== null ? Number(row.avg_pace_sec_per_km) : null),
    territoryKm2: row.capture_m2 !== null ? Number(row.capture_m2) / 1_000_000 : undefined,
    globalRank: row.global_rank !== null ? Number(row.global_rank) : undefined,
    likes: Number(row.like_count),
    comments: Number(row.comment_count),
    likedByMe: row.liked_by_me,
    activityType: row.activity_type,
    isGroup: row.is_group,
    isFollowing: row.is_following,
  };
}

export async function listFeed(
  userId: string,
  scope: 'explore' | 'following' | 'groups',
  activityType: 'run' | 'ride' | 'all'
) {
  const rows = await query<FeedRow>(
    `WITH ranks AS (
       SELECT owner_user_id, activity_type,
              RANK() OVER (PARTITION BY activity_type ORDER BY SUM(cell_area_m2) DESC) AS rank
         FROM territory_cells
        WHERE owner_user_id IS NOT NULL
        GROUP BY owner_user_id, activity_type
     ),
     like_counts AS (
       SELECT post_id, COUNT(*) AS like_count FROM post_likes GROUP BY post_id
     ),
     comment_counts AS (
       SELECT post_id, COUNT(*) AS comment_count FROM post_comments GROUP BY post_id
     )
     SELECT
       p.id, p.title, p.caption, p.activity_type, p.is_group, p.created_at,
       u.id AS user_id, u.display_name, u.avatar_url, u.level, u.location, u.country_code,
       a.distance_meters, a.duration_seconds, a.avg_pace_sec_per_km, a.capture_m2,
       COALESCE(lk.like_count, 0) AS like_count,
       COALESCE(cm.comment_count, 0) AS comment_count,
       EXISTS (SELECT 1 FROM post_likes WHERE post_id = p.id AND user_id = $1) AS liked_by_me,
       EXISTS (SELECT 1 FROM follows WHERE follower_id = $1 AND followee_id = p.user_id) AS is_following,
       r.rank AS global_rank,
       COALESCE(
         (SELECT json_agg(pp.url ORDER BY pp.position) FROM post_photos pp WHERE pp.post_id = p.id),
         '[]'::json
       ) AS photos
     FROM posts p
     JOIN app_users u ON u.id = p.user_id
     LEFT JOIN activities a ON a.id = p.activity_id
     LEFT JOIN like_counts lk ON lk.post_id = p.id
     LEFT JOIN comment_counts cm ON cm.post_id = p.id
     LEFT JOIN ranks r ON r.owner_user_id = p.user_id AND r.activity_type = p.activity_type
     WHERE ($2 = 'all' OR p.activity_type = $2)
       AND (
         $3 = 'explore'
         OR ($3 = 'following' AND EXISTS (
              SELECT 1 FROM follows WHERE follower_id = $1 AND followee_id = p.user_id
            ))
         OR ($3 = 'groups' AND p.is_group = TRUE)
       )
     ORDER BY p.created_at DESC
     LIMIT 50`,
    [userId, activityType, scope]
  );

  return rows.map(mapFeedRow);
}

export async function createPost(
  userId: string,
  input: { activityId?: string; title?: string; caption?: string; photoUrls: string[]; activityType?: 'run' | 'ride' }
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let activityType: 'run' | 'ride' = input.activityType ?? 'run';

    if (input.activityId) {
      const { rows } = await client.query(
        `SELECT activity_type FROM activities WHERE id = $1 AND user_id = $2`,
        [input.activityId, userId]
      );
      if (rows.length === 0) {
        throw new PostError('Atividade não encontrada.');
      }
      activityType = rows[0].activity_type;
    }

    const { rows: postRows } = await client.query(
      `INSERT INTO posts (user_id, activity_id, activity_type, title, caption)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [userId, input.activityId ?? null, activityType, input.title ?? null, input.caption ?? null]
    );
    const postId = postRows[0].id as string;

    for (let i = 0; i < input.photoUrls.length; i++) {
      await client.query(
        `INSERT INTO post_photos (post_id, url, position) VALUES ($1, $2, $3)`,
        [postId, input.photoUrls[i], i]
      );
    }

    await client.query('COMMIT');
    return postId;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function likePost(userId: string, postId: string) {
  await query(
    `INSERT INTO post_likes (post_id, user_id) VALUES ($1, $2)
     ON CONFLICT (post_id, user_id) DO NOTHING`,
    [postId, userId]
  );
}

export async function unlikePost(userId: string, postId: string) {
  await query(`DELETE FROM post_likes WHERE post_id = $1 AND user_id = $2`, [postId, userId]);
}

interface CommentRow {
  id: string;
  post_id: string;
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  body: string;
  created_at: string;
  parent_comment_id: string | null;
}

function mapCommentRow(row: CommentRow) {
  return {
    id: row.id,
    postId: row.post_id,
    userId: row.user_id,
    userName: row.display_name,
    userAvatarUrl: row.avatar_url ?? '',
    text: row.body,
    createdAt: row.created_at,
    parentCommentId: row.parent_comment_id ?? undefined,
  };
}

export async function listComments(postId: string) {
  const rows = await query<CommentRow>(
    `SELECT c.id, c.post_id, c.user_id, u.display_name, u.avatar_url, c.body, c.created_at, c.parent_comment_id
       FROM post_comments c
       JOIN app_users u ON u.id = c.user_id
      WHERE c.post_id = $1
      ORDER BY c.created_at ASC`,
    [postId]
  );
  return rows.map(mapCommentRow);
}

export async function addComment(
  userId: string,
  postId: string,
  body: string,
  parentCommentId?: string
) {
  const postExists = await query(`SELECT id FROM posts WHERE id = $1`, [postId]);
  if (postExists.length === 0) throw new PostError('Post não encontrado.');

  if (parentCommentId) {
    const parentExists = await query(
      `SELECT id FROM post_comments WHERE id = $1 AND post_id = $2`,
      [parentCommentId, postId]
    );
    if (parentExists.length === 0) throw new PostError('Comentário original não encontrado.');
  }

  const rows = await query<CommentRow>(
    `INSERT INTO post_comments (post_id, user_id, parent_comment_id, body)
     VALUES ($1, $2, $3, $4)
     RETURNING id, post_id, user_id,
       (SELECT display_name FROM app_users WHERE id = $2) AS display_name,
       (SELECT avatar_url FROM app_users WHERE id = $2) AS avatar_url,
       body, created_at, parent_comment_id`,
    [postId, userId, parentCommentId ?? null, body]
  );

  return mapCommentRow(rows[0]);
}

export async function deleteComment(userId: string, commentId: string) {
  const rows = await query<{ id: string }>(
    `DELETE FROM post_comments WHERE id = $1 AND user_id = $2 RETURNING id`,
    [commentId, userId]
  );
  if (rows.length === 0) {
    throw new PostError('Comentário não encontrado ou você não é o autor.');
  }
}

// ON DELETE CASCADE já cuida de post_photos/post_likes/post_comments
// (definido na migration 014) — apagar o post limpa tudo junto.
export async function deletePost(userId: string, postId: string) {
  const rows = await query<{ id: string }>(
    `DELETE FROM posts WHERE id = $1 AND user_id = $2 RETURNING id`,
    [postId, userId]
  );
  if (rows.length === 0) {
    throw new PostError('Post não encontrado ou você não é o autor.');
  }
}
