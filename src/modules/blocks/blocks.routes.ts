import { FastifyInstance } from 'fastify';
import { authenticate } from '../../plugins/authenticate';
import { blockUser, unblockUser, listBlockedUsers, BlockError } from './blocks.service';

export async function blocksRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/blocked-users', async (request) => {
    return listBlockedUsers(request.userId!);
  });

  app.post('/blocked-users/:userId', async (request, reply) => {
    const { userId } = request.params as { userId: string };
    try {
      await blockUser(request.userId!, userId);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof BlockError) return reply.code(400).send({ error: err.message });
      throw err;
    }
  });

  app.delete('/blocked-users/:userId', async (request, reply) => {
    const { userId } = request.params as { userId: string };
    await unblockUser(request.userId!, userId);
    return reply.code(204).send();
  });
}
