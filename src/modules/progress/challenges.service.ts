import { query } from '../../db/pool';
import { grantXp } from './xp.service';

export class ChallengeError extends Error {}

// c1/c4/c6 são "honor system" — ações que acontecem fora do app
// (Instagram, loja de apps) e não têm como ser verificadas de verdade.
// A diferença entre elas: c1 (Garmin) não tem NENHUM jeito de completar
// ainda (falta a integração em si), enquanto c4/c6 só pedem uma ação que
// a pessoa faz fora do app e confirma de volta — por isso sempre
// "completável", sem checagem real por trás.
const CHALLENGE_XP: Record<string, number> = {
  c1: 10,
  c2: 10,
  c3: 10,
  c4: 15,
  c5: 50,
  c6: 100,
  c7: 10,
};

async function checkConnectedWatch(_userId: string): Promise<boolean> {
  return false; // sem integração com relógio ainda
}

async function checkFollowedFriend(userId: string): Promise<boolean> {
  const rows = await query(`SELECT 1 FROM follows WHERE follower_id = $1 LIMIT 1`, [userId]);
  return rows.length > 0;
}

async function checkHasProfilePhoto(userId: string): Promise<boolean> {
  const rows = await query<{ avatar_url: string | null }>(
    `SELECT avatar_url FROM app_users WHERE id = $1`,
    [userId]
  );
  return !!rows[0]?.avatar_url;
}

// Honor system — não dá pra confirmar de fora que a pessoa seguiu no
// Instagram. Sempre "completável"; o app só deixa resgatar depois de
// mostrar o link e pedir confirmação (ver Progress/index.tsx).
async function checkFollowedInstagram(_userId: string): Promise<boolean> {
  return true;
}

const RUN_FIVE_TARGET = 5;

async function countRunActivities(userId: string): Promise<number> {
  const rows = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM activities WHERE user_id = $1 AND activity_type = 'run'`,
    [userId]
  );
  return Number(rows[0].count);
}

async function checkRanFiveTimes(userId: string): Promise<boolean> {
  return (await countRunActivities(userId)) >= RUN_FIVE_TARGET;
}

// Honor system — a própria loja (App Store/Play Store) não devolve pro
// app se a pessoa realmente avaliou, só que o prompt foi aberto.
async function checkLeftReview(_userId: string): Promise<boolean> {
  return true;
}

async function checkPostedImageToFeed(userId: string): Promise<boolean> {
  const rows = await query(
    `SELECT 1 FROM posts p JOIN post_photos pp ON pp.post_id = p.id WHERE p.user_id = $1 LIMIT 1`,
    [userId]
  );
  return rows.length > 0;
}

const CHALLENGE_CHECKS: Record<string, (userId: string) => Promise<boolean>> = {
  c1: checkConnectedWatch,
  c2: checkFollowedFriend,
  c3: checkHasProfilePhoto,
  c4: checkFollowedInstagram,
  c5: checkRanFiveTimes,
  c6: checkLeftReview,
  c7: checkPostedImageToFeed,
};

// Só c5 tem barra de progresso — os outros são liga/desliga (completou
// ou não). Isolado num mapa à parte pra não precisar de campo progress/
// target inútil nos desafios que não usam.
const PROGRESS_CHALLENGES: Record<string, { getProgress: (userId: string) => Promise<number>; target: number }> = {
  c5: { getProgress: countRunActivities, target: RUN_FIVE_TARGET },
};

export interface ChallengeStatus {
  id: string;
  xp: number;
  completed: boolean;
  claimed: boolean;
  progress?: number;
  target?: number;
}

export async function getChallengeStatuses(userId: string): Promise<ChallengeStatus[]> {
  const claimedRows = await query<{ challenge_id: string }>(
    `SELECT challenge_id FROM challenge_claims WHERE user_id = $1`,
    [userId]
  );
  const claimedIds = new Set(claimedRows.map((r) => r.challenge_id));

  const results: ChallengeStatus[] = [];
  for (const id of Object.keys(CHALLENGE_CHECKS)) {
    const claimed = claimedIds.has(id);
    const completed = claimed ? true : await CHALLENGE_CHECKS[id](userId);

    const progressInfo = PROGRESS_CHALLENGES[id];
    let progress: number | undefined;
    let target: number | undefined;
    if (progressInfo) {
      target = progressInfo.target;
      progress = claimed ? target : Math.min(await progressInfo.getProgress(userId), target);
    }

    results.push({ id, xp: CHALLENGE_XP[id], completed, claimed, progress, target });
  }
  return results;
}

export async function claimChallenge(userId: string, challengeId: string) {
  const check = CHALLENGE_CHECKS[challengeId];
  if (!check) throw new ChallengeError('Desafio não encontrado.');

  const already = await query(
    `SELECT 1 FROM challenge_claims WHERE user_id = $1 AND challenge_id = $2`,
    [userId, challengeId]
  );
  if (already.length > 0) throw new ChallengeError('Esse desafio já foi resgatado.');

  const completed = await check(userId);
  if (!completed) throw new ChallengeError('Esse desafio ainda não foi concluído.');

  await query(
    `INSERT INTO challenge_claims (user_id, challenge_id) VALUES ($1, $2)`,
    [userId, challengeId]
  );
  await grantXp(userId, 'challenge_claim', challengeId, CHALLENGE_XP[challengeId]);
}
