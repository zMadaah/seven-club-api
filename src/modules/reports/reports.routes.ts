import { FastifyInstance } from 'fastify';
import { authenticate } from '../../plugins/authenticate';
import { createReport, ReportError } from './reports.service';

// Rota do APP — usuário denunciando post/comentário. Rota de staff
// (listar/tratar) fica em staff-reports.routes.ts, separada, porque
// usa autenticação diferente (authenticateStaff).
export async function reportsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.post(
    '/reports',
    {
      config: { rateLimit: { max: 20, timeWindow: '15 minutes' } },
      schema: {
        body: {
          type: 'object',
          required: ['targetType', 'targetId'],
          properties: {
            targetType: { type: 'string', enum: ['post', 'comment'] },
            targetId: { type: 'string', format: 'uuid' },
          },
        },
      },
    },
    async (request, reply) => {
      const { targetType, targetId } = request.body as { targetType: 'post' | 'comment'; targetId: string };
      try {
        await createReport(request.userId!, targetType, targetId);
        return reply.code(204).send();
      } catch (err) {
        if (err instanceof ReportError) return reply.code(404).send({ error: err.message });
        throw err;
      }
    }
  );
}
