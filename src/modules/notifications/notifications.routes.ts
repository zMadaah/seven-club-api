import { FastifyInstance } from 'fastify';
import { authenticate } from '../../plugins/authenticate';
import { getNotificationPreferences, updateNotificationPreferences } from './notifications.service';

const PREFERENCE_KEYS = [
  'heartedActivity', 'heartedStatus', 'commentOnActivity', 'commentOnStatus',
  'repliedToComment', 'followingYou', 'followRequest', 'questionAnswered',
  'privateLobbyInvite', 'clubInvite', 'territoryStolenSingle', 'territoryStolenPrivateLobby',
  'referralCodeUsed', 'marketingAnnouncements', 'captureThreshold5OrLess', 'captureThreshold5To20',
];

export async function notificationsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/notifications/preferences', async (request) => {
    return getNotificationPreferences(request.userId!);
  });

  app.patch('/notifications/preferences', {
    schema: {
      body: {
        type: 'object',
        properties: Object.fromEntries(PREFERENCE_KEYS.map((key) => [key, { type: 'boolean' }])),
        additionalProperties: false,
      },
    },
  }, async (request) => {
    return updateNotificationPreferences(request.userId!, request.body as any);
  });
}
