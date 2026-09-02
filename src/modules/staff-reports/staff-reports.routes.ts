import { FastifyInstance } from 'fastify';
import { authenticateStaff } from '../../plugins/authenticateStaff';
import { listReports, updateReportStatus, ReportError } from '../reports/reports.service';

export async function staffReportsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticateStaff);

  app.get('/reports', async (request) => {
    const { status } = request.query as { status?: string };
    return { reports: await listReports(status) };
  });

  app.patch(
    '/reports/:id',
    {
      schema: {
        body: {
          type: 'object',
          required: ['status'],
          properties: { status: { type: 'string', enum: ['reviewed', 'dismissed'] } },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { status } = request.body as { status: 'reviewed' | 'dismissed' };
      try {
        await updateReportStatus(id, request.staffId!, status);
        return reply.code(204).send();
      } catch (err) {
        if (err instanceof ReportError) return reply.code(404).send({ error: err.message });
        throw err;
      }
    }
  );
}
