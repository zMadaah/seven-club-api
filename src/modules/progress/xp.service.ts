import { query } from '../../db/pool';
import { getCurrentSeason } from './seasons.service';

// ── Fórmula de XP/nível — v1, propositalmente simples ────────────────────
// Não existia fórmula nenhuma definida antes disso (o app mostrava
// "Nível 0 / EXP 0 de 10" fixo, sem lógica real). Escolhi um valor fixo
// por nível pra ser fácil de entender e fácil de trocar depois — se um
// dia isso precisar de curva de dificuldade crescente (cada nível pedir
// mais XP que o anterior), é só mudar EXP_PER_LEVEL por uma função.
export const EXP_PER_LEVEL = 100;

export function levelFromTotalXp(totalXp: number): { level: number; exp: number; expTarget: number } {
  const level = Math.floor(totalXp / EXP_PER_LEVEL);
  const exp = totalXp % EXP_PER_LEVEL;
  return { level, exp, expTarget: EXP_PER_LEVEL };
}

// Nível é sempre a soma da temporada ATUAL, não da vida toda — é isso
// que faz o reset de temporada "funcionar de graça": ao criar uma
// temporada nova, a soma começa vazia sozinha, sem precisar apagar
// nenhum xp_event antigo (que continua servindo de histórico/auditoria).
export async function getTotalXp(userId: string): Promise<number> {
  const season = await getCurrentSeason();
  if (!season) return 0;

  const rows = await query<{ total: string }>(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM xp_events WHERE user_id = $1 AND season_id = $2`,
    [userId, season.id]
  );
  return Number(rows[0].total);
}

// Concede XP de uma fonte específica (insígnia ou desafio) — idempotente
// por causa da constraint UNIQUE(user_id, source, source_id): tentar
// conceder de novo pela mesma fonte simplesmente não faz nada.
export async function grantXp(userId: string, source: string, sourceId: string, amount: number) {
  const season = await getCurrentSeason();
  if (!season) return; // sem temporada cadastrada, não tem onde estampar — não deveria acontecer em uso normal

  await query(
    `INSERT INTO xp_events (user_id, source, source_id, amount, season_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, source, source_id, season_id) DO NOTHING`,
    [userId, source, sourceId, amount, season.id]
  );
}
