import { query } from '../../db/pool';

export class ReferralError extends Error {}

export async function redeemReferralCode(userId: string, code: string) {
  const rows = await query<{ id: string; referred_by: string | null }>(
    `SELECT id, referred_by FROM app_users WHERE id = $1`,
    [userId]
  );
  const me = rows[0];
  if (!me) throw new ReferralError('Usuário não encontrado.');
  if (me.referred_by) throw new ReferralError('Você já usou um código de indicação antes.');

  const referrerRows = await query<{ id: string }>(
    `SELECT id FROM app_users WHERE referral_code = $1`,
    [code.toUpperCase()]
  );
  if (referrerRows.length === 0) throw new ReferralError('Código de convite inválido.');
  const referrer = referrerRows[0];

  if (referrer.id === userId) {
    throw new ReferralError('Você não pode usar seu próprio código.');
  }

  await query(`UPDATE app_users SET referred_by = $1 WHERE id = $2`, [referrer.id, userId]);
}

export async function getMyReferralInfo(userId: string) {
  const rows = await query<{ referral_code: string | null }>(
    `SELECT referral_code FROM app_users WHERE id = $1`,
    [userId]
  );
  const countRows = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM app_users WHERE referred_by = $1`,
    [userId]
  );

  return {
    referralCode: rows[0]?.referral_code ?? null,
    referredCount: Number(countRows[0]?.count ?? 0),
  };
}
