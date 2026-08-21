import { query } from '../../db/pool';

export type NotificationCategory = 'territory' | 'invite' | 'community' | 'sevenclub';

interface NotificationRow {
  id: string;
  category: NotificationCategory;
  title: string;
  subtitle: string;
  read: boolean;
  created_at: string;
}

// "há 12 min" / "há 2 h" / "há 3 d" — mesmo estilo textual que o mock
// antigo já usava (timeAgo), calculado a partir de created_at real.
function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  return `${days} d`;
}

function mapNotification(r: NotificationRow) {
  return {
    id: r.id,
    category: r.category,
    title: r.title,
    subtitle: r.subtitle,
    timeAgo: timeAgo(r.created_at),
    read: r.read,
  };
}

export async function listNotifications(userId: string) {
  const rows = await query<NotificationRow>(
    `SELECT id, category, title, subtitle, read, created_at
       FROM notifications
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 100`,
    [userId]
  );
  return rows.map(mapNotification);
}

export async function markNotificationRead(userId: string, notificationId: string) {
  await query(`UPDATE notifications SET read = TRUE WHERE id = $1 AND user_id = $2`, [
    notificationId,
    userId,
  ]);
}

// Chamada tanto pelo envio de teste do dashboard quanto por qualquer
// evento real do app no futuro (convite de lobby, roubo de território
// etc.) — um único lugar que grava no histórico, pra tudo que gera
// notificação já aparecer na tela de notificações do usuário.
export async function createNotification(params: {
  userId: string;
  category: NotificationCategory;
  title: string;
  subtitle: string;
}) {
  await query(
    `INSERT INTO notifications (user_id, category, title, subtitle)
     VALUES ($1, $2, $3, $4)`,
    [params.userId, params.category, params.title, params.subtitle]
  );
}
