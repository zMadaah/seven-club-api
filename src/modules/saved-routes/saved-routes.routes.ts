import { FastifyInstance } from 'fastify';
import { authenticate } from '../../plugins/authenticate';
import { createSavedRoute, listSavedRoutes, deleteSavedRoute, SavedRouteError } from './saved-routes.service';

export async function savedRoutesRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.post('/routes', {
    schema: {
      body: {
        type: 'object',
        required: ['name', 'points'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 150 },
          points: {
            type: 'array',
            minItems: 2,
            items: {
              type: 'object',
              required: ['latitude', 'longitude'],
              properties: {
                latitude: { type: 'number' },
                longitude: { type: 'number' },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { name, points } = request.body as any;
    try {
      const route = await createSavedRoute(request.userId!, name, points);
      return reply.code(201).send(route);
    } catch (err) {
      if (err instanceof SavedRouteError) return reply.code(403).send({ error: err.message });
      throw err;
    }
  });

  app.get('/routes', async (request) => {
    return listSavedRoutes(request.userId!);
  });

  app.delete('/routes/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    await deleteSavedRoute(request.userId!, id);
    return reply.code(204).send();
  });
}
