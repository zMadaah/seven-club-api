import { FastifyInstance } from 'fastify';
import { query } from '../../db/pool';
import { env } from '../../config/env';

// Eventos que confirmam pagamento — a assinatura vira 'active' e o
// usuário vira 'subscriber' de verdade só aqui, nunca no momento de
// gerar o checkout (que só significa "abriu a página", não "pagou").
const CONFIRMED_EVENTS = ['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED'];
const FAILED_EVENTS = ['PAYMENT_OVERDUE', 'PAYMENT_DELETED', 'PAYMENT_REFUNDED'];

export async function asaasWebhookRoutes(app: FastifyInstance) {
  app.post('/webhooks/asaas', async (request, reply) => {
    // A Asaas manda o token configurado no painel de volta num header —
    // confirma que a notificação realmente veio de lá, não de qualquer
    // um batendo nessa URL pública.
    const token = request.headers['asaas-access-token'];
    if (env.asaasWebhookToken && token !== env.asaasWebhookToken) {
      return reply.code(401).send({ error: 'Token de webhook inválido.' });
    }

    const body = request.body as {
      event: string;
      payment?: { subscription?: string; id?: string; value?: number };
    };

    // Log temporário — precisamos ver o payload real que a Asaas manda
    // pra confirmar se os nomes de campo batem com o que o código espera.
    // Remove depois de confirmar que o fluxo completo funciona.
    request.log.info({ asaasWebhookBody: body }, 'Webhook Asaas recebido');

    const subscriptionId = body.payment?.subscription;
    if (!subscriptionId) {
      request.log.info('Sem payment.subscription no body — tratando como cobrança avulsa, ignorando.');
      return reply.code(200).send({ received: true }); // cobrança avulsa, não é de assinatura
    }

    const rows = await query<{ id: string; user_id: string; current_period_start: string; current_period_end: string }>(
      `SELECT id, user_id, current_period_start, current_period_end
         FROM user_subscriptions WHERE asaas_subscription_id = $1
         ORDER BY created_at DESC LIMIT 1`,
      [subscriptionId]
    );
    if (rows.length === 0) {
      request.log.info({ subscriptionId }, 'Nenhuma user_subscriptions encontrada com esse asaas_subscription_id.');
      return reply.code(200).send({ received: true });
    }

    const subscription = rows[0];
    request.log.info({ event: body.event, subscriptionId: subscription.id }, 'Assinatura encontrada, processando evento.');

    if (CONFIRMED_EVENTS.includes(body.event)) {
      await query(`UPDATE user_subscriptions SET status = 'active' WHERE id = $1`, [subscription.id]);
      await query(`UPDATE app_users SET role = 'subscriber' WHERE id = $1`, [subscription.user_id]);

      await query(
        `INSERT INTO payments (user_id, subscription_id, amount_cents, status, provider, provider_payment_id, paid_at)
         VALUES ($1, $2, $3, 'paid', 'asaas', $4, now())`,
        [subscription.user_id, subscription.id, Math.round((body.payment?.value ?? 0) * 100), body.payment?.id ?? null]
      );
    } else if (FAILED_EVENTS.includes(body.event)) {
      await query(`UPDATE user_subscriptions SET status = 'past_due' WHERE id = $1`, [subscription.id]);
      await query(`UPDATE app_users SET role = 'free' WHERE id = $1`, [subscription.user_id]);
    } else {
      request.log.info({ event: body.event }, 'Evento não reconhecido como confirmação nem falha — nada foi atualizado.');
    }

    return reply.code(200).send({ received: true });
  });
}
