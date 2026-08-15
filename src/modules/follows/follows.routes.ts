import { FastifyInstance } from 'fastify';
import { authenticate } from '../../plugins/authenticate';
import { followUser, unfollowUser, searchUsers, FollowError } from './follows.service';

export async function followsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.post('/follows/:userId', async (request, reply) => {
    const { userId } = request.params as { userId: string };
    try {
      await followUser(request.userId!, userId);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof FollowError) return reply.code(400).send({ error: err.message });
      throw err;
    }
  });

  app.delete('/follows/:userId', async (request, reply) => {
    const { userId } = request.params as { userId: string };
    await unfollowUser(request.userId!, userId);
    return reply.code(204).send();
  });

  app.get('/users/search', async (request) => {
    const { q } = request.query as { q?: string };
    if (!q || q.trim().length === 0) return [];
    return searchUsers(request.userId!, q.trim());
  });
}
