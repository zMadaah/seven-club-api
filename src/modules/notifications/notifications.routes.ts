import { FastifyInstance } from 'fastify';
import { authenticate } from '../../plugins/authenticate';
import { listNotifications, markNotificationRead } from './notifications.service';

export async function notificationsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/notifications', async (request) => {
    return listNotifications(request.userId!);
  });

  app.patch('/notifications/:id/read', async (request, reply) => {
    const { id } = request.params as { id: string };
    await markNotificationRead(request.userId!, id);
    return reply.code(204).send();
  });
}
