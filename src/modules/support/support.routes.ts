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
        properties: {
          text: { type: 'string', maxLength: 2000 },
          imageUrl: { type: 'string', maxLength: 1000 },
        },
      },
    },
  }, async (request, reply) => {
    const { text, imageUrl } = request.body as { text?: string; imageUrl?: string };
    // Precisa de pelo menos um dos dois — mensagem vazia sem imagem não
    // faz sentido enviar.
    if (!text?.trim() && !imageUrl) {
      return reply.code(400).send({ error: 'Escreva uma mensagem ou anexe uma imagem.' });
    }
    const message = await sendSupportMessage(request.userId!, text?.trim() ?? '', imageUrl);
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
        properties: {
          sender: { type: 'string' }, // aceito mas ignorado — quem manda é sempre o staff logado
          message: { type: 'string', maxLength: 2000 },
          imageUrl: { type: 'string', maxLength: 1000 },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { message, imageUrl } = request.body as { message?: string; imageUrl?: string };
    if (!message?.trim() && !imageUrl) {
      return reply.code(400).send({ error: 'Escreva uma mensagem ou anexe uma imagem.' });
    }
    try {
      const sent = await sendStaffMessage(request.staffId!, id, message?.trim() ?? '', imageUrl);
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
