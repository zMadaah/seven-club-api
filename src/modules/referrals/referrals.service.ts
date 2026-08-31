import { query } from '../../db/pool';
import { grantXp } from '../progress/xp.service';
import { createNotification } from '../notifications/notifications.service';

export class ReferralError extends Error {}

// Mesma faixa dos desafios de Progress (10-100 XP) — trazer alguém novo
// pro app é uma das ações mais valiosas que existe, por isso fica no
// topo da faixa, empatado com "correr 5 vezes".
const REFERRAL_XP = 50;

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

  // XP pra quem indicou, não pra quem usou o código — recompensa quem
  // trouxe gente nova pro app. source_id é o id do novo usuário, então
  // cada indicação só concede XP uma vez (não tem como resgatar o
  // mesmo "evento" duas vezes).
  await grantXp(referrer.id, 'referral', userId, REFERRAL_XP);

  const newUserRows = await query<{ display_name: string }>(
    `SELECT display_name FROM app_users WHERE id = $1`,
    [userId]
  );
  const newUserName = newUserRows[0]?.display_name ?? 'Alguém';

  await createNotification({
    userId: referrer.id,
    category: 'community',
    title: 'Sua indicação valeu XP!',
    subtitle: `${newUserName} entrou com seu código — você ganhou ${REFERRAL_XP} XP.`,
  });
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
