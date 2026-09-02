import { FastifyInstance } from 'fastify';
import { authenticate } from '../../plugins/authenticate';
import { authenticateStaff } from '../../plugins/authenticateStaff';
import { registerPushToken, sendTestNotificationToUser } from './push.service';
import { listNotificationsForStaff } from './staff-notifications-history';

export async function pushRoutes(app: FastifyInstance) {
  // Rota do APP (usuário comum) — registra o token assim que o app abre
  app.post(
    '/notifications/register-token',
    {
      preHandler: authenticate,
      schema: {
        body: {
          type: 'object',
          required: ['token'],
          properties: { token: { type: 'string', minLength: 1 } },
        },
      },
    },
    async (request, reply) => {
      const { token } = request.body as { token: string };
      await registerPushToken(request.userId!, token);
      return reply.code(204).send();
    }
  );

  // Rota do DASHBOARD (staff) — dispara uma notificação de teste pra um
  // usuário específico, pra validar que o caminho completo funciona
  app.post(
    '/notifications/send-test',
    {
      preHandler: authenticateStaff,
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

  // Rota do DASHBOARD (staff) — histórico agregado de notificações
  // (de todo mundo, não só de teste) — usada pela aba Notificações.
  app.get('/staff-notifications', { preHandler: authenticateStaff }, async (request) => {
    const { page, pageSize } = request.query as { page?: string; pageSize?: string };
    return listNotificationsForStaff(Number(page) || 1, Number(pageSize) || 20);
  });
}
