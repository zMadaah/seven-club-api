import { FastifyInstance } from 'fastify';
import { authenticate } from '../../plugins/authenticate';
import { getLeaderboard, LeaderboardScope, LeaderboardError } from './leaderboard.service';

export async function leaderboardRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/leaderboard', async (request, reply) => {
    const { scope, activityType, lobbyId } = request.query as {
      scope?: string;
      activityType?: 'run' | 'ride';
      lobbyId?: string;
    };

    if (scope !== 'country' && scope !== 'area' && scope !== 'friends' && scope !== 'lobby') {
      return reply.code(400).send({
        error: "scope precisa ser 'country', 'area', 'friends' ou 'lobby' (ranking de crew ainda não existe).",
      });
    }

    if (scope === 'lobby' && !lobbyId) {
      return reply.code(400).send({ error: "scope 'lobby' exige o parâmetro lobbyId." });
    }

    try {
      return await getLeaderboard(
        request.userId!,
        scope as LeaderboardScope,
        activityType === 'ride' ? 'ride' : 'run',
        lobbyId
      );
    } catch (err) {
      if (err instanceof LeaderboardError) return reply.code(403).send({ error: err.message });
      throw err;
    }
  });
}
