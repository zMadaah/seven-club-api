import { FastifyInstance } from 'fastify';
import {
  startPasswordReset,
  resendPasswordResetCode,
  verifyPasswordResetCode,
  completePasswordReset,
  PasswordResetError,
} from './password-reset.service';

export async function passwordResetRoutes(app: FastifyInstance) {
  app.post('/auth/password-reset/start', {
    config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
    schema: {
      body: {
        type: 'object',
        required: ['method', 'contact'],
        properties: {
          method: { type: 'string', enum: ['email', 'phone'] },
          contact: { type: 'string', minLength: 3, maxLength: 255 },
        },
      },
    },
  }, async (request, reply) => {
    const { method, contact } = request.body as any;
    const result = await startPasswordReset(method, contact);
    return reply.code(201).send(result);
  });

  app.post('/auth/password-reset/resend', {
    config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
    schema: {
      body: {
        type: 'object',
        required: ['resetId'],
        properties: { resetId: { type: 'string', format: 'uuid' } },
      },
    },
  }, async (request, reply) => {
    const { resetId } = request.body as any;
    try {
      return await resendPasswordResetCode(resetId);
    } catch (err) {
      if (err instanceof PasswordResetError) return reply.code(400).send({ error: err.message });
      throw err;
    }
  });

  app.post('/auth/password-reset/verify-code', {
    config: { rateLimit: { max: 15, timeWindow: '15 minutes' } },
    schema: {
      body: {
        type: 'object',
        required: ['resetId', 'code'],
        properties: {
          resetId: { type: 'string', format: 'uuid' },
          code: { type: 'string', minLength: 6, maxLength: 6 },
        },
      },
    },
  }, async (request, reply) => {
    const { resetId, code } = request.body as any;
    try {
      return await verifyPasswordResetCode(resetId, code);
    } catch (err) {
      if (err instanceof PasswordResetError) return reply.code(400).send({ error: err.message });
      throw err;
    }
  });

  app.post('/auth/password-reset/complete', {
    config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
    schema: {
      body: {
        type: 'object',
        required: ['resetId', 'password'],
        properties: {
          resetId: { type: 'string', format: 'uuid' },
          password: { type: 'string', minLength: 6 },
        },
      },
    },
  }, async (request, reply) => {
    const { resetId, password } = request.body as any;
    try {
      return await completePasswordReset(resetId, password);
    } catch (err) {
      if (err instanceof PasswordResetError) return reply.code(400).send({ error: err.message });
      throw err;
    }
  });
}
