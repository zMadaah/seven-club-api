import { FastifyInstance } from 'fastify';
import { authenticate } from '../../plugins/authenticate';
import { getMyStats, getMyHistory } from './stats.service';

export async function statsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/stats/me', async (request) => {
    const { activityType } = request.query as { activityType?: 'run' | 'ride' };
    return getMyStats(request.userId!, activityType === 'ride' ? 'ride' : 'run');
  });

  app.get('/stats/history', async (request) => {
    const { activityType } = request.query as { activityType?: 'run' | 'ride' };
    return getMyHistory(request.userId!, activityType === 'ride' ? 'ride' : 'run');
  });
}
