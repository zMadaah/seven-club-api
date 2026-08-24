import { query } from '../../db/pool';
import {
  createAsaasCustomer,
  createAsaasSubscription,
  getFirstPaymentInvoiceUrl,
  cancelAsaasSubscription,
} from '../../integrations/asaas/client';

export class SubscriptionError extends Error {}

interface PlanRow {
  id: string;
  code: string;
  name: string;
  price_cents: number;
  billing_interval: 'month' | 'year';
}

async function getPlanByCode(code: string): Promise<PlanRow> {
  const rows = await query<PlanRow>(`SELECT * FROM subscription_plans WHERE code = $1 AND active = true`, [code]);
  if (rows.length === 0) throw new SubscriptionError('Plano não encontrado.');
  return rows[0];
}

async function getOrCreateAsaasCustomer(userId: string, cpfCnpj: string): Promise<string> {
  const rows = await query<{ asaas_customer_id: string | null; display_name: string; email: string; cpf_cnpj: string | null }>(
    `SELECT asaas_customer_id, display_name, email, cpf_cnpj FROM app_users WHERE id = $1`,
    [userId]
  );
  if (rows.length === 0) throw new SubscriptionError('Usuário não encontrado.');

  const user = rows[0];
  if (user.asaas_customer_id) return user.asaas_customer_id;

  const customer = await createAsaasCustomer({
    name: user.display_name,
    email: user.email,
    cpfCnpj,
  });

  await query(`UPDATE app_users SET asaas_customer_id = $1, cpf_cnpj = $2 WHERE id = $3`, [
    customer.id,
    cpfCnpj,
    userId,
  ]);

  return customer.id;
}

// Cria a assinatura na Asaas e devolve o link de checkout hospedado —
// nunca lidamos com dado de cartão dentro do app, o cliente escolhe a
// forma de pagamento (cartão/PIX/boleto) na própria página da Asaas.
export async function startCheckout(userId: string, planCode: string, cpfCnpj: string) {
  const plan = await getPlanByCode(planCode);
  if (!plan.billing_interval) throw new SubscriptionError('Esse plano não é assinável.');

  const customerId = await getOrCreateAsaasCustomer(userId, cpfCnpj);

  const subscription = await createAsaasSubscription({
    customerId,
    value: plan.price_cents / 100,
    cycle: plan.billing_interval === 'year' ? 'YEARLY' : 'MONTHLY',
    description: plan.name,
  });

  const now = new Date();
  const periodEnd = new Date(now);
  if (plan.billing_interval === 'year') periodEnd.setFullYear(periodEnd.getFullYear() + 1);
  else periodEnd.setMonth(periodEnd.getMonth() + 1);

  // Criado como "past_due" (não "active") — só vira ativo de verdade
  // quando o webhook confirmar o pagamento. Evita marcar como assinante
  // alguém que só chegou a abrir o checkout e nunca pagou.
  await query(
    `INSERT INTO user_subscriptions (user_id, plan_id, status, current_period_start, current_period_end, asaas_subscription_id)
     VALUES ($1, $2, 'past_due', $3, $4, $5)`,
    [userId, plan.id, now.toISOString(), periodEnd.toISOString(), subscription.id]
  );

  const invoiceUrl = await getFirstPaymentInvoiceUrl(subscription.id);
  if (!invoiceUrl) throw new SubscriptionError('Não foi possível gerar o link de pagamento.');

  return { checkoutUrl: invoiceUrl };
}

export async function cancelSubscription(userId: string) {
  const rows = await query<{ id: string; asaas_subscription_id: string | null }>(
    `SELECT id, asaas_subscription_id FROM user_subscriptions
      WHERE user_id = $1 AND status = 'active'
      ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );
  if (rows.length === 0) throw new SubscriptionError('Você não tem uma assinatura ativa.');

  if (rows[0].asaas_subscription_id) {
    await cancelAsaasSubscription(rows[0].asaas_subscription_id);
  }

  await query(`UPDATE user_subscriptions SET status = 'canceled' WHERE id = $1`, [rows[0].id]);
  await query(`UPDATE app_users SET role = 'free' WHERE id = $1`, [userId]);
}
