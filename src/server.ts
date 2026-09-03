import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import { env } from './config/env';
import { authRoutes } from './modules/auth/auth.routes';
import { signupRoutes } from './modules/auth/signup.routes';
import { passwordResetRoutes } from './modules/password-reset/password-reset.routes';
import { activitiesRoutes } from './modules/activities/activities.routes';
import { territoryRoutes } from './modules/territory/territory.routes';
import { statsRoutes } from './modules/stats/stats.routes';
import { savedRoutesRoutes } from './modules/saved-routes/saved-routes.routes';
import { postsRoutes } from './modules/posts/posts.routes';
import { followsRoutes } from './modules/follows/follows.routes';
import { leaderboardRoutes } from './modules/leaderboard/leaderboard.routes';
import { lobbiesRoutes } from './modules/lobbies/lobbies.routes';
import { lobbyChatRoutes } from './modules/lobbies/lobby-chat.routes';
import { crewsRoutes } from './modules/crews/crews.routes';
import { crewChatRoutes } from './modules/crews/crew-chat.routes';
import { subscriptionsRoutes } from './modules/subscriptions/subscriptions.routes';
import { staffPaymentsRoutes } from './modules/staff-payments/staff-payments.routes';
import { staffSeasonsRoutes } from './modules/staff-seasons/staff-seasons.routes';
import { reportsRoutes } from './modules/reports/reports.routes';
import { staffReportsRoutes } from './modules/staff-reports/staff-reports.routes';
import { asaasWebhookRoutes } from './modules/subscriptions/asaas-webhook.routes';
import { blocksRoutes } from './modules/blocks/blocks.routes';
import { referralsRoutes } from './modules/referrals/referrals.routes';
import { supportRoutes, supportStaffRoutes } from './modules/support/support.routes';
import { progressRoutes } from './modules/progress/progress.routes';
import { staffAuthRoutes } from './modules/staff-auth/staff-auth.routes';
import { staffUsersRoutes } from './modules/staff-users/staff-users.routes';
import { staffAnalyticsRoutes } from './modules/staff-analytics/staff-analytics.routes';
import { eventsRoutes } from './modules/events/events.routes';
import { pushRoutes } from './modules/notifications-push/push.routes';
import { staffPushRoutes } from './modules/notifications-push/staff-push.routes';
import { uploadsRoutes } from './modules/uploads/uploads.routes';
import { notificationsRoutes } from './modules/notifications/notifications.routes';

async function main() {
  // trustProxy: true porque em produção a API roda atrás do proxy do
  // Render — sem isso, o rate limit por IP enxergaria só o IP do proxy
  // (o mesmo pra todo mundo) em vez do IP real de cada cliente.
  const app = Fastify({ logger: true, trustProxy: true });

  // CORS_ORIGIN=* reflete qualquer origem (bom pro Expo em dev, onde a
  // porta do Metro muda). Em produção, defina CORS_ORIGIN com o(s)
  // domínio(s) reais, separados por vírgula.
  const corsOrigin = env.corsOrigin === '*' ? true : env.corsOrigin.split(',').map((o) => o.trim());
  await app.register(cors, { origin: corsOrigin });

  await app.register(multipart);

  app.get('/health', async () => ({ status: 'ok' }));

  const rateLimitErrorBuilder = (_request: unknown, context: { after: string }) => ({
    error: `Muitas requisições. Tente novamente em ${context.after}.`,
  });

  // Rate limit do APP (usuários finais) e do DASHBOARD (staff) — dois
  // "baldes" completamente independentes agora, cada um dentro do seu
  // próprio escopo Fastify encapsulado. Antes era um balde global só,
  // compartilhado por todo mundo que batesse na API — o que significa
  // que atividade do dashboard (polling do chat de suporte, por
  // exemplo) numa rede compartilhada (Wi-Fi de escritório) podia
  // consumir o mesmo limite que um usuário testando o app na mesma
  // rede, bloqueando os dois sem relação real entre eles.
  await app.register(async function appScope(instance) {
    await instance.register(rateLimit, {
      max: 100,
      timeWindow: '1 minute',
      errorResponseBuilder: rateLimitErrorBuilder,
    });

    await instance.register(authRoutes);
    await instance.register(signupRoutes);
    await instance.register(passwordResetRoutes);
    await instance.register(activitiesRoutes);
    await instance.register(territoryRoutes);
    await instance.register(statsRoutes);
    await instance.register(savedRoutesRoutes);
    await instance.register(postsRoutes);
    await instance.register(followsRoutes);
    await instance.register(leaderboardRoutes);
    await instance.register(lobbiesRoutes);
    await instance.register(lobbyChatRoutes);
    await instance.register(crewsRoutes);
    await instance.register(crewChatRoutes);
    await instance.register(subscriptionsRoutes);
    await instance.register(reportsRoutes);
    await instance.register(asaasWebhookRoutes);
    await instance.register(blocksRoutes);
    await instance.register(referralsRoutes);
    await instance.register(supportRoutes);
    await instance.register(progressRoutes);
    await instance.register(pushRoutes);
    await instance.register(uploadsRoutes);
    await instance.register(notificationsRoutes);
  });

  await app.register(async function staffScope(instance) {
    await instance.register(rateLimit, {
      max: 100,
      timeWindow: '1 minute',
      errorResponseBuilder: rateLimitErrorBuilder,
    });

    await instance.register(staffPaymentsRoutes);
    await instance.register(staffSeasonsRoutes);
    await instance.register(staffReportsRoutes);
    await instance.register(supportStaffRoutes);
    await instance.register(staffAuthRoutes);
    await instance.register(staffUsersRoutes);
    await instance.register(staffAnalyticsRoutes);
    await instance.register(eventsRoutes);
    await instance.register(staffPushRoutes);
  });

  await app.listen({ port: env.port, host: '0.0.0.0' });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
