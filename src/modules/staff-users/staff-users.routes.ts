import { FastifyInstance } from 'fastify';
import { authenticateStaff } from '../../plugins/authenticateStaff';
import { listUsers, updateUser, updateUserStatus, StaffUserError } from './staff-users.service';

export async function staffUsersRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticateStaff);

  app.get('/users', async (request) => {
    const { query: search, status, role, page, pageSize } = request.query as {
      query?: string;
      status?: 'active' | 'inactive' | 'suspended';
      role?: string;
      page?: string;
      pageSize?: string;
    };
    return listUsers({
      query: search,
      status,
      role,
      page: Number(page) || 1,
      pageSize: Math.min(Number(pageSize) || 20, 100),
    });
  });

  app.put('/users/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return await updateUser(id, request.body as any);
    } catch (err) {
      if (err instanceof StaffUserError) return reply.code(404).send({ error: err.message });
      throw err;
    }
  });

  app.patch('/users/:id/status', {
    schema: {
      body: {
        type: 'object',
        required: ['status'],
        properties: { status: { type: 'string', enum: ['active', 'inactive', 'suspended'] } },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { status } = request.body as any;
    try {
      return await updateUserStatus(id, status);
    } catch (err) {
      if (err instanceof StaffUserError) return reply.code(404).send({ error: err.message });
      throw err;
    }
  });
}
