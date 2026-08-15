import { FastifyInstance } from 'fastify';
import { authenticate } from '../../plugins/authenticate';
import { getLeaderboard, LeaderboardScope } from './leaderboard.service';

export async function leaderboardRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/leaderboard', async (request, reply) => {
    const { scope, activityType } = request.query as {
      scope?: string;
      activityType?: 'run' | 'ride';
    };

    if (scope !== 'country' && scope !== 'area' && scope !== 'friends') {
      return reply.code(400).send({
        error: "scope precisa ser 'country', 'area' ou 'friends' (ranking de crew ainda não existe).",
      });
    }

    return getLeaderboard(
      request.userId!,
      scope as LeaderboardScope,
      activityType === 'ride' ? 'ride' : 'run'
    );
  });
}
