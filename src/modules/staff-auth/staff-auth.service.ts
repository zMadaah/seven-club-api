import { query } from '../../db/pool';
import { hashPassword, verifyPassword } from '../../utils/password';
import { signStaffAccessToken } from '../../utils/jwt';

export class StaffAuthError extends Error {}

interface StaffRow {
  id: string;
  name: string;
  email: string;
}

export async function registerStaff(email: string, password: string, name: string) {
  const existing = await query(`SELECT id FROM staff_users WHERE email = $1`, [email]);
  if (existing.length > 0) throw new StaffAuthError('Já existe uma conta de staff com esse e-mail.');

  const passwordHash = await hashPassword(password);
  const rows = await query<StaffRow>(
    `INSERT INTO staff_users (email, password_hash, name) VALUES ($1, $2, $3)
     RETURNING id, name, email`,
    [email, passwordHash, name]
  );

  return { token: signStaffAccessToken(rows[0].id), user: rows[0] };
}

export async function loginStaff(email: string, password: string) {
  const rows = await query<StaffRow & { password_hash: string }>(
    `SELECT id, name, email, password_hash FROM staff_users WHERE email = $1`,
    [email]
  );
  if (rows.length === 0) throw new StaffAuthError('E-mail ou senha inválidos.');

  const valid = await verifyPassword(password, rows[0].password_hash);
  if (!valid) throw new StaffAuthError('E-mail ou senha inválidos.');

  const { password_hash, ...user } = rows[0];
  return { token: signStaffAccessToken(user.id), user };
}

export async function getStaffMe(staffId: string) {
  const rows = await query<StaffRow>(`SELECT id, name, email FROM staff_users WHERE id = $1`, [staffId]);
  return rows[0] ?? null;
}

// Só apaga a PRÓPRIA conta (via token), não qualquer uma por id — assim
// não precisa de nenhuma checagem de permissão extra pra isso ser seguro
// de deixar disponível em homologação.
export async function deleteStaff(staffId: string) {
  await query(`DELETE FROM staff_users WHERE id = $1`, [staffId]);
}
