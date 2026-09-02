import { query } from '../../db/pool';

export type AudienceCategory = 'free' | 'subscriber' | 'influencer' | 'cancelled';

export class BroadcastError extends Error {}

// Cada categoria vira uma condição SQL diferente — free/subscriber/
// influencer vêm direto de app_users.role; "cancelled" é quem teve a
// assinatura mais recente cancelada (independente do role atual, já
// que cancelar pode ou não já ter revertido o role pra free).
function whereClauseFor(category: AudienceCategory): string {
  switch (category) {
    case 'free':
      return `role = 'free'`;
    case 'subscriber':
      return `role = 'subscriber'`;
    case 'influencer':
      return `role = 'influencer'`;
    case 'cancelled':
      return `id IN (
        SELECT user_id FROM (
          SELECT DISTINCT ON (user_id) user_id, status
            FROM user_subscriptions
           ORDER BY user_id, created_at DESC
        ) latest_subscription
       WHERE latest_subscription.status = 'canceled'
      )`;
  }
}

export async function getAudienceCount(category: AudienceCategory): Promise<number> {
  const rows = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM app_users WHERE ${whereClauseFor(category)}`
  );
  return Number(rows[0].count);
}

// Grava a notificação de todo mundo da categoria numa tacada só (rápido,
// é só um INSERT...SELECT) — isso já garante que todo mundo vê no
// histórico/sino do app, mesmo que o push em si (aviso do sistema
// operacional) não chegue por falta de token.
async function bulkInsertNotifications(category: AudienceCategory, title: string, subtitle: string) {
  await query(
    `INSERT INTO notifications (user_id, category, title, subtitle)
     SELECT id, 'sevenclub', $1, $2
       FROM app_users
      WHERE ${whereClauseFor(category)}`,
    [title, subtitle]
  );
}

// Expo aceita até 100 mensagens por requisição — muito mais rápido que
// uma chamada HTTP por usuário quando são milhares de destinatários.
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_BATCH_SIZE = 100;

async function sendPushBatches(tokens: string[], title: string, body: string) {
  for (let i = 0; i < tokens.length; i += EXPO_BATCH_SIZE) {
    const batch = tokens.slice(i, i + EXPO_BATCH_SIZE);
    try {
      await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(batch.map((token) => ({ to: token, title, body, sound: 'default' }))),
      });
    } catch (err) {
      // um lote falhando (rede, etc.) não deveria travar os outros —
      // cada lote é independente
      console.warn('Falha ao enviar lote de push:', err);
    }
  }
}

// Dispara o broadcast pra uma categoria inteira. O histórico é
// gravado de forma síncrona (rápido, uma query só) antes de responder
// — assim o dashboard já sabe que funcionou. O push em si roda em
// segundo plano (fire-and-forget) porque, com milhares de
// destinatários, esperar cada lote terminar deixaria a requisição
// HTTP pendurada por muito tempo.
export async function broadcastToCategory(category: AudienceCategory, title: string, body: string) {
  const recipientCount = await getAudienceCount(category);
  if (recipientCount === 0) {
    throw new BroadcastError('Nenhum usuário nessa categoria no momento.');
  }

  await bulkInsertNotifications(category, title, body);

  const tokenRows = await query<{ expo_push_token: string }>(
    `SELECT expo_push_token FROM app_users
      WHERE ${whereClauseFor(category)} AND expo_push_token IS NOT NULL`
  );
  const tokens = tokenRows.map((r) => r.expo_push_token);

  sendPushBatches(tokens, title, body).catch((err) => {
    console.warn('Falha no broadcast de push:', err);
  });

  return { recipientCount, pushTokensFound: tokens.length };
}
