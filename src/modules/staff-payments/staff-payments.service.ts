import { query } from '../../db/pool';

interface PaymentsSummaryRow {
  paid_count: string;
  paid_total_cents: string;
  failed_today: string;
  refunded_count: string;
}

export async function getPaymentsSummary() {
  const rows = await query<PaymentsSummaryRow>(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'paid') AS paid_count,
       COALESCE(SUM(amount_cents) FILTER (WHERE status = 'paid'), 0) AS paid_total_cents,
       COUNT(*) FILTER (WHERE status = 'failed' AND created_at >= date_trunc('day', now())) AS failed_today,
       COUNT(*) FILTER (WHERE status = 'refunded') AS refunded_count
     FROM payments`
  );

  const byStatusRows = await query<{ status: string; count: string }>(
    `SELECT status, COUNT(*) AS count FROM payments GROUP BY status`
  );

  const byStatus: Record<string, number> = { paid: 0, pending: 0, failed: 0, refunded: 0 };
  for (const r of byStatusRows) byStatus[r.status] = Number(r.count);

  const row = rows[0];
  return {
    totalRevenue: Number(row.paid_total_cents) / 100,
    paidCount: Number(row.paid_count),
    failuresToday: Number(row.failed_today),
    refundedCount: Number(row.refunded_count),
    byStatus,
  };
}

interface RecentPaymentRow {
  id: string;
  user_id: string;
  display_name: string;
  amount_cents: number;
  status: string;
  provider: string;
  provider_payment_id: string | null;
  paid_at: string | null;
  created_at: string;
}

export async function listPayments(params: {
  page: number;
  pageSize: number;
  status?: 'pending' | 'paid' | 'failed' | 'refunded';
}) {
  const { page, pageSize, status } = params;
  const offset = (page - 1) * pageSize;
  const whereClause = status ? `WHERE p.status = $1` : '';
  const queryParams = status ? [status] : [];

  const countRows = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM payments p ${whereClause}`,
    queryParams
  );

  const rows = await query<RecentPaymentRow>(
    `SELECT p.id, p.user_id, u.display_name, p.amount_cents, p.status, p.provider,
            p.provider_payment_id, p.paid_at, p.created_at
       FROM payments p
       JOIN app_users u ON u.id = p.user_id
       ${whereClause}
      ORDER BY p.created_at DESC
      LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}`,
    [...queryParams, pageSize, offset]
  );

  const total = Number(countRows[0].count);

  return {
    payments: rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      userName: r.display_name,
      amount: r.amount_cents / 100,
      status: r.status,
      gateway: r.provider,
      gatewayReference: r.provider_payment_id,
      paidAt: r.paid_at,
      createdAt: r.created_at,
    })),
    pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  };
}

// Distribuição de usuários por status de assinatura — considera só a
// assinatura MAIS RECENTE de cada usuário (alguém pode ter tido várias
// ao longo do tempo, mas o que importa aqui é o estado atual).
export async function getSubscriptionStatusSummary() {
  const rows = await query<{ status: string; count: string }>(
    `WITH latest_subscription AS (
       SELECT DISTINCT ON (user_id) user_id, status
         FROM user_subscriptions
        ORDER BY user_id, created_at DESC
     )
     SELECT
       COALESCE(ls.status, 'free') AS status,
       COUNT(*) AS count
       FROM app_users u
       LEFT JOIN latest_subscription ls ON ls.user_id = u.id
      GROUP BY COALESCE(ls.status, 'free')`
  );

  const total = rows.reduce((sum, r) => sum + Number(r.count), 0);

  return {
    total,
    breakdown: rows.map((r) => ({ status: r.status, count: Number(r.count) })),
  };
}

// Taxa de cancelamento: das assinaturas já criadas alguma vez, quantas
// % acabaram canceladas. Não conta "past_due"/"expired" como
// cancelamento — só status='canceled' de verdade (o usuário pediu pra
// sair), já que past_due pode só ser um pagamento atrasado que ainda
// vai resolver sozinho.
export async function getCancellationRate(): Promise<number> {
  const rows = await query<{ total: string; canceled: string }>(
    `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status = 'canceled') AS canceled
       FROM user_subscriptions`
  );
  const total = Number(rows[0].total);
  const canceled = Number(rows[0].canceled);
  return total > 0 ? Math.round((canceled / total) * 1000) / 10 : 0;
}
