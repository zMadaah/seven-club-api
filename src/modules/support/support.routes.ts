import { FastifyInstance } from 'fastify';
import { authenticate } from '../../plugins/authenticate';
import { authenticateStaff } from '../../plugins/authenticateStaff';
import {
  sendSupportMessage,
  listMyMessages,
  listTicketsForStaff,
  listTicketMessagesForStaff,
  sendStaffMessage,
  updateTicketStatusForStaff,
  SupportError,
} from './support.service';

// Lado usuário (app) — igual já era.
export async function supportRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/support/messages', async (request) => {
    return listMyMessages(request.userId!);
  });

  app.post('/support/messages', {
    config: { rateLimit: { max: 30, timeWindow: '15 minutes' } },
    schema: {
      body: {
        type: 'object',
        required: ['text'],
        properties: { text: { type: 'string', minLength: 1, maxLength: 2000 } },
      },
    },
  }, async (request, reply) => {
    const { text } = request.body as any;
    const message = await sendSupportMessage(request.userId!, text);
    return reply.code(201).send(message);
  });
}

// Lado staff (dashboard) — hook de autenticação diferente, por isso é um
// registro à parte em vez de misturar com supportRoutes acima.
export async function supportStaffRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticateStaff);

  app.get('/support/tickets', async (request) => {
    const { status, page, pageSize } = request.query as {
      status?: string;
      page?: string;
      pageSize?: string;
    };
    return listTicketsForStaff({
      status,
      page: Number(page) || 1,
      pageSize: Math.min(Number(pageSize) || 20, 100),
    });
  });

  app.get('/support/tickets/:id/messages', async (request) => {
    const { id } = request.params as { id: string };
    return listTicketMessagesForStaff(id);
  });

  app.post('/support/tickets/:id/messages', {
    schema: {
      body: {
        type: 'object',
        required: ['message'],
        properties: {
          sender: { type: 'string' }, // aceito mas ignorado — quem manda é sempre o staff logado
          message: { type: 'string', minLength: 1, maxLength: 2000 },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { message } = request.body as any;
    try {
      const sent = await sendStaffMessage(request.staffId!, id, message);
      return reply.code(201).send(sent);
    } catch (err) {
      if (err instanceof SupportError) return reply.code(404).send({ error: err.message });
      throw err;
    }
  });

  app.patch('/support/tickets/:id/status', {
    schema: {
      body: {
        type: 'object',
        required: ['status'],
        properties: { status: { type: 'string', enum: ['new', 'in_progress', 'resolved'] } },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { status } = request.body as any;
    try {
      return await updateTicketStatusForStaff(id, status);
    } catch (err) {
      if (err instanceof SupportError) return reply.code(404).send({ error: err.message });
      throw err;
    }
  });
}
