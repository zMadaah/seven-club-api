import { FastifyInstance } from 'fastify';
import { authenticate } from '../../plugins/authenticate';
import { registerPushToken } from './push.service';

// Rota do APP (usuário comum). As rotas de staff (teste, histórico,
// broadcast por categoria) ficam em staff-push.routes.ts — separadas
// de propósito, pra poderem ter um rate limit isolado do rate limit do
// app (ver server.ts).
export async function pushRoutes(app: FastifyInstance) {
  app.post(
    '/notifications/register-token',
    {
      preHandler: authenticate,
      schema: {
        body: {
          type: 'object',
          required: ['token'],
          properties: { token: { type: 'string', minLength: 1 } },
        },
      },
    },
    async (request, reply) => {
      const { token } = request.body as { token: string };
      await registerPushToken(request.userId!, token);
      return reply.code(204).send();
    }
  );
}
