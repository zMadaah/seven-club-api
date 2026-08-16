import { query } from '../../db/pool';

// Espelha DEFAULT_NOTIFICATION_PREFERENCES do app
// (types/notificationPreference.ts) — mesmo formato, mesmos defaults.
// Isto é só a PREFERÊNCIA (o que a pessoa quer receber). O envio de
// verdade (push notification disparada quando alguém curte, comenta,
// rouba território etc.) é uma peça de infraestrutura própria — precisa
// de registro de token de push (Expo), e um gatilho em cada evento
// (curtida, comentário, roubo...) que dispare o envio respeitando essa
// preferência. Não existe ainda; isto aqui só guarda o que a pessoa
// escolheu, pronto pra quando o envio for construído.
export interface NotificationPreferences {
  heartedActivity: boolean;
  heartedStatus: boolean;
  commentOnActivity: boolean;
  commentOnStatus: boolean;
  repliedToComment: boolean;
  followingYou: boolean;
  followRequest: boolean;
  questionAnswered: boolean;
  privateLobbyInvite: boolean;
  clubInvite: boolean;
  territoryStolenSingle: boolean;
  territoryStolenPrivateLobby: boolean;
  referralCodeUsed: boolean;
  marketingAnnouncements: boolean;
  captureThreshold5OrLess: boolean;
  captureThreshold5To20: boolean;
}

export async function getNotificationPreferences(userId: string): Promise<NotificationPreferences> {
  const rows = await query<{ notification_preferences: NotificationPreferences }>(
    `SELECT notification_preferences FROM app_users WHERE id = $1`,
    [userId]
  );
  return rows[0].notification_preferences;
}

// Atualização parcial: só sobrescreve as chaves enviadas, preserva o
// resto — assim o app pode mandar só o toggle que a pessoa mexeu, sem
// precisar reenviar as 16 chaves toda vez.
export async function updateNotificationPreferences(
  userId: string,
  patch: Partial<NotificationPreferences>
): Promise<NotificationPreferences> {
  const rows = await query<{ notification_preferences: NotificationPreferences }>(
    `UPDATE app_users
        SET notification_preferences = notification_preferences || $2::jsonb,
            updated_at = now()
      WHERE id = $1
      RETURNING notification_preferences`,
    [userId, JSON.stringify(patch)]
  );
  return rows[0].notification_preferences;
}
