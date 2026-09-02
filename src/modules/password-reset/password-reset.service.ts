import crypto from 'crypto';
import { query } from '../../db/pool';
import { hashPassword, validatePasswordStrength } from '../../utils/password';
import { env } from '../../config/env';
import { isEmailConfigured, sendEmail } from '../../integrations/resend/email.service';

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

// Único canal de recuperação agora é e-mail (Resend) — telefone
// deixou de ser usado como canal de entrega (a coluna `channel` na
// tabela continua existindo com o valor fixo 'email', pra não exigir
// uma migration só por causa dessa simplificação).
async function sendResetCode(contact: string, code: string): Promise<string | undefined> {
  if (isEmailConfigured()) {
    await sendEmail(
      contact,
      'Seven Club — Código de recuperação de senha',
      `<p>Seu código de recuperação é <strong>${code}</strong>.</p><p>Válido por ${CODE_TTL_MINUTES} minutos.</p>`
    );
    return undefined;
  }
  return env.isProduction ? undefined : code;
}

// Etapa 1: e-mail. A resposta tem sempre o mesmo formato, exista ou
// não uma conta com esse e-mail — isso evita que a rota vire uma forma
// de descobrir quais e-mails estão cadastrados. Quando não existe
// conta, criamos um registro com user_id nulo: ele nunca vai validar
// nenhum código de verdade, mas o app não percebe diferença nenhuma
// na resposta.
export async function startPasswordReset(email: string) {
  const rows = await query<{ id: string }>(
    `SELECT id FROM app_users WHERE email = $1 AND status = 'active'`,
    [email]
  );
  const userId: string | null = rows[0]?.id ?? null;

  const code = generateCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000);

  const inserted = await query<{ id: string }>(
    `INSERT INTO password_reset_verifications (user_id, channel, code_hash, expires_at)
     VALUES ($1, 'email', $2, $3)
     RETURNING id`,
    [userId, hashCode(code), expiresAt]
  );

  // Só manda/mostra código quando existe conta de verdade (userId
  // real) — pro registro "fantasma" nunca enviamos nem mostramos nada,
  // mas a resposta continua idêntica de qualquer forma (não vaza se a
  // conta existe).
  const devCode = userId ? await sendResetCode(email, code) : undefined;

  return {
    resetId: inserted[0].id,
    expiresInSeconds: CODE_TTL_MINUTES * 60,
    devCode,
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

  let devCode: string | undefined;
  if (record.user_id) {
    // registro original não guarda o e-mail em si (só o user_id) —
    // busca de volta em app_users
    const contactRow = await query<{ email: string }>(
      `SELECT email FROM app_users WHERE id = $1`,
      [record.user_id]
    );
    if (contactRow[0]) {
      devCode = await sendResetCode(contactRow[0].email, code);
    }
  }

  return {
    expiresInSeconds: CODE_TTL_MINUTES * 60,
    devCode,
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
  const passwordError = validatePasswordStrength(newPassword);
  if (passwordError) throw new PasswordResetError(passwordError);

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
