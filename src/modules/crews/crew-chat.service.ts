import { query } from '../../db/pool';

export class CrewChatError extends Error {}

async function requireMembership(crewId: string, userId: string) {
  const rows = await query(
    `SELECT 1 FROM crews WHERE id = $1 AND creator_id = $2
     UNION
     SELECT 1 FROM crew_members WHERE crew_id = $1 AND user_id = $2`,
    [crewId, userId]
  );
  if (rows.length === 0) {
    throw new CrewChatError('Você não faz parte desse crew.');
  }
}

interface MessageRow {
  id: string;
  sender_id: string;
  display_name: string;
  avatar_url: string | null;
  body: string;
  created_at: string;
}

function mapMessage(r: MessageRow) {
  return {
    id: r.id,
    senderId: r.sender_id,
    senderName: r.display_name,
    senderAvatarUrl: r.avatar_url ?? '',
    text: r.body,
    createdAt: r.created_at,
  };
}

export async function listCrewMessages(crewId: string, userId: string) {
  await requireMembership(crewId, userId);

  const rows = await query<MessageRow>(
    `SELECT m.id, m.sender_id, u.display_name, u.avatar_url, m.body, m.created_at
       FROM crew_messages m
       JOIN app_users u ON u.id = m.sender_id
      WHERE m.crew_id = $1
      ORDER BY m.created_at ASC
      LIMIT 200`,
    [crewId]
  );

  return rows.map(mapMessage);
}

export async function sendCrewMessage(crewId: string, userId: string, text: string) {
  await requireMembership(crewId, userId);

  const crewRows = await query<{ in_game_chat_enabled: boolean }>(
    `SELECT in_game_chat_enabled FROM crews WHERE id = $1`,
    [crewId]
  );
  if (crewRows.length === 0) throw new CrewChatError('Crew não encontrado.');
  if (!crewRows[0].in_game_chat_enabled) {
    throw new CrewChatError('O chat desse crew está desativado.');
  }

  const rows = await query<{ id: string; sender_id: string; body: string; created_at: string }>(
    `INSERT INTO crew_messages (crew_id, sender_id, body)
     VALUES ($1, $2, $3)
     RETURNING id, sender_id, body, created_at`,
    [crewId, userId, text]
  );

  const senderRows = await query<{ display_name: string; avatar_url: string | null }>(
    `SELECT display_name, avatar_url FROM app_users WHERE id = $1`,
    [userId]
  );

  return mapMessage({
    ...rows[0],
    display_name: senderRows[0].display_name,
    avatar_url: senderRows[0].avatar_url,
  });
}
