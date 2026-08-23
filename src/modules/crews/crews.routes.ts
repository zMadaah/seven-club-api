import { FastifyInstance } from 'fastify';
import { authenticate } from '../../plugins/authenticate';
import { listMyCrews, createCrew, updateCrew, deleteCrew, joinCrew, leaveCrew, CrewError } from './crews.service';

const crewBodySchema = {
  type: 'object',
  required: ['name', 'city', 'isPublic', 'allowPreviousImports', 'allowMemberInvitations', 'inGameChatEnabled'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 150 },
    pictureUri: { type: 'string', maxLength: 2000 },
    city: { type: 'string', minLength: 1, maxLength: 100 },
    isPublic: { type: 'boolean' },
    allowPreviousImports: { type: 'boolean' },
    allowMemberInvitations: { type: 'boolean' },
    inGameChatEnabled: { type: 'boolean' },
    maxCrewSize: { type: ['integer', 'null'], minimum: 2, maximum: 500 },
  },
};

export async function crewsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/crews/mine', async (request) => {
    return listMyCrews(request.userId!);
  });

  app.post('/crews', { schema: { body: crewBodySchema } }, async (request, reply) => {
    const body = request.body as any;
    const crew = await createCrew(request.userId!, { ...body, maxCrewSize: body.maxCrewSize ?? null });
    return reply.code(201).send(crew);
  });

  app.patch('/crews/:id', { schema: { body: crewBodySchema } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as any;
    try {
      const crew = await updateCrew(request.userId!, id, { ...body, maxCrewSize: body.maxCrewSize ?? null });
      return crew;
    } catch (err) {
      if (err instanceof CrewError) return reply.code(403).send({ error: err.message });
      throw err;
    }
  });

  app.delete('/crews/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      await deleteCrew(request.userId!, id);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof CrewError) return reply.code(403).send({ error: err.message });
      throw err;
    }
  });

  app.post(
    '/crews/join',
    {
      schema: {
        body: {
          type: 'object',
          required: ['inviteCode'],
          properties: { inviteCode: { type: 'string', minLength: 6, maxLength: 6 } },
        },
      },
    },
    async (request, reply) => {
      const { inviteCode } = request.body as { inviteCode: string };
      try {
        const crew = await joinCrew(request.userId!, inviteCode);
        return crew;
      } catch (err) {
        if (err instanceof CrewError) return reply.code(400).send({ error: err.message });
        throw err;
      }
    }
  );

  app.post('/crews/:id/leave', async (request, reply) => {
    const { id } = request.params as { id: string };
    await leaveCrew(request.userId!, id);
    return reply.code(204).send();
  });
}
