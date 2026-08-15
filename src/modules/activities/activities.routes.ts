import { FastifyInstance } from 'fastify';
import { authenticate } from '../../plugins/authenticate';
import { submitActivity, listActivities, getActivityById } from './activities.service';

const pointSchema = {
  type: 'object',
  required: ['latitude', 'longitude'],
  properties: {
    latitude: { type: 'number' },
    longitude: { type: 'number' },
  },
};

export async function activitiesRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.post('/activities', {
    schema: {
      body: {
        type: 'object',
        required: ['name', 'activityType', 'points', 'startedAt', 'endedAt'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 150 },
          activityType: { type: 'string', enum: ['run', 'ride'] },
          points: { type: 'array', items: pointSchema, minItems: 2 },
          startedAt: { type: 'string', format: 'date-time' },
          endedAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  }, async (request, reply) => {
    const body = request.body as any;
    const activity = await submitActivity({ userId: request.userId!, ...body });
    return reply.code(201).send(activity);
  });

  app.get('/activities', async (request) => {
    return listActivities(request.userId!);
  });

  app.get('/activities/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const activity = await getActivityById(request.userId!, id);
    if (!activity) return reply.code(404).send({ error: 'Atividade não encontrada.' });
    return activity;
  });
}
