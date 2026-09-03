import { FastifyInstance } from 'fastify';
import { authenticateStaff } from '../../plugins/authenticateStaff';
import { sendTestNotificationToUser } from './push.service';
import { listNotificationsForStaff } from './staff-notifications-history';
import { getAudienceCount, broadcastToCategory, BroadcastError, AudienceCategory } from './broadcast.service';

// Rotas do DASHBOARD (staff) — separadas de pushRoutes (app) de
// propósito, pra rate limit isolado (ver server.ts).
export async function staffPushRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticateStaff);

  // Dispara uma notificação de teste pra um usuário específico, pra
  // validar que o caminho completo funciona.
  app.post(
    '/notifications/send-test',
    {
      schema: {
        body: {
          type: 'object',
          required: ['userId', 'title', 'body'],
          properties: {
            userId: { type: 'string' },
            title: { type: 'string', minLength: 1, maxLength: 100 },
            body: { type: 'string', minLength: 1, maxLength: 200 },
          },
        },
      },
    },
    async (request, reply) => {
      const { userId, title, body } = request.body as { userId: string; title: string; body: string };
      try {
        await sendTestNotificationToUser(userId, title, body);
        return reply.send({ sent: true });
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : 'Erro ao enviar.' });
      }
    }
  );

  // Histórico agregado de notificações (de todo mundo, não só de
  // teste) — usada pela aba Notificações.
  app.get('/staff-notifications', async (request) => {
    const { page, pageSize } = request.query as { page?: string; pageSize?: string };
    return listNotificationsForStaff(Number(page) || 1, Number(pageSize) || 20);
  });

  const CATEGORIES: AudienceCategory[] = ['free', 'subscriber', 'influencer', 'cancelled'];

  app.get('/staff-notifications/audience-count', async (request, reply) => {
    const { category } = request.query as { category?: string };
    if (!CATEGORIES.includes(category as AudienceCategory)) {
      return reply.code(400).send({ error: 'category inválida.' });
    }
    const count = await getAudienceCount(category as AudienceCategory);
    return { count };
  });

  app.post(
    '/staff-notifications/broadcast',
    {
      schema: {
        body: {
          type: 'object',
          required: ['category', 'title', 'body'],
          properties: {
            category: { type: 'string', enum: CATEGORIES },
            title: { type: 'string', minLength: 1, maxLength: 100 },
            body: { type: 'string', minLength: 1, maxLength: 200 },
          },
        },
      },
    },
    async (request, reply) => {
      const { category, title, body } = request.body as { category: AudienceCategory; title: string; body: string };
      try {
        return await broadcastToCategory(category, title, body);
      } catch (err) {
        if (err instanceof BroadcastError) return reply.code(400).send({ error: err.message });
        throw err;
      }
    }
  );
}
