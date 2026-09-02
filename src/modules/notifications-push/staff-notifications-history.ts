import { query } from '../../db/pool';

// Histórico agregado pro dashboard — diferente de GET /notifications
// (rota do app, só devolve notificações do PRÓPRIO usuário logado).
// Essa é staff-only, lista de TODO MUNDO, com o nome de quem recebeu.
export async function listNotificationsForStaff(page = 1, pageSize = 20) {
  const offset = (page - 1) * pageSize;

  const rows = await query<{
    id: string;
    category: string;
    title: string;
    subtitle: string;
    created_at: string;
    recipient_name: string;
  }>(
    `SELECT n.id, n.category, n.title, n.subtitle, n.created_at, u.display_name AS recipient_name
       FROM notifications n
       JOIN app_users u ON u.id = n.user_id
      ORDER BY n.created_at DESC
      LIMIT $1 OFFSET $2`,
    [pageSize, offset]
  );

  const countRows = await query<{ count: string }>(`SELECT COUNT(*) AS count FROM notifications`);
  const total = Number(countRows[0].count);

  return {
    notifications: rows.map((r) => ({
      id: r.id,
      category: r.category,
      title: r.title,
      subtitle: r.subtitle,
      createdAt: r.created_at,
      recipientName: r.recipient_name,
    })),
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  };
}
