import { FastifyRequest, FastifyReply } from 'fastify';
import { verifyStaffAccessToken } from '../utils/jwt';

declare module 'fastify' {
  interface FastifyRequest {
    staffId?: string;
  }
}

export async function authenticateStaff(request: FastifyRequest, reply: FastifyReply) {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return reply.code(401).send({ error: 'Token de acesso ausente.' });
  }

  const token = header.slice('Bearer '.length);

  try {
    const payload = verifyStaffAccessToken(token);
    request.staffId = payload.sub;
  } catch {
    return reply.code(401).send({ error: 'Token de staff inválido, expirado, ou não é um token de staff.' });
  }
}
