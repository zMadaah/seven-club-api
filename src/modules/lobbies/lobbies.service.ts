import { query } from '../../db/pool';

export class LobbyError extends Error {}

// Mesmo alfabeto do gerador que já existia no app (utils/inviteCode.ts):
// sem 0/O/1/I, pra não confundir na hora de digitar/ditar o código.
const INVITE_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const INVITE_CODE_LENGTH = 6;
const MAX_CODE_ATTEMPTS = 10;

function randomCode(): string {
  let code = '';
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
    code += INVITE_CODE_CHARS[Math.floor(Math.random() * INVITE_CODE_CHARS.length)];
  }
  return code;
}

async function generateUniqueInviteCode(): Promise<string> {
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = randomCode();
    const existing = await query(`SELECT id FROM lobbies WHERE invite_code = $1`, [code]);
    if (existing.length === 0) return code;
  }
  throw new LobbyError('Não foi possível gerar um código de convite. Tente de novo.');
}

interface LobbyRow {
  id: string;
  name: string;
  picture_url: string | null;
  creator_id: string;
  creator_name: string;
  creator_avatar_url: string | null;
  allow_previous_imports: boolean;
  allow_member_invitations: boolean;
  in_game_chat_enabled: boolean;
  max_lobby_size: number | null;
  invite_code: string;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  members: { id: string; name: string; avatarUrl: string }[];
}

function mapLobbyRow(row: LobbyRow) {
  return {
    id: row.id,
    name: row.name,
    pictureUri: row.picture_url ?? undefined,
    creatorId: row.creator_id,
    creatorName: row.creator_name,
    creatorAvatarUrl: row.creator_avatar_url ?? '',
    allowPreviousImports: row.allow_previous_imports,
    allowMemberInvitations: row.allow_member_invitations,
    inGameChatEnabled: row.in_game_chat_enabled,
    maxLobbySize: row.max_lobby_size,
    inviteCode: row.invite_code,
    startsAt: row.starts_at ? new Date(row.starts_at).toISOString() : null,
    endsAt: row.ends_at ? new Date(row.ends_at).toISOString() : null,
    members: row.members ?? [],
    createdAt: new Date(row.created_at).getTime(),
  };
}

const LOBBY_SELECT = `
  SELECT l.id, l.name, l.picture_url, l.creator_id, l.allow_previous_imports,
         l.allow_member_invitations, l.in_game_chat_enabled, l.max_lobby_size,
         l.invite_code, l.starts_at, l.ends_at, l.created_at,
         creator.display_name AS creator_name,
         creator.avatar_url AS creator_avatar_url,
         COALESCE(
           (SELECT json_agg(json_build_object('id', u.id, 'name', u.display_name, 'avatarUrl', u.avatar_url))
              FROM lobby_members lm
              JOIN app_users u ON u.id = lm.user_id
             WHERE lm.lobby_id = l.id),
           '[]'::json
         ) AS members
    FROM lobbies l
    JOIN app_users creator ON creator.id = l.creator_id
`;

export async function listMyLobbies(userId: string) {
  const rows = await query<LobbyRow>(
    `${LOBBY_SELECT}
      WHERE l.creator_id = $1
         OR EXISTS (SELECT 1 FROM lobby_members WHERE lobby_id = l.id AND user_id = $1)
      ORDER BY l.created_at DESC`,
    [userId]
  );
  return rows.map(mapLobbyRow);
}

export async function createLobby(
  userId: string,
  input: {
    name: string;
    pictureUri?: string;
    allowPreviousImports: boolean;
    allowMemberInvitations: boolean;
    inGameChatEnabled: boolean;
    maxLobbySize: number | null;
    startsAt?: string | null;
    endsAt?: string | null;
  }
) {
  const inviteCode = await generateUniqueInviteCode();

  const rows = await query<{ id: string }>(
    `INSERT INTO lobbies
       (name, picture_url, creator_id, allow_previous_imports, allow_member_invitations,
        in_game_chat_enabled, max_lobby_size, invite_code, starts_at, ends_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      input.name,
      input.pictureUri ?? null,
      userId,
      input.allowPreviousImports,
      input.allowMemberInvitations,
      input.inGameChatEnabled,
      input.maxLobbySize,
      inviteCode,
      input.startsAt ?? null,
      input.endsAt ?? null,
    ]
  );

  const [lobby] = await query<LobbyRow>(`${LOBBY_SELECT} WHERE l.id = $1`, [rows[0].id]);
  return mapLobbyRow(lobby);
}

async function requireOwnedLobby(userId: string, lobbyId: string) {
  const rows = await query<{ creator_id: string }>(`SELECT creator_id FROM lobbies WHERE id = $1`, [lobbyId]);
  if (rows.length === 0) throw new LobbyError('Lobby não encontrado.');
  if (rows[0].creator_id !== userId) throw new LobbyError('Só quem criou o lobby pode fazer isso.');
}

export async function updateLobby(
  userId: string,
  lobbyId: string,
  input: {
    name: string;
    pictureUri?: string;
    allowPreviousImports: boolean;
    allowMemberInvitations: boolean;
    inGameChatEnabled: boolean;
    maxLobbySize: number | null;
    startsAt?: string | null;
    endsAt?: string | null;
  }
) {
  await requireOwnedLobby(userId, lobbyId);

  await query(
    `UPDATE lobbies
        SET name = $1, picture_url = $2, allow_previous_imports = $3,
            allow_member_invitations = $4, in_game_chat_enabled = $5, max_lobby_size = $6,
            starts_at = $8, ends_at = $9
      WHERE id = $7`,
    [
      input.name,
      input.pictureUri ?? null,
      input.allowPreviousImports,
      input.allowMemberInvitations,
      input.inGameChatEnabled,
      input.maxLobbySize,
      lobbyId,
      input.startsAt ?? null,
      input.endsAt ?? null,
    ]
  );

  const [lobby] = await query<LobbyRow>(`${LOBBY_SELECT} WHERE l.id = $1`, [lobbyId]);
  return mapLobbyRow(lobby);
}

export async function deleteLobby(userId: string, lobbyId: string) {
  await requireOwnedLobby(userId, lobbyId);
  await query(`DELETE FROM lobbies WHERE id = $1`, [lobbyId]);
}

export async function joinLobby(userId: string, code: string) {
  const rows = await query<{ id: string; creator_id: string; max_lobby_size: number | null }>(
    `SELECT id, creator_id, max_lobby_size FROM lobbies WHERE invite_code = $1`,
    [code.toUpperCase()]
  );
  if (rows.length === 0) throw new LobbyError('Código de convite inválido.');
  const lobby = rows[0];

  if (lobby.creator_id === userId) {
    throw new LobbyError('Você já é o criador desse lobby.');
  }

  const already = await query(
    `SELECT 1 FROM lobby_members WHERE lobby_id = $1 AND user_id = $2`,
    [lobby.id, userId]
  );
  if (already.length > 0) {
    const [existing] = await query<LobbyRow>(`${LOBBY_SELECT} WHERE l.id = $1`, [lobby.id]);
    return mapLobbyRow(existing);
  }

  if (lobby.max_lobby_size !== null) {
    const countRows = await query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM lobby_members WHERE lobby_id = $1`,
      [lobby.id]
    );
    if (Number(countRows[0].count) >= lobby.max_lobby_size) {
      throw new LobbyError('Esse lobby já está cheio.');
    }
  }

  await query(`INSERT INTO lobby_members (lobby_id, user_id) VALUES ($1, $2)`, [lobby.id, userId]);

  const [joined] = await query<LobbyRow>(`${LOBBY_SELECT} WHERE l.id = $1`, [lobby.id]);
  return mapLobbyRow(joined);
}

export async function leaveLobby(userId: string, lobbyId: string) {
  const rows = await query<{ creator_id: string }>(`SELECT creator_id FROM lobbies WHERE id = $1`, [lobbyId]);
  if (rows.length === 0) throw new LobbyError('Lobby não encontrado.');
  if (rows[0].creator_id === userId) {
    throw new LobbyError('Quem criou o lobby não pode sair — apague o lobby em vez disso.');
  }

  await query(`DELETE FROM lobby_members WHERE lobby_id = $1 AND user_id = $2`, [lobbyId, userId]);
}
