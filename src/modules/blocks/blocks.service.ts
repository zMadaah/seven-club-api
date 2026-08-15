import { query } from '../../db/pool';

export class BlockError extends Error {}

export async function blockUser(blockerId: string, blockedId: string) {
  if (blockerId === blockedId) {
    throw new BlockError('Não é possível bloquear a própria conta.');
  }

  const exists = await query(`SELECT id FROM app_users WHERE id = $1`, [blockedId]);
  if (exists.length === 0) throw new BlockError('Usuário não encontrado.');

  await query(
    `INSERT INTO blocked_users (blocker_id, blocked_id) VALUES ($1, $2)
     ON CONFLICT (blocker_id, blocked_id) DO NOTHING`,
    [blockerId, blockedId]
  );

  // Bloquear corta a relação de seguir nos dois sentidos — não faz
  // sentido continuar "seguindo" alguém que você acabou de bloquear, nem
  // deixar quem foi bloqueado continuar te seguindo.
  await query(
    `DELETE FROM follows
      WHERE (follower_id = $1 AND followee_id = $2)
         OR (follower_id = $2 AND followee_id = $1)`,
    [blockerId, blockedId]
  );
}

export async function unblockUser(blockerId: string, blockedId: string) {
  await query(`DELETE FROM blocked_users WHERE blocker_id = $1 AND blocked_id = $2`, [
    blockerId,
    blockedId,
  ]);
}

interface BlockedUserRow {
  id: string;
  display_name: string;
  avatar_url: string | null;
}

export async function listBlockedUsers(blockerId: string) {
  const rows = await query<BlockedUserRow>(
    `SELECT u.id, u.display_name, u.avatar_url
       FROM blocked_users b
       JOIN app_users u ON u.id = b.blocked_id
      WHERE b.blocker_id = $1
      ORDER BY b.created_at DESC`,
    [blockerId]
  );

  return rows.map((r) => ({
    id: r.id,
    name: r.display_name,
    avatarUrl: r.avatar_url ?? '',
  }));
}
