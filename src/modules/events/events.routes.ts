import { FastifyInstance } from 'fastify';
import { authenticateStaff } from '../../plugins/authenticateStaff';
import { listEvents, createEvent } from './events.service';

export async function eventsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticateStaff);

  app.get('/events', async (request) => {
    const { page, pageSize, status } = request.query as {
      page?: string;
      pageSize?: string;
      status?: 'scheduled' | 'live' | 'finished';
    };
    return listEvents({
      page: Number(page) || 1,
      pageSize: Math.min(Number(pageSize) || 20, 100),
      status,
    });
  });

  app.post('/events', {
    schema: {
      body: {
        type: 'object',
        required: ['name', 'location', 'eventDate'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 150 },
          location: { type: 'string', minLength: 1, maxLength: 100 },
          eventDate: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const body = request.body as { name: string; location: string; eventDate: string };
    const event = await createEvent(body);
    return reply.code(201).send(event);
  });
}
