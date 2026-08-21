import { FastifyInstance } from 'fastify';
import { authenticateStaff } from '../../plugins/authenticateStaff';
import { listActivitiesForStaff, getTerritoryDominance, getActivitiesDailySummary } from './staff-analytics.service';

export async function staffAnalyticsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticateStaff);

  app.get('/analytics/activities', async (request) => {
    const { page, pageSize, activityType, userId } = request.query as {
      page?: string;
      pageSize?: string;
      activityType?: 'run' | 'ride';
      userId?: string;
    };
    return listActivitiesForStaff({
      page: Number(page) || 1,
      pageSize: Math.min(Number(pageSize) || 20, 100),
      activityType,
      userId,
    });
  });

  app.get('/analytics/activities/summary', async (request) => {
    const { activityType, days } = request.query as { activityType?: string; days?: string };
    const type = activityType === 'ride' ? 'ride' : 'run';
    return getActivitiesDailySummary({ activityType: type, days: Math.min(Number(days) || 30, 90) });
  });

  app.get('/analytics/territory', async (request) => {
    const { activityType } = request.query as { activityType?: string };
    const type = activityType === 'ride' ? 'ride' : 'run';
    return getTerritoryDominance(type);
  });
}
