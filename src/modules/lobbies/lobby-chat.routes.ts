import { FastifyInstance } from 'fastify';
import { authenticate } from '../../plugins/authenticate';
import { listLobbyMessages, sendLobbyMessage, LobbyChatError } from './lobby-chat.service';

export async function lobbyChatRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/lobbies/:id/messages', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return await listLobbyMessages(id, request.userId!);
    } catch (err) {
      if (err instanceof LobbyChatError) return reply.code(403).send({ error: err.message });
      throw err;
    }
  });

  app.post('/lobbies/:id/messages', {
    schema: {
      body: {
        type: 'object',
        required: ['text'],
        properties: { text: { type: 'string', minLength: 1, maxLength: 1000 } },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { text } = request.body as any;
    try {
      const message = await sendLobbyMessage(id, request.userId!, text);
      return reply.code(201).send(message);
    } catch (err) {
      if (err instanceof LobbyChatError) return reply.code(403).send({ error: err.message });
      throw err;
    }
  });
}
