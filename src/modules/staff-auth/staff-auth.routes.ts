import { FastifyInstance } from 'fastify';
import { authenticateStaff } from '../../plugins/authenticateStaff';
import { registerStaff, loginStaff, getStaffMe, deleteStaff, StaffAuthError } from './staff-auth.service';

export async function staffAuthRoutes(app: FastifyInstance) {
  // ATENÇÃO — sem proteção nenhuma além do rate limit: qualquer um que
  // souber a URL consegue criar uma conta de staff. É assim de propósito
  // pra testar em homologação sem burocracia. ANTES DE PRODUÇÃO: proteja
  // essa rota (feature flag, IP allowlist) ou remova e crie contas de
  // staff só via SQL direto no banco.
  app.post('/auth/staff/register', {
    config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
    schema: {
      body: {
        type: 'object',
        required: ['email', 'password', 'name'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 8 },
          name: { type: 'string', minLength: 1, maxLength: 100 },
        },
      },
    },
  }, async (request, reply) => {
    const { email, password, name } = request.body as any;
    try {
      const session = await registerStaff(email, password, name);
      return reply.code(201).send(session);
    } catch (err) {
      if (err instanceof StaffAuthError) return reply.code(409).send({ error: err.message });
      throw err;
    }
  });

  app.post('/auth/staff/login', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { email, password } = request.body as any;
    try {
      return await loginStaff(email, password);
    } catch (err) {
      if (err instanceof StaffAuthError) return reply.code(401).send({ error: err.message });
      throw err;
    }
  });

  app.get('/auth/staff/me', { preHandler: authenticateStaff }, async (request, reply) => {
    const staff = await getStaffMe(request.staffId!);
    if (!staff) return reply.code(404).send({ error: 'Conta de staff não encontrada.' });
    return staff;
  });

  // Apaga só a PRÓPRIA conta (identificada pelo token) — pra limpar
  // contas de teste em homologação sem precisar mexer direto no banco.
  app.delete('/auth/staff/me', { preHandler: authenticateStaff }, async (request, reply) => {
    await deleteStaff(request.staffId!);
    return reply.code(204).send();
  });
}
