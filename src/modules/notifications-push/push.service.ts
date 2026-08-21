import { query } from '../../db/pool';
import { createNotification } from '../notifications/notifications.service';

export async function registerPushToken(userId: string, token: string) {
  await query(`UPDATE app_users SET expo_push_token = $1 WHERE id = $2`, [token, userId]);
}

// Expo Push API é só um endpoint HTTP simples — não precisa de SDK nem
// de conta paga, funciona com qualquer token válido gerado pelo próprio
// app via expo-notifications.
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export async function sendExpoPushNotification(params: {
  expoPushToken: string;
  title: string;
  body: string;
}) {
  const res = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      to: params.expoPushToken,
      title: params.title,
      body: params.body,
      sound: 'default',
    }),
  });

  const data: any = await res.json().catch(() => null);

  // A Expo Push API devolve 200 mesmo quando o envio falha (token
  // inválido/expirado) — o erro real vem dentro do corpo da resposta,
  // não no status HTTP.
  const ticket = data?.data;
  if (ticket?.status === 'error') {
    throw new Error(ticket.message ?? 'Falha ao enviar notificação push.');
  }

  return ticket;
}

export async function sendTestNotificationToUser(userId: string, title: string, body: string) {
  const rows = await query<{ expo_push_token: string | null; display_name: string }>(
    `SELECT expo_push_token, display_name FROM app_users WHERE id = $1`,
    [userId]
  );

  if (rows.length === 0) {
    throw new Error('Usuário não encontrado.');
  }

  // Grava no histórico independente de ter token de push registrado —
  // assim a pessoa vê a notificação na tela do app (sino) mesmo que o
  // push em si (aviso do sistema operacional) não tenha sido entregue.
  await createNotification({ userId, category: 'sevenclub', title, subtitle: body });

  if (!rows[0].expo_push_token) {
    throw new Error(
      `${rows[0].display_name} ainda não abriu o app com a notificação registrada (sem token salvo) — mas já ficou salva no histórico dela.`
    );
  }

  return sendExpoPushNotification({ expoPushToken: rows[0].expo_push_token, title, body });
}
