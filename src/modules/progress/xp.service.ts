import { query } from '../../db/pool';

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

export async function getTotalXp(userId: string): Promise<number> {
  const rows = await query<{ total: string }>(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM xp_events WHERE user_id = $1`,
    [userId]
  );
  return Number(rows[0].total);
}

// Concede XP de uma fonte específica (insígnia ou desafio) — idempotente
// por causa da constraint UNIQUE(user_id, source, source_id): tentar
// conceder de novo pela mesma fonte simplesmente não faz nada.
export async function grantXp(userId: string, source: string, sourceId: string, amount: number) {
  await query(
    `INSERT INTO xp_events (user_id, source, source_id, amount)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, source, source_id) DO NOTHING`,
    [userId, source, sourceId, amount]
  );
}
