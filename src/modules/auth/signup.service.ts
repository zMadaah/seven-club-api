import crypto from 'crypto';
import { query } from '../../db/pool';
import { hashPassword, validatePasswordStrength } from '../../utils/password';
import { issueSession } from './auth.service';
import { env } from '../../config/env';

export class SignupError extends Error {}

const CODE_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_SECONDS = 60;

function generateCode(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

function hashCode(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex');
}

const REFERRAL_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

async function generateUniqueReferralCode(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    let code = '';
    for (let i = 0; i < 8; i++) {
      code += REFERRAL_CODE_CHARS[Math.floor(Math.random() * REFERRAL_CODE_CHARS.length)];
    }
    const existing = await query(`SELECT id FROM app_users WHERE referral_code = $1`, [code]);
    if (existing.length === 0) return code;
  }
  throw new SignupError('Não foi possível gerar um código de indicação. Tente de novo.');
}

// Mesmo critério do backfill da migration 019 — deriva do e-mail, resolve
// colisão com sufixo numérico. Só existe pro dashboard (campo obrigatório
// lá); o app não expõe/usa isso hoje.
async function generateUniqueUsername(email: string): Promise<string> {
  const base = email.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '');
  let candidate = base || 'usuario';
  let suffix = 1;
  while (true) {
    const existing = await query(`SELECT id FROM app_users WHERE username = $1`, [candidate]);
    if (existing.length === 0) return candidate;
    suffix += 1;
    candidate = `${base}${suffix}`;
  }
}

// Etapa 1: nome, e-mail, celular. Gera um código de 6 dígitos e cria um
// cadastro pendente — a conta em app_users só é criada na etapa 3.
export async function startSignup(name: string, email: string, phone: string) {
  const existing = await query(
    `SELECT id FROM app_users WHERE email = $1 OR phone = $2`,
    [email, phone]
  );
  if (existing.length > 0) {
    throw new SignupError('Já existe uma conta com esse e-mail ou celular.');
  }

  // Evita disparar SMS repetido pro mesmo número em menos de 1 minuto —
  // além do rate limit por IP na rota, isso barra o caso de alguém trocar
  // de IP mas continuar mirando o mesmo celular.
  const recent = await query<{ last_sent_at: string }>(
    `SELECT last_sent_at FROM signup_verifications
      WHERE phone = $1 AND last_sent_at > now() - interval '${RESEND_COOLDOWN_SECONDS} seconds'
      ORDER BY last_sent_at DESC LIMIT 1`,
    [phone]
  );
  if (recent.length > 0) {
    throw new SignupError('Aguarde um pouco antes de pedir um novo código.');
  }

  const code = generateCode();
  const codeHash = hashCode(code);
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000);

  // um cadastro pendente por e-mail — pedir de novo substitui o anterior
  await query(`DELETE FROM signup_verifications WHERE email = $1`, [email]);

  const rows = await query<{ id: string }>(
    `INSERT INTO signup_verifications (name, email, phone, code_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [name, email, phone, codeHash, expiresAt]
  );

  // TODO produção: integrar um provedor de SMS (Zenvia, Twilio, AWS SNS...)
  // pra mandar o código de verdade pro `phone`. Em homologação não temos
  // gateway configurado, então devolvemos o código na própria resposta
  // pra dar pra testar o fluxo inteiro sem depender de SMS real. Isso é
  // desligado automaticamente quando NODE_ENV=production.
  return {
    signupId: rows[0].id,
    expiresInSeconds: CODE_TTL_MINUTES * 60,
    devCode: env.isProduction ? undefined : code,
  };
}

// Etapa 2: valida o código recebido por SMS.
export async function verifySignupCode(signupId: string, code: string) {
  const rows = await query<{
    id: string;
    code_hash: string;
    attempts: number;
    verified_at: string | null;
    expires_at: string;
  }>(
    `SELECT id, code_hash, attempts, verified_at, expires_at FROM signup_verifications WHERE id = $1`,
    [signupId]
  );

  if (rows.length === 0) throw new SignupError('Cadastro não encontrado ou já expirado.');
  const record = rows[0];

  if (record.verified_at) {
    return { verified: true };
  }

  if (new Date(record.expires_at).getTime() < Date.now()) {
    throw new SignupError('Código expirado. Inicie o cadastro novamente.');
  }

  if (record.attempts >= MAX_ATTEMPTS) {
    throw new SignupError('Número máximo de tentativas excedido. Inicie o cadastro novamente.');
  }

  if (hashCode(code) !== record.code_hash) {
    await query(`UPDATE signup_verifications SET attempts = attempts + 1 WHERE id = $1`, [signupId]);
    throw new SignupError('Código incorreto.');
  }

  await query(`UPDATE signup_verifications SET verified_at = now() WHERE id = $1`, [signupId]);
  return { verified: true };
}

// Etapa 3: cria a senha e, com ela, a conta de verdade em app_users.
// Já devolve accessToken/refreshToken — a pessoa termina o cadastro logada.
export async function completeSignup(signupId: string, password: string) {
  const passwordError = validatePasswordStrength(password);
  if (passwordError) throw new SignupError(passwordError);

  const rows = await query<{
    id: string;
    name: string;
    email: string;
    phone: string;
    verified_at: string | null;
    expires_at: string;
  }>(
    `SELECT id, name, email, phone, verified_at, expires_at FROM signup_verifications WHERE id = $1`,
    [signupId]
  );

  if (rows.length === 0) throw new SignupError('Cadastro não encontrado ou já expirado.');
  const record = rows[0];

  if (!record.verified_at) throw new SignupError('O código ainda não foi validado.');
  if (new Date(record.expires_at).getTime() < Date.now()) {
    throw new SignupError('Cadastro expirado. Comece de novo.');
  }

  // checagem de novo aqui: cobre o caso raro de alguém completar dois
  // cadastros concorrentes pro mesmo e-mail/celular ao mesmo tempo
  const existing = await query(
    `SELECT id FROM app_users WHERE email = $1 OR phone = $2`,
    [record.email, record.phone]
  );
  if (existing.length > 0) {
    throw new SignupError('Já existe uma conta com esse e-mail ou celular.');
  }

  const passwordHash = await hashPassword(password);

  let userId: string;
  try {
    const userRows = await query<{ id: string }>(
      `INSERT INTO app_users (email, password_hash, display_name, phone, phone_verified, referral_code, username, country_code)
       VALUES ($1, $2, $3, $4, TRUE, $5, $6, 'BR')
       RETURNING id`,
      [
        record.email,
        passwordHash,
        record.name,
        record.phone,
        await generateUniqueReferralCode(),
        await generateUniqueUsername(record.email),
      ]
    );
    userId = userRows[0].id;
  } catch (err: any) {
    // corrida rara: dois completeSignup concorrentes passaram pela checagem
    // acima antes de qualquer um dos dois commitar — a constraint UNIQUE
    // do banco é a última linha de defesa.
    if (err?.code === '23505') {
      throw new SignupError('Já existe uma conta com esse e-mail ou celular.');
    }
    throw err;
  }

  await query(`DELETE FROM signup_verifications WHERE id = $1`, [signupId]);

  return issueSession(userId);
}

// Reenvio: gera um novo código pro mesmo cadastro pendente, sem precisar
// que o app reenvie nome/e-mail/celular de novo.
export async function resendSignupCode(signupId: string) {
  const rows = await query<{ id: string; verified_at: string | null; last_sent_at: string }>(
    `SELECT id, verified_at, last_sent_at FROM signup_verifications WHERE id = $1`,
    [signupId]
  );
  if (rows.length === 0) throw new SignupError('Cadastro não encontrado ou já expirado.');
  const record = rows[0];

  if (record.verified_at) throw new SignupError('Código já verificado.');

  const secondsSinceLastSend = (Date.now() - new Date(record.last_sent_at).getTime()) / 1000;
  if (secondsSinceLastSend < RESEND_COOLDOWN_SECONDS) {
    throw new SignupError('Aguarde um pouco antes de pedir um novo código.');
  }

  const code = generateCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000);

  await query(
    `UPDATE signup_verifications
        SET code_hash = $1, expires_at = $2, attempts = 0, last_sent_at = now()
      WHERE id = $3`,
    [hashCode(code), expiresAt, signupId]
  );

  return {
    expiresInSeconds: CODE_TTL_MINUTES * 60,
    devCode: env.isProduction ? undefined : code,
  };
}
