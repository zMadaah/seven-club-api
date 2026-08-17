import { FastifyInstance } from 'fastify';
import { authenticate } from '../../plugins/authenticate';
import {
  listMyLobbies,
  createLobby,
  updateLobby,
  deleteLobby,
  joinLobby,
  leaveLobby,
  LobbyError,
} from './lobbies.service';

const lobbyBodySchema = {
  type: 'object',
  required: ['name', 'allowPreviousImports', 'allowMemberInvitations', 'inGameChatEnabled'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 150 },
    pictureUri: { type: 'string', maxLength: 2000 },
    allowPreviousImports: { type: 'boolean' },
    allowMemberInvitations: { type: 'boolean' },
    inGameChatEnabled: { type: 'boolean' },
    maxLobbySize: { type: ['integer', 'null'], minimum: 2, maximum: 500 },
    startsAt: { type: ['string', 'null'], format: 'date-time' },
    endsAt: { type: ['string', 'null'], format: 'date-time' },
  },
};

export async function lobbiesRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/lobbies/mine', async (request) => {
    return listMyLobbies(request.userId!);
  });

  app.post('/lobbies', { schema: { body: lobbyBodySchema } }, async (request, reply) => {
    const body = request.body as any;
    const lobby = await createLobby(request.userId!, {
      ...body,
      maxLobbySize: body.maxLobbySize ?? null,
      startsAt: body.startsAt ?? null,
      endsAt: body.endsAt ?? null,
    });
    return reply.code(201).send(lobby);
  });

  app.patch('/lobbies/:id', { schema: { body: lobbyBodySchema } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as any;
    try {
      const lobby = await updateLobby(request.userId!, id, {
        ...body,
        maxLobbySize: body.maxLobbySize ?? null,
        startsAt: body.startsAt ?? null,
        endsAt: body.endsAt ?? null,
      });
      return lobby;
    } catch (err) {
      if (err instanceof LobbyError) return reply.code(403).send({ error: err.message });
      throw err;
    }
  });

  app.delete('/lobbies/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      await deleteLobby(request.userId!, id);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof LobbyError) return reply.code(403).send({ error: err.message });
      throw err;
    }
  });

  app.post('/lobbies/join', {
    // código de 6 caracteres — não impossível de tentar adivinhar por
    // força bruta se não limitar, mesmo sendo ~1 bilhão de combinações
    config: { rateLimit: { max: 20, timeWindow: '15 minutes' } },
    schema: {
      body: {
        type: 'object',
        required: ['code'],
        properties: { code: { type: 'string', minLength: 6, maxLength: 6 } },
      },
    },
  }, async (request, reply) => {
    const { code } = request.body as any;
    try {
      const lobby = await joinLobby(request.userId!, code);
      return lobby;
    } catch (err) {
      if (err instanceof LobbyError) return reply.code(400).send({ error: err.message });
      throw err;
    }
  });

  app.post('/lobbies/:id/leave', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      await leaveLobby(request.userId!, id);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof LobbyError) return reply.code(400).send({ error: err.message });
      throw err;
    }
  });
}
