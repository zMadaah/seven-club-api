import { FastifyInstance } from 'fastify';
import { authenticate } from '../../plugins/authenticate';
import { redeemReferralCode, getMyReferralInfo, ReferralError } from './referrals.service';

export async function referralsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/referrals/me', async (request) => {
    return getMyReferralInfo(request.userId!);
  });

  app.post('/referrals/redeem', {
    config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
    schema: {
      body: {
        type: 'object',
        required: ['code'],
        properties: { code: { type: 'string', minLength: 4, maxLength: 10 } },
      },
    },
  }, async (request, reply) => {
    const { code } = request.body as any;
    try {
      await redeemReferralCode(request.userId!, code);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof ReferralError) return reply.code(400).send({ error: err.message });
      throw err;
    }
  });
}
