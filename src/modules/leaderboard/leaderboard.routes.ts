import { FastifyInstance } from 'fastify';
import { authenticate } from '../../plugins/authenticate';
import { getLeaderboard, getCrewLeaderboard, LeaderboardScope, LeaderboardError } from './leaderboard.service';

export async function leaderboardRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/leaderboard', async (request, reply) => {
    const { scope, activityType, lobbyId, gender } = request.query as {
      scope?: string;
      activityType?: 'run' | 'ride';
      lobbyId?: string;
      gender?: string;
    };

    if (scope !== 'country' && scope !== 'area' && scope !== 'lobby' && scope !== 'crew') {
      return reply.code(400).send({
        error: "scope precisa ser 'country', 'area', 'lobby' ou 'crew'.",
      });
    }

    if (scope === 'lobby' && !lobbyId) {
      return reply.code(400).send({ error: "scope 'lobby' exige o parâmetro lobbyId." });
    }

    const type = activityType === 'ride' ? 'ride' : 'run';
    const genderFilter = gender === 'Masculino' || gender === 'Feminino' ? gender : undefined;

    try {
      if (scope === 'crew') {
        return await getCrewLeaderboard(request.userId!, type);
      }
      return await getLeaderboard(request.userId!, scope as LeaderboardScope, type, lobbyId, genderFilter);
    } catch (err) {
      if (err instanceof LeaderboardError) return reply.code(403).send({ error: err.message });
      throw err;
    }
  });
}
