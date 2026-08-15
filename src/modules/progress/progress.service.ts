import { query } from '../../db/pool';
import { getTotalXp, levelFromTotalXp } from './xp.service';
import { getRivals } from './rivals.service';
import { getCurrentSeason } from './seasons.service';

async function getCurrentTerritoryM2(userId: string, activityType: 'run' | 'ride'): Promise<number> {
  const rows = await query<{ area: string }>(
    `SELECT COALESCE(SUM(cell_area_m2), 0) AS area
       FROM territory_cells
      WHERE owner_user_id = $1 AND activity_type = $2`,
    [userId, activityType]
  );
  return Number(rows[0].area);
}

// Maior território que essa pessoa já chegou a ter (não é o atual — é o
// pico histórico), reconstruído a partir do histórico de capturas: soma
// quando ela captura, subtrai quando perde, e guarda o maior valor da
// linha do tempo. Mesma técnica usada em stats.service.ts (getMyHistory).
async function getBestTerritoryM2(userId: string, activityType: 'run' | 'ride'): Promise<number> {
  const rows = await query<{ best: string }>(
    `WITH my_events AS (
       SELECT tce.captured_at,
              CASE WHEN tce.new_owner_user_id = $1 THEN tc.cell_area_m2 ELSE -tc.cell_area_m2 END AS delta
         FROM territory_capture_events tce
         JOIN territory_cells tc
           ON tc.h3_index = tce.h3_index AND tc.activity_type = tce.activity_type
        WHERE tce.activity_type = $2
          AND (tce.new_owner_user_id = $1 OR tce.previous_owner_user_id = $1)
     ),
     running AS (
       SELECT SUM(delta) OVER (ORDER BY captured_at) AS cumulative FROM my_events
     )
     SELECT COALESCE(MAX(cumulative), 0) AS best FROM running`,
    [userId, activityType]
  );
  return Math.max(0, Number(rows[0].best));
}

export async function getProgressSummary(userId: string, activityType: 'run' | 'ride') {
  const [totalXp, territoryM2, territoryBestM2, rivals, season] = await Promise.all([
    getTotalXp(userId),
    getCurrentTerritoryM2(userId, activityType),
    getBestTerritoryM2(userId, activityType),
    getRivals(userId, activityType),
    getCurrentSeason(),
  ]);

  const { level, exp, expTarget } = levelFromTotalXp(totalXp);
  const rivalsBeating = rivals.filter((r) => r.yourTerritoryKm2 > r.rivalTerritoryKm2).length;

  return {
    level,
    exp,
    expTarget,
    territoryM2,
    territoryBestM2,
    rivalsCount: rivals.length,
    rivalsBeating,
    season: season
      ? { id: season.id, number: season.number, name: season.name, startsAt: season.starts_at, endsAt: season.ends_at }
      : null,
  };
}
