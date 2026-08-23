import { FastifyInstance } from 'fastify';
import { authenticate } from '../../plugins/authenticate';
import { listCrewMessages, sendCrewMessage, CrewChatError } from './crew-chat.service';

export async function crewChatRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/crews/:id/messages', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return await listCrewMessages(id, request.userId!);
    } catch (err) {
      if (err instanceof CrewChatError) return reply.code(403).send({ error: err.message });
      throw err;
    }
  });

  app.post(
    '/crews/:id/messages',
    {
      schema: {
        body: {
          type: 'object',
          required: ['text'],
          properties: { text: { type: 'string', minLength: 1, maxLength: 1000 } },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { text } = request.body as any;
      try {
        const message = await sendCrewMessage(id, request.userId!, text);
        return reply.code(201).send(message);
      } catch (err) {
        if (err instanceof CrewChatError) return reply.code(403).send({ error: err.message });
        throw err;
      }
    }
  );
}
