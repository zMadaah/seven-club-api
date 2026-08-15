import { query } from '../../db/pool';
import { grantXp } from './xp.service';

export class ChallengeError extends Error {}

// Mesmos 3 ids do catálogo que já existe no app (services/mock/progress.ts)
// e o mesmo valor de XP que já estava lá (10 cada). "Conectar relógio
// Garmin" nunca fica completável ainda — integração com relógio é decisão
// de fornecedor, não foi construída (mesma razão do SMS).
const CHALLENGE_XP: Record<string, number> = { c1: 10, c2: 10, c3: 10 };

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

const CHALLENGE_CHECKS: Record<string, (userId: string) => Promise<boolean>> = {
  c1: checkConnectedWatch,
  c2: checkFollowedFriend,
  c3: checkHasProfilePhoto,
};

export interface ChallengeStatus {
  id: string;
  xp: number;
  completed: boolean;
  claimed: boolean;
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
    results.push({ id, xp: CHALLENGE_XP[id], completed, claimed });
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
