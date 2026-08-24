import { FastifyInstance } from 'fastify';
import { authenticate } from '../../plugins/authenticate';
import { startCheckout, cancelSubscription, SubscriptionError } from './subscriptions.service';

export async function subscriptionsRoutes(app: FastifyInstance) {
  app.post(
    '/subscriptions/checkout',
    {
      preHandler: authenticate,
      schema: {
        body: {
          type: 'object',
          required: ['planCode', 'cpfCnpj'],
          properties: {
            planCode: { type: 'string', enum: ['pro_monthly', 'pro_annual'] },
            cpfCnpj: { type: 'string', minLength: 11, maxLength: 18 },
          },
        },
      },
    },
    async (request, reply) => {
      const { planCode, cpfCnpj } = request.body as { planCode: string; cpfCnpj: string };
      try {
        const result = await startCheckout(request.userId!, planCode, cpfCnpj.replace(/\D/g, ''));
        return result;
      } catch (err) {
        const message = err instanceof SubscriptionError || err instanceof Error ? err.message : 'Erro ao iniciar checkout.';
        return reply.code(400).send({ error: message });
      }
    }
  );

  app.post('/subscriptions/cancel', { preHandler: authenticate }, async (request, reply) => {
    try {
      await cancelSubscription(request.userId!);
      return reply.code(204).send();
    } catch (err) {
      const message = err instanceof SubscriptionError ? err.message : 'Erro ao cancelar.';
      return reply.code(400).send({ error: message });
    }
  });
}
