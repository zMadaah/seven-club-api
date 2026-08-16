import { FastifyInstance } from 'fastify';
import { authenticate } from '../../plugins/authenticate';
import { AuthError, login, refreshSession, logout, getMe, updateMe, deleteMyData } from './auth.service';

const credentialsSchema = {
  type: 'object',
  required: ['email', 'password'],
  properties: {
    email: { type: 'string', format: 'email' },
    password: { type: 'string', minLength: 8 },
  },
};

const refreshBodySchema = {
  type: 'object',
  required: ['refreshToken'],
  properties: { refreshToken: { type: 'string' } },
};

export async function authRoutes(app: FastifyInstance) {
  // Login é o alvo clássico de força bruta — limite mais apertado que o
  // global, por IP.
  app.post('/auth/login', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: { body: credentialsSchema },
  }, async (request, reply) => {
    const { email, password } = request.body as any;
    try {
      return await login(email, password);
    } catch (err) {
      if (err instanceof AuthError) return reply.code(401).send({ error: err.message });
      throw err;
    }
  });

  app.post('/auth/refresh', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: { body: refreshBodySchema },
  }, async (request, reply) => {
    const { refreshToken } = request.body as any;
    try {
      return await refreshSession(refreshToken);
    } catch (err) {
      if (err instanceof AuthError) return reply.code(401).send({ error: err.message });
      throw err;
    }
  });

  app.post('/auth/logout', { schema: { body: refreshBodySchema } }, async (request, reply) => {
    const { refreshToken } = request.body as any;
    await logout(refreshToken);
    return reply.code(204).send();
  });

  app.get('/auth/me', { preHandler: authenticate }, async (request, reply) => {
    const user = await getMe(request.userId!);
    if (!user) return reply.code(404).send({ error: 'Usuário não encontrado.' });
    return user;
  });

  app.patch('/auth/me', {
    preHandler: authenticate,
    schema: {
      body: {
        type: 'object',
        properties: {
          displayName: { type: 'string', minLength: 1, maxLength: 100 },
          firstName: { type: 'string', maxLength: 100 },
          lastName: { type: 'string', maxLength: 100 },
          bio: { type: 'string', maxLength: 280 },
          avatarUrl: { type: 'string', maxLength: 2000 },
          location: { type: 'string', maxLength: 150 },
          countryCode: { type: 'string', minLength: 2, maxLength: 2 },
          dateOfBirth: { type: 'string', format: 'date' },
          gender: { type: 'string', maxLength: 20 },
          profileColor: { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' },
          profileVisibility: { type: 'string', enum: ['public', 'followers'] },
          mapVisibility: { type: 'string', enum: ['everyone', 'crew', 'nobody'] },
          featuredBadgeId: { type: ['string', 'null'], maxLength: 20 },
          anonymousMode: { type: 'boolean' },
        },
      },
    },
  }, async (request, reply) => {
    const user = await updateMe(request.userId!, request.body as any);
    if (!user) return reply.code(404).send({ error: 'Usuário não encontrado.' });
    return user;
  });

  // "Remover dados" no app — ação destrutiva, sem confirmação extra aqui
  // porque a tela já confirma antes de chamar isso.
  app.delete('/auth/me/data', {
    preHandler: authenticate,
    config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    await deleteMyData(request.userId!);
    return reply.code(204).send();
  });
}
