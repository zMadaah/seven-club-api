import { query } from '../../db/pool';
import { grantXp } from './xp.service';
import { getCurrentSeason } from './seasons.service';

// Mesmos 6 ids do catálogo que já existe no app (services/mock/badges.ts)
// — nome/descrição/ícone continuam só no app; aqui só decidimos se está
// desbloqueada. "Fundador de Crew" nunca desbloqueia ainda: Crew não
// existe como funcionalidade real no backend.
const BADGE_XP: Record<string, number> = {
  b1: 10, // Primeira Corrida
  b2: 15, // Primeiro Território
  b3: 20, // Ladrão de Território
  b4: 25, // Fundador de Crew — sem critério possível ainda (Crew não existe)
  b5: 30, // Sequência de 7 Dias
  b6: 50, // Top 100 Global
};

async function checkFirstActivity(userId: string): Promise<boolean> {
  const rows = await query(`SELECT 1 FROM activities WHERE user_id = $1 LIMIT 1`, [userId]);
  return rows.length > 0;
}

async function checkFirstTerritory(userId: string): Promise<boolean> {
  const rows = await query(
    `SELECT 1 FROM activities WHERE user_id = $1 AND capture_m2 > 0 LIMIT 1`,
    [userId]
  );
  return rows.length > 0;
}

async function checkFirstSteal(userId: string): Promise<boolean> {
  const rows = await query(
    `SELECT 1 FROM territory_capture_events
      WHERE new_owner_user_id = $1
        AND previous_owner_user_id IS NOT NULL
        AND previous_owner_user_id <> $1
      LIMIT 1`,
    [userId]
  );
  return rows.length > 0;
}

// Clássico "gaps and islands": agrupa dias consecutivos de atividade e
// pega a maior sequência.
async function checkSevenDayStreak(userId: string): Promise<boolean> {
  const rows = await query<{ streak_len: string }>(
    `WITH activity_days AS (
       SELECT DISTINCT started_at::date AS day FROM activities WHERE user_id = $1
     ),
     grouped AS (
       SELECT day, day - (ROW_NUMBER() OVER (ORDER BY day))::int AS grp
         FROM activity_days
     )
     SELECT COUNT(*) AS streak_len
       FROM grouped
      GROUP BY grp
      ORDER BY streak_len DESC
      LIMIT 1`,
    [userId]
  );
  return rows.length > 0 && Number(rows[0].streak_len) >= 7;
}

async function checkTop100Global(userId: string): Promise<boolean> {
  const rows = await query<{ best_rank: string }>(
    `WITH ranks AS (
       SELECT owner_user_id, RANK() OVER (PARTITION BY activity_type ORDER BY SUM(cell_area_m2) DESC) AS rank
         FROM territory_cells
        WHERE owner_user_id IS NOT NULL
        GROUP BY owner_user_id, activity_type
     )
     SELECT MIN(rank) AS best_rank FROM ranks WHERE owner_user_id = $1`,
    [userId]
  );
  if (rows.length === 0 || rows[0].best_rank === null) return false;
  return Number(rows[0].best_rank) <= 100;
}

const BADGE_CHECKS: Record<string, (userId: string) => Promise<boolean>> = {
  b1: checkFirstActivity,
  b2: checkFirstTerritory,
  b3: checkFirstSteal,
  b4: async () => false, // Fundador de Crew — Crew não existe ainda
  b5: checkSevenDayStreak,
  b6: checkTop100Global,
};

export interface BadgeStatus {
  id: string;
  unlocked: boolean;
  unlockedAt: string | null;
}

export async function getBadgeStatuses(userId: string): Promise<BadgeStatus[]> {
  const season = await getCurrentSeason();
  const results: BadgeStatus[] = [];

  for (const badgeId of Object.keys(BADGE_CHECKS)) {
    const alreadyUnlocked = season
      ? await query<{ unlocked_at: string }>(
          `SELECT unlocked_at FROM badge_unlocks WHERE user_id = $1 AND badge_id = $2 AND season_id = $3`,
          [userId, badgeId, season.id]
        )
      : [];

    if (alreadyUnlocked.length > 0) {
      results.push({ id: badgeId, unlocked: true, unlockedAt: alreadyUnlocked[0].unlocked_at });
      continue;
    }

    const meetsCriteria = await BADGE_CHECKS[badgeId](userId);
    if (meetsCriteria && season) {
      const inserted = await query<{ unlocked_at: string }>(
        `INSERT INTO badge_unlocks (user_id, badge_id, season_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, badge_id, season_id) DO UPDATE SET badge_id = EXCLUDED.badge_id
         RETURNING unlocked_at`,
        [userId, badgeId, season.id]
      );
      await grantXp(userId, 'badge_unlock', badgeId, BADGE_XP[badgeId] ?? 0);
      results.push({ id: badgeId, unlocked: true, unlockedAt: inserted[0].unlocked_at });
    } else {
      results.push({ id: badgeId, unlocked: false, unlockedAt: null });
    }
  }

  return results;
}
