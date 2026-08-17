import { query } from '../../db/pool';

export class LobbyChatError extends Error {}

// Só quem é dono ou membro do lobby pode ler/escrever nesse chat — é um
// espaço privado do grupo, não um canal público.
async function requireMembership(lobbyId: string, userId: string) {
  const rows = await query(
    `SELECT 1 FROM lobbies WHERE id = $1 AND creator_id = $2
     UNION
     SELECT 1 FROM lobby_members WHERE lobby_id = $1 AND user_id = $2`,
    [lobbyId, userId]
  );
  if (rows.length === 0) {
    throw new LobbyChatError('Você não faz parte desse lobby.');
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

export async function listLobbyMessages(lobbyId: string, userId: string) {
  await requireMembership(lobbyId, userId);

  const rows = await query<MessageRow>(
    `SELECT m.id, m.sender_id, u.display_name, u.avatar_url, m.body, m.created_at
       FROM lobby_messages m
       JOIN app_users u ON u.id = m.sender_id
      WHERE m.lobby_id = $1
      ORDER BY m.created_at ASC
      LIMIT 200`,
    [lobbyId]
  );

  return rows.map(mapMessage);
}

// O toggle "Chat no jogo" (in_game_chat_enabled) já existia nas
// configurações do lobby desde a entrega original — só nunca tinha sido
// ligado a nada de verdade. Agora bloqueia o envio se o admin desativou.
export async function sendLobbyMessage(lobbyId: string, userId: string, text: string) {
  await requireMembership(lobbyId, userId);

  const lobbyRows = await query<{ in_game_chat_enabled: boolean }>(
    `SELECT in_game_chat_enabled FROM lobbies WHERE id = $1`,
    [lobbyId]
  );
  if (lobbyRows.length === 0) throw new LobbyChatError('Lobby não encontrado.');
  if (!lobbyRows[0].in_game_chat_enabled) {
    throw new LobbyChatError('O chat desse lobby está desativado.');
  }

  const rows = await query<{ id: string; sender_id: string; body: string; created_at: string }>(
    `INSERT INTO lobby_messages (lobby_id, sender_id, body)
     VALUES ($1, $2, $3)
     RETURNING id, sender_id, body, created_at`,
    [lobbyId, userId, text]
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
