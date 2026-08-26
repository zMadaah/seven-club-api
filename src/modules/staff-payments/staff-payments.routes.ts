import { FastifyInstance } from 'fastify';
import { authenticateStaff } from '../../plugins/authenticateStaff';
import { getPaymentsSummary, listPayments, getSubscriptionStatusSummary } from './staff-payments.service';

export async function staffPaymentsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticateStaff);

  app.get('/payments/summary', async () => {
    return getPaymentsSummary();
  });

  app.get('/payments', async (request) => {
    const { page, pageSize, status } = request.query as {
      page?: string;
      pageSize?: string;
      status?: 'pending' | 'paid' | 'failed' | 'refunded';
    };
    return listPayments({
      page: Number(page) || 1,
      pageSize: Math.min(Number(pageSize) || 20, 100),
      status,
    });
  });

  // Mantida por compatibilidade com o card "Últimos pagamentos" da Home,
  // que só quer os N mais recentes, sem paginação de verdade.
  app.get('/payments/recent', async (request) => {
    const { limit } = request.query as { limit?: string };
    const result = await listPayments({ page: 1, pageSize: Math.min(Number(limit) || 5, 20) });
    return result.payments;
  });

  app.get('/users/subscription-summary', async () => {
    return getSubscriptionStatusSummary();
  });
}
