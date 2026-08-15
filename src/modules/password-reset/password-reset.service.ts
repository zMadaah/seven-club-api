import crypto from 'crypto';
import { query } from '../../db/pool';
import { hashPassword } from '../../utils/password';
import { env } from '../../config/env';

export class PasswordResetError extends Error {}

const CODE_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_SECONDS = 60;

function generateCode(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

function hashCode(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex');
}

// Etapa 1: e-mail ou celular. A resposta tem sempre o mesmo formato,
// exista ou não uma conta com esse contato — isso evita que a rota vire
// uma forma de descobrir quais e-mails/celulares estão cadastrados.
// Quando não existe conta, criamos um registro com user_id nulo: ele
// nunca vai validar nenhum código de verdade, mas o app não percebe
// diferença nenhuma na resposta.
export async function startPasswordReset(method: 'email' | 'phone', contact: string) {
  const column = method === 'phone' ? 'phone' : 'email';
  const rows = await query<{ id: string }>(
    `SELECT id FROM app_users WHERE ${column} = $1 AND status = 'active'`,
    [contact]
  );
  const userId: string | null = rows[0]?.id ?? null;

  const code = generateCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000);

  const inserted = await query<{ id: string }>(
    `INSERT INTO password_reset_verifications (user_id, channel, code_hash, expires_at)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [userId, method, hashCode(code), expiresAt]
  );

  // TODO produção: enviar o código de verdade por e-mail (SES/SendGrid) ou
  // SMS (Zenvia/Twilio/SNS) pro `contact` — só quando userId existir. Sem
  // conta, não enviamos nada, mas a resposta abaixo é idêntica mesmo assim.
  return {
    resetId: inserted[0].id,
    expiresInSeconds: CODE_TTL_MINUTES * 60,
    devCode: !env.isProduction && userId ? code : undefined,
  };
}

export async function resendPasswordResetCode(resetId: string) {
  const rows = await query<{
    id: string;
    user_id: string | null;
    verified_at: string | null;
    last_sent_at: string;
  }>(
    `SELECT id, user_id, verified_at, last_sent_at FROM password_reset_verifications WHERE id = $1`,
    [resetId]
  );
  if (rows.length === 0) throw new PasswordResetError('Pedido de recuperação não encontrado ou expirado.');
  const record = rows[0];

  if (record.verified_at) throw new PasswordResetError('Código já verificado.');

  const secondsSinceLastSend = (Date.now() - new Date(record.last_sent_at).getTime()) / 1000;
  if (secondsSinceLastSend < RESEND_COOLDOWN_SECONDS) {
    throw new PasswordResetError('Aguarde um pouco antes de pedir um novo código.');
  }

  const code = generateCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000);

  await query(
    `UPDATE password_reset_verifications
        SET code_hash = $1, expires_at = $2, attempts = 0, last_sent_at = now()
      WHERE id = $3`,
    [hashCode(code), expiresAt, resetId]
  );

  return {
    expiresInSeconds: CODE_TTL_MINUTES * 60,
    devCode: !env.isProduction && record.user_id ? code : undefined,
  };
}

export async function verifyPasswordResetCode(resetId: string, code: string) {
  const rows = await query<{
    id: string;
    user_id: string | null;
    code_hash: string;
    attempts: number;
    verified_at: string | null;
    expires_at: string;
  }>(
    `SELECT id, user_id, code_hash, attempts, verified_at, expires_at
       FROM password_reset_verifications WHERE id = $1`,
    [resetId]
  );
  if (rows.length === 0) throw new PasswordResetError('Pedido de recuperação não encontrado ou expirado.');
  const record = rows[0];

  if (record.verified_at) return { verified: true };

  if (new Date(record.expires_at).getTime() < Date.now()) {
    throw new PasswordResetError('Código expirado. Peça um novo.');
  }
  if (record.attempts >= MAX_ATTEMPTS) {
    throw new PasswordResetError('Número máximo de tentativas excedido. Peça um novo código.');
  }

  // registro "fantasma" (user_id nulo): nenhum código bate nunca, então
  // sempre cai como "incorreto" — sem vazar se a conta existe ou não
  if (!record.user_id || hashCode(code) !== record.code_hash) {
    await query(`UPDATE password_reset_verifications SET attempts = attempts + 1 WHERE id = $1`, [resetId]);
    throw new PasswordResetError('Código incorreto.');
  }

  await query(`UPDATE password_reset_verifications SET verified_at = now() WHERE id = $1`, [resetId]);
  return { verified: true };
}

// Etapa 3: nova senha. Derruba todas as sessões existentes do usuário —
// proteção padrão pro caso da senha antiga ter vazado (é por isso que
// estamos nesse fluxo, afinal).
export async function completePasswordReset(resetId: string, newPassword: string) {
  const rows = await query<{
    id: string;
    user_id: string | null;
    verified_at: string | null;
    expires_at: string;
  }>(
    `SELECT id, user_id, verified_at, expires_at FROM password_reset_verifications WHERE id = $1`,
    [resetId]
  );
  if (rows.length === 0) throw new PasswordResetError('Pedido de recuperação não encontrado ou expirado.');
  const record = rows[0];

  if (!record.verified_at || !record.user_id) {
    throw new PasswordResetError('Verifique o código antes de redefinir a senha.');
  }
  if (new Date(record.expires_at).getTime() < Date.now()) {
    throw new PasswordResetError('Pedido de recuperação expirado. Comece de novo.');
  }

  const passwordHash = await hashPassword(newPassword);
  await query(`UPDATE app_users SET password_hash = $1 WHERE id = $2`, [passwordHash, record.user_id]);

  await query(
    `UPDATE auth_refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
    [record.user_id]
  );

  await query(`DELETE FROM password_reset_verifications WHERE id = $1`, [resetId]);

  return { success: true };
}
