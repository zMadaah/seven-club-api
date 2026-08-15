import { FastifyInstance } from 'fastify';
import { authenticate } from '../../plugins/authenticate';
import {
  listFeed,
  createPost,
  likePost,
  unlikePost,
  listComments,
  addComment,
  deleteComment,
  deletePost,
  PostError,
} from './posts.service';

export async function postsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/posts', async (request) => {
    const { scope, activityType } = request.query as {
      scope?: 'explore' | 'following' | 'groups';
      activityType?: 'run' | 'ride' | 'all';
    };
    return listFeed(
      request.userId!,
      scope === 'following' || scope === 'groups' ? scope : 'explore',
      activityType === 'run' || activityType === 'ride' ? activityType : 'all'
    );
  });

  app.post('/posts', {
    // Publicar é mais raro que ler o feed — limite pra evitar spam.
    config: { rateLimit: { max: 20, timeWindow: '15 minutes' } },
    schema: {
      body: {
        type: 'object',
        required: ['photoUrls'],
        properties: {
          activityId: { type: 'string', format: 'uuid' },
          activityType: { type: 'string', enum: ['run', 'ride'] },
          title: { type: 'string', maxLength: 150 },
          caption: { type: 'string', maxLength: 2000 },
          photoUrls: { type: 'array', items: { type: 'string' }, maxItems: 6 },
        },
      },
    },
  }, async (request, reply) => {
    const body = request.body as any;
    try {
      const postId = await createPost(request.userId!, body);
      return reply.code(201).send({ id: postId });
    } catch (err) {
      if (err instanceof PostError) return reply.code(400).send({ error: err.message });
      throw err;
    }
  });

  app.post('/posts/:id/like', async (request, reply) => {
    const { id } = request.params as { id: string };
    await likePost(request.userId!, id);
    return reply.code(204).send();
  });

  app.delete('/posts/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      await deletePost(request.userId!, id);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof PostError) return reply.code(404).send({ error: err.message });
      throw err;
    }
  });

  app.delete('/posts/:id/like', async (request, reply) => {
    const { id } = request.params as { id: string };
    await unlikePost(request.userId!, id);
    return reply.code(204).send();
  });

  app.get('/posts/:id/comments', async (request) => {
    const { id } = request.params as { id: string };
    return listComments(id);
  });

  app.post('/posts/:id/comments', {
    config: { rateLimit: { max: 30, timeWindow: '5 minutes' } },
    schema: {
      body: {
        type: 'object',
        required: ['text'],
        properties: {
          text: { type: 'string', minLength: 1, maxLength: 1000 },
          parentCommentId: { type: 'string', format: 'uuid' },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { text, parentCommentId } = request.body as any;
    try {
      const comment = await addComment(request.userId!, id, text, parentCommentId);
      return reply.code(201).send(comment);
    } catch (err) {
      if (err instanceof PostError) return reply.code(404).send({ error: err.message });
      throw err;
    }
  });

  app.delete('/posts/:postId/comments/:commentId', async (request, reply) => {
    const { commentId } = request.params as { postId: string; commentId: string };
    try {
      await deleteComment(request.userId!, commentId);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof PostError) return reply.code(404).send({ error: err.message });
      throw err;
    }
  });
}
