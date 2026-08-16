import { query, pool } from '../../db/pool';
import { verifyPassword } from '../../utils/password';
import { signAccessToken, generateRefreshToken, hashRefreshToken } from '../../utils/jwt';
import { env } from '../../config/env';

export class AuthError extends Error {}

export async function issueSession(userId: string) {
  const accessToken = signAccessToken(userId);
  const refreshToken = generateRefreshToken();
  const refreshTokenHash = hashRefreshToken(refreshToken);
  const expiresAt = new Date(Date.now() + env.refreshTokenTtlDays * 24 * 60 * 60 * 1000);

  await query(
    `INSERT INTO auth_refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [userId, refreshTokenHash, expiresAt]
  );

  return { accessToken, refreshToken };
}

export async function login(email: string, password: string) {
  const rows = await query<{ id: string; password_hash: string; status: string }>(
    `SELECT id, password_hash, status FROM app_users WHERE email = $1`,
    [email]
  );

  if (rows.length === 0) throw new AuthError('E-mail ou senha inválidos.');

  const user = rows[0];
  if (user.status !== 'active') throw new AuthError('Conta suspensa ou banida.');

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) throw new AuthError('E-mail ou senha inválidos.');

  await query(`UPDATE app_users SET last_login_at = now() WHERE id = $1`, [user.id]);

  return issueSession(user.id);
}

// Rotação de refresh token: cada uso invalida o anterior e emite um novo
// par. Se um refresh token vazado for usado depois do dono já ter
// renovado, ele vem marcado como revogado e a chamada falha.
export async function refreshSession(refreshToken: string) {
  const tokenHash = hashRefreshToken(refreshToken);

  const rows = await query<{ id: string; user_id: string; revoked_at: string | null; expires_at: string }>(
    `SELECT id, user_id, revoked_at, expires_at FROM auth_refresh_tokens WHERE token_hash = $1`,
    [tokenHash]
  );

  if (rows.length === 0) throw new AuthError('Refresh token inválido.');
  const record = rows[0];

  if (record.revoked_at || new Date(record.expires_at).getTime() < Date.now()) {
    throw new AuthError('Refresh token expirado ou revogado.');
  }

  await query(`UPDATE auth_refresh_tokens SET revoked_at = now() WHERE id = $1`, [record.id]);

  return issueSession(record.user_id);
}

export async function logout(refreshToken: string) {
  const tokenHash = hashRefreshToken(refreshToken);
  await query(
    `UPDATE auth_refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`,
    [tokenHash]
  );
}

const PROFILE_FIELDS = `
  id, email, display_name, first_name, last_name, avatar_url, bio,
  date_of_birth, gender, profile_color, location, country_code, phone,
  profile_visibility, map_visibility, referral_code, referred_by,
  featured_badge_id, anonymous_mode,
  total_distance_km, total_territory_km2, rival_count, created_at
`;

export async function getMe(userId: string) {
  const rows = await query<any>(
    `SELECT ${PROFILE_FIELDS} FROM app_users WHERE id = $1`,
    [userId]
  );
  return rows[0] ?? null;
}

export async function updateMe(
  userId: string,
  input: {
    displayName?: string;
    firstName?: string;
    lastName?: string;
    bio?: string;
    avatarUrl?: string;
    location?: string;
    countryCode?: string;
    dateOfBirth?: string; // 'YYYY-MM-DD'
    gender?: string;
    profileColor?: string;
    profileVisibility?: 'public' | 'followers';
    mapVisibility?: 'everyone' | 'crew' | 'nobody';
    featuredBadgeId?: string | null;
    anonymousMode?: boolean;
  }
) {
  const rows = await query<any>(
    `UPDATE app_users
        SET display_name        = COALESCE($2, display_name),
            first_name          = COALESCE($3, first_name),
            last_name           = COALESCE($4, last_name),
            bio                 = COALESCE($5, bio),
            avatar_url          = COALESCE($6, avatar_url),
            location            = COALESCE($7, location),
            country_code        = COALESCE($8, country_code),
            date_of_birth       = COALESCE($9, date_of_birth),
            gender              = COALESCE($10, gender),
            profile_color       = COALESCE($11, profile_color),
            profile_visibility  = COALESCE($12, profile_visibility),
            map_visibility      = COALESCE($13, map_visibility),
            featured_badge_id   = CASE WHEN $14::boolean THEN $15 ELSE featured_badge_id END,
            anonymous_mode      = CASE WHEN $16::boolean THEN $17::boolean ELSE anonymous_mode END,
            updated_at          = now()
      WHERE id = $1
      RETURNING ${PROFILE_FIELDS}`,
    [
      userId,
      input.displayName ?? null,
      input.firstName ?? null,
      input.lastName ?? null,
      input.bio ?? null,
      input.avatarUrl ?? null,
      input.location ?? null,
      input.countryCode?.toUpperCase() ?? null,
      input.dateOfBirth ?? null,
      input.gender ?? null,
      input.profileColor ?? null,
      input.profileVisibility ?? null,
      input.mapVisibility ?? null,
      input.featuredBadgeId !== undefined,
      input.featuredBadgeId ?? null,
      input.anonymousMode !== undefined,
      input.anonymousMode ?? null,
    ]
  );
  return rows[0] ?? null;
}

// Apaga atividades, rotas salvas e devolve o território capturado —
// "Remover dados" no app. Ação destrutiva de verdade, por isso roda tudo
// numa transação: ou limpa tudo, ou não muda nada.
export async function deleteMyData(userId: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM saved_routes WHERE user_id = $1`, [userId]);
    await client.query(
      `UPDATE territory_cells SET owner_user_id = NULL, captured_at = NULL WHERE owner_user_id = $1`,
      [userId]
    );
    // apaga as atividades por último: territory_capture_events referencia
    // activity_id com ON DELETE CASCADE, então isso limpa o histórico de
    // captura junto. Posts que citavam essas atividades sobrevivem (o
    // vínculo só fica nulo, ON DELETE SET NULL).
    await client.query(`DELETE FROM activities WHERE user_id = $1`, [userId]);
    await client.query(
      `UPDATE app_users SET total_distance_km = 0, total_territory_km2 = 0 WHERE id = $1`,
      [userId]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
