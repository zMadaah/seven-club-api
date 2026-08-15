import { query } from '../../db/pool';

export class StaffUserError extends Error {}

// O dashboard foi escrito esperando active|inactive|suspended. O backend
// usa active|suspended|banned de verdade — esse é o enum que o login
// (auth.service.ts) checa pra bloquear acesso, não dá pra trocar sem
// risco. Em vez disso, mapeia só na borda: "banned" vira "inactive" pro
// dashboard, e volta pra "banned" quando o dashboard manda atualizar.
type DashboardStatus = 'active' | 'inactive' | 'suspended';
type InternalStatus = 'active' | 'suspended' | 'banned';

function toDashboardStatus(status: InternalStatus): DashboardStatus {
  return status === 'banned' ? 'inactive' : status;
}

function toInternalStatus(status: DashboardStatus): InternalStatus {
  return status === 'inactive' ? 'banned' : status;
}

interface UserRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  email: string;
  phone: string | null;
  status: string;
  role: string;
  created_at: string;
}

function mapUser(r: UserRow) {
  return {
    id: r.id,
    first_name: r.first_name ?? '',
    last_name: r.last_name ?? '',
    username: r.username ?? '',
    email: r.email,
    phone: r.phone,
    status: toDashboardStatus(r.status as InternalStatus),
    role: r.role,
    created_at: r.created_at,
  };
}

export async function listUsers(params: {
  query?: string;
  status?: DashboardStatus;
  role?: string;
  page: number;
  pageSize: number;
}) {
  const { query: search, status, role, page, pageSize } = params;
  const offset = (page - 1) * pageSize;

  const conditions: string[] = [];
  const values: any[] = [];
  let i = 0;

  if (search) {
    i++;
    conditions.push(`(email ILIKE $${i} OR display_name ILIKE $${i} OR username ILIKE $${i})`);
    values.push(`%${search}%`);
  }
  if (status) {
    i++;
    conditions.push(`status = $${i}`);
    values.push(toInternalStatus(status));
  }
  if (role) {
    i++;
    conditions.push(`role = $${i}`);
    values.push(role);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countRows = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM app_users ${whereClause}`,
    values
  );

  const rows = await query<UserRow>(
    `SELECT id, first_name, last_name, username, email, phone, status, role, created_at
       FROM app_users
       ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${i + 1} OFFSET $${i + 2}`,
    [...values, pageSize, offset]
  );

  const total = Number(countRows[0].count);

  return {
    users: rows.map(mapUser),
    pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  };
}

export async function updateUser(
  userId: string,
  input: {
    firstName?: string;
    lastName?: string;
    username?: string;
    email?: string;
    phone?: string;
    role?: string;
  }
) {
  const rows = await query<UserRow>(
    `UPDATE app_users
        SET first_name = COALESCE($2, first_name),
            last_name  = COALESCE($3, last_name),
            username   = COALESCE($4, username),
            email      = COALESCE($5, email),
            phone      = COALESCE($6, phone),
            role       = COALESCE($7, role),
            updated_at = now()
      WHERE id = $1
      RETURNING id, first_name, last_name, username, email, phone, status, role, created_at`,
    [
      userId,
      input.firstName ?? null,
      input.lastName ?? null,
      input.username ?? null,
      input.email ?? null,
      input.phone ?? null,
      input.role ?? null,
    ]
  );
  if (rows.length === 0) throw new StaffUserError('Usuário não encontrado.');
  return mapUser(rows[0]);
}

export async function updateUserStatus(userId: string, status: DashboardStatus) {
  const rows = await query<UserRow>(
    `UPDATE app_users SET status = $2, updated_at = now() WHERE id = $1
     RETURNING id, first_name, last_name, username, email, phone, status, role, created_at`,
    [userId, toInternalStatus(status)]
  );
  if (rows.length === 0) throw new StaffUserError('Usuário não encontrado.');
  return mapUser(rows[0]);
}
