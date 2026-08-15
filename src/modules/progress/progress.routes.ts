import { FastifyInstance } from 'fastify';
import { authenticate } from '../../plugins/authenticate';
import { getProgressSummary } from './progress.service';
import { getBadgeStatuses } from './badges.service';
import { getChallengeStatuses, claimChallenge, ChallengeError } from './challenges.service';
import { getRivals } from './rivals.service';

function parseActivityType(value: unknown): 'run' | 'ride' {
  return value === 'ride' ? 'ride' : 'run';
}

export async function progressRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/progress/summary', async (request) => {
    const { activityType } = request.query as { activityType?: string };
    return getProgressSummary(request.userId!, parseActivityType(activityType));
  });

  app.get('/badges/status', async (request) => {
    return getBadgeStatuses(request.userId!);
  });

  app.get('/challenges/status', async (request) => {
    return getChallengeStatuses(request.userId!);
  });

  app.post('/challenges/:id/claim', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      await claimChallenge(request.userId!, id);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof ChallengeError) return reply.code(400).send({ error: err.message });
      throw err;
    }
  });

  app.get('/rivals', async (request) => {
    const { activityType } = request.query as { activityType?: string };
    return getRivals(request.userId!, parseActivityType(activityType));
  });
}
