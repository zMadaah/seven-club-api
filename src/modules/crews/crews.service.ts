import { query } from '../../db/pool';

export class CrewError extends Error {}

interface CrewRow {
  id: string;
  name: string;
  picture_url: string | null;
  city: string;
  is_public: boolean;
  creator_id: string;
  creator_name: string;
  creator_avatar_url: string | null;
  allow_previous_imports: boolean;
  allow_member_invitations: boolean;
  in_game_chat_enabled: boolean;
  max_crew_size: number | null;
  invite_code: string;
  created_at: string;
  members: { id: string; name: string; avatarUrl: string }[];
}

function mapCrewRow(row: CrewRow) {
  return {
    id: row.id,
    name: row.name,
    pictureUri: row.picture_url ?? undefined,
    city: row.city,
    isPublic: row.is_public,
    creatorId: row.creator_id,
    creatorName: row.creator_name,
    creatorAvatarUrl: row.creator_avatar_url ?? '',
    allowPreviousImports: row.allow_previous_imports,
    allowMemberInvitations: row.allow_member_invitations,
    inGameChatEnabled: row.in_game_chat_enabled,
    maxCrewSize: row.max_crew_size,
    inviteCode: row.invite_code,
    members: row.members ?? [],
    createdAt: new Date(row.created_at).getTime(),
  };
}

const CREW_SELECT = `
  SELECT c.id, c.name, c.picture_url, c.city, c.is_public, c.creator_id,
         c.allow_previous_imports, c.allow_member_invitations, c.in_game_chat_enabled,
         c.max_crew_size, c.invite_code, c.created_at,
         creator.display_name AS creator_name,
         creator.avatar_url AS creator_avatar_url,
         COALESCE(
           (SELECT json_agg(json_build_object('id', u.id, 'name', u.display_name, 'avatarUrl', u.avatar_url))
              FROM crew_members cm
              JOIN app_users u ON u.id = cm.user_id
             WHERE cm.crew_id = c.id),
           '[]'::json
         ) AS members
    FROM crews c
    JOIN app_users creator ON creator.id = c.creator_id
`;

async function generateUniqueInviteCode(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const existing = await query(`SELECT 1 FROM crews WHERE invite_code = $1`, [code]);
    if (existing.length === 0) return code;
  }
  throw new CrewError('Não foi possível gerar um código único — tenta de novo.');
}

export async function listMyCrews(userId: string) {
  const rows = await query<CrewRow>(
    `${CREW_SELECT}
     WHERE c.creator_id = $1 OR EXISTS (
       SELECT 1 FROM crew_members cm WHERE cm.crew_id = c.id AND cm.user_id = $1
     )
     ORDER BY c.created_at DESC`,
    [userId]
  );
  return rows.map(mapCrewRow);
}

async function requireOwnedCrew(userId: string, crewId: string) {
  const rows = await query<{ creator_id: string }>(`SELECT creator_id FROM crews WHERE id = $1`, [crewId]);
  if (rows.length === 0) throw new CrewError('Crew não encontrado.');
  if (rows[0].creator_id !== userId) throw new CrewError('Só o criador do crew pode fazer isso.');
}

export async function createCrew(
  userId: string,
  input: {
    name: string;
    pictureUri?: string;
    city: string;
    isPublic: boolean;
    allowPreviousImports: boolean;
    allowMemberInvitations: boolean;
    inGameChatEnabled: boolean;
    maxCrewSize: number | null;
  }
) {
  const inviteCode = await generateUniqueInviteCode();

  const rows = await query<{ id: string }>(
    `INSERT INTO crews
       (name, picture_url, city, is_public, creator_id, allow_previous_imports,
        allow_member_invitations, in_game_chat_enabled, max_crew_size, invite_code)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      input.name,
      input.pictureUri ?? null,
      input.city,
      input.isPublic,
      userId,
      input.allowPreviousImports,
      input.allowMemberInvitations,
      input.inGameChatEnabled,
      input.maxCrewSize,
      inviteCode,
    ]
  );

  const [crew] = await query<CrewRow>(`${CREW_SELECT} WHERE c.id = $1`, [rows[0].id]);
  return mapCrewRow(crew);
}

export async function updateCrew(
  userId: string,
  crewId: string,
  input: {
    name: string;
    pictureUri?: string;
    city: string;
    isPublic: boolean;
    allowPreviousImports: boolean;
    allowMemberInvitations: boolean;
    inGameChatEnabled: boolean;
    maxCrewSize: number | null;
  }
) {
  await requireOwnedCrew(userId, crewId);

  await query(
    `UPDATE crews
        SET name = $1, picture_url = $2, city = $3, is_public = $4,
            allow_previous_imports = $5, allow_member_invitations = $6,
            in_game_chat_enabled = $7, max_crew_size = $8
      WHERE id = $9`,
    [
      input.name,
      input.pictureUri ?? null,
      input.city,
      input.isPublic,
      input.allowPreviousImports,
      input.allowMemberInvitations,
      input.inGameChatEnabled,
      input.maxCrewSize,
      crewId,
    ]
  );

  const [crew] = await query<CrewRow>(`${CREW_SELECT} WHERE c.id = $1`, [crewId]);
  return mapCrewRow(crew);
}

export async function deleteCrew(userId: string, crewId: string) {
  await requireOwnedCrew(userId, crewId);
  await query(`DELETE FROM crews WHERE id = $1`, [crewId]);
}

export async function joinCrew(userId: string, inviteCode: string) {
  const rows = await query<{ id: string; creator_id: string; max_crew_size: number | null }>(
    `SELECT id, creator_id, max_crew_size FROM crews WHERE invite_code = $1`,
    [inviteCode]
  );
  if (rows.length === 0) throw new CrewError('Código de convite inválido.');

  const crew = rows[0];
  if (crew.creator_id === userId) throw new CrewError('Você já é o dono desse crew.');

  const already = await query(
    `SELECT 1 FROM crew_members WHERE crew_id = $1 AND user_id = $2`,
    [crew.id, userId]
  );
  if (already.length > 0) throw new CrewError('Você já faz parte desse crew.');

  if (crew.max_crew_size !== null) {
    const countRows = await query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM crew_members WHERE crew_id = $1`,
      [crew.id]
    );
    // +1 pra contar o próprio criador, que não está em crew_members
    if (Number(countRows[0].count) + 1 >= crew.max_crew_size) {
      throw new CrewError('Esse crew já está cheio.');
    }
  }

  await query(`INSERT INTO crew_members (crew_id, user_id) VALUES ($1, $2)`, [crew.id, userId]);

  const [fullCrew] = await query<CrewRow>(`${CREW_SELECT} WHERE c.id = $1`, [crew.id]);
  return mapCrewRow(fullCrew);
}

export async function leaveCrew(userId: string, crewId: string) {
  await query(`DELETE FROM crew_members WHERE crew_id = $1 AND user_id = $2`, [crewId, userId]);
}
