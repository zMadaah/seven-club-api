import path from 'path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
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
import { blocksRoutes } from './modules/blocks/blocks.routes';
import { referralsRoutes } from './modules/referrals/referrals.routes';
import { supportRoutes, supportStaffRoutes } from './modules/support/support.routes';
import { progressRoutes } from './modules/progress/progress.routes';
import { staffAuthRoutes } from './modules/staff-auth/staff-auth.routes';
import { staffUsersRoutes } from './modules/staff-users/staff-users.routes';
import { staffAnalyticsRoutes } from './modules/staff-analytics/staff-analytics.routes';
import { eventsRoutes } from './modules/events/events.routes';
import { pushRoutes } from './modules/notifications-push/push.routes';
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

  // Rate limit global — teto de segurança pra API inteira não cair sob
  // carga (ataque, bug de retry no app, pico de lançamento etc.). Rotas
  // sensíveis (login, signup, upload) têm limites mais apertados
  // definidos na própria rota, que somam a este.
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    errorResponseBuilder: (_request, context) => ({
      error: `Muitas requisições. Tente novamente em ${context.after}.`,
    }),
  });

  await app.register(multipart);

  // Serve os arquivos de uploads/ em /uploads/<nome> — ver o aviso em
  // uploads.routes.ts sobre isso ser só pra homologação.
  await app.register(fastifyStatic, {
    root: path.join(__dirname, '..', 'uploads'),
    prefix: '/uploads/',
  });

  app.get('/health', async () => ({ status: 'ok' }));

  await app.register(authRoutes);
  await app.register(signupRoutes);
  await app.register(passwordResetRoutes);
  await app.register(activitiesRoutes);
  await app.register(territoryRoutes);
  await app.register(statsRoutes);
  await app.register(savedRoutesRoutes);
  await app.register(postsRoutes);
  await app.register(followsRoutes);
  await app.register(leaderboardRoutes);
  await app.register(lobbiesRoutes);
  await app.register(lobbyChatRoutes);
  await app.register(crewsRoutes);
  await app.register(crewChatRoutes);
  await app.register(blocksRoutes);
  await app.register(referralsRoutes);
  await app.register(supportRoutes);
  await app.register(supportStaffRoutes);
  await app.register(progressRoutes);
  await app.register(staffAuthRoutes);
  await app.register(staffUsersRoutes);
  await app.register(staffAnalyticsRoutes);
  await app.register(eventsRoutes);
  await app.register(pushRoutes);
  await app.register(uploadsRoutes);
  await app.register(notificationsRoutes);

  await app.listen({ port: env.port, host: '0.0.0.0' });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
