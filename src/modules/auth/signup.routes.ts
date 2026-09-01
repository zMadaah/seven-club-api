import { FastifyInstance } from 'fastify';
import { startSignup, verifySignupCode, completeSignup, resendSignupCode, SignupError } from './signup.service';

export async function signupRoutes(app: FastifyInstance) {
  // Etapa 1 é a mais sensível: cada chamada aqui, em produção, dispara um
  // SMS de verdade (custo real). Limite apertado por IP, e o serviço
  // também barra pedidos repetidos pro mesmo e-mail/celular (ver
  // signup.service.ts).
  app.post('/auth/signup/start', {
    config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
    schema: {
      body: {
        type: 'object',
        required: ['name', 'email', 'phone'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
          email: { type: 'string', format: 'email' },
          phone: { type: 'string', minLength: 8, maxLength: 20 },
        },
      },
    },
  }, async (request, reply) => {
    const { name, email, phone } = request.body as any;
    try {
      const result = await startSignup(name, email, phone);
      return reply.code(201).send(result);
    } catch (err) {
      if (err instanceof SignupError) return reply.code(409).send({ error: err.message });
      throw err;
    }
  });

  // Reenvio do código (botão "reenviar" na tela de VerifyCode)
  app.post('/auth/signup/resend', {
    config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
    schema: {
      body: {
        type: 'object',
        required: ['signupId'],
        properties: { signupId: { type: 'string', format: 'uuid' } },
      },
    },
  }, async (request, reply) => {
    const { signupId } = request.body as any;
    try {
      return await resendSignupCode(signupId);
    } catch (err) {
      if (err instanceof SignupError) return reply.code(400).send({ error: err.message });
      throw err;
    }
  });

  // Etapa 2: código de 6 dígitos — limite mais alto que a etapa 1 (a
  // pessoa pode digitar errado sem querer), mas ainda limitado, já que é
  // por definição uma tentativa de "adivinhar" um segredo curto.
  app.post('/auth/signup/verify-code', {
    config: { rateLimit: { max: 15, timeWindow: '15 minutes' } },
    schema: {
      body: {
        type: 'object',
        required: ['signupId', 'code'],
        properties: {
          signupId: { type: 'string', format: 'uuid' },
          code: { type: 'string', minLength: 6, maxLength: 6 },
        },
      },
    },
  }, async (request, reply) => {
    const { signupId, code } = request.body as any;
    try {
      return await verifySignupCode(signupId, code);
    } catch (err) {
      if (err instanceof SignupError) return reply.code(400).send({ error: err.message });
      throw err;
    }
  });

  // Etapa 3: criar senha — finaliza o cadastro e já devolve os tokens de sessão
  app.post('/auth/signup/set-password', {
    config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
    schema: {
      body: {
        type: 'object',
        required: ['signupId', 'password'],
        properties: {
          signupId: { type: 'string', format: 'uuid' },
          password: { type: 'string', minLength: 6 },
        },
      },
    },
  }, async (request, reply) => {
    const { signupId, password } = request.body as any;
    try {
      const session = await completeSignup(signupId, password);
      return reply.code(201).send(session);
    } catch (err) {
      if (err instanceof SignupError) return reply.code(400).send({ error: err.message });
      throw err;
    }
  });
}
