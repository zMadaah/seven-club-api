import { FastifyInstance } from 'fastify';
import { authenticateStaff } from '../../plugins/authenticateStaff';
import { getCurrentSeasonInfo, resetSeason, SeasonResetError } from './staff-seasons.service';

export async function staffSeasonsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticateStaff);

  app.get('/seasons/current', async () => {
    return getCurrentSeasonInfo();
  });

  // Ação destrutiva e irreversível (zera território de todo mundo) —
  // por isso é POST explícito, staff-auth, sem confirmação automática
  // nenhuma escondida no meio do caminho. A confirmação em si (modal
  // "tem certeza?") fica por conta do dashboard, não do backend.
  app.post('/seasons/reset', async (request, reply) => {
    try {
      const result = await resetSeason();
      return result;
    } catch (err) {
      if (err instanceof SeasonResetError) return reply.code(400).send({ error: err.message });
      throw err;
    }
  });
}
