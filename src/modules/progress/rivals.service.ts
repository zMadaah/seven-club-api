import { query } from '../../db/pool';

interface RivalAreaRow {
  rival_id: string;
  area: string;
}

interface RivalCountRow {
  rival_id: string;
  count: string;
}

interface RivalRow {
  id: string;
  display_name: string;
  avatar_url: string | null;
  profile_color: string | null;
}

// Um "rival" é qualquer pessoa que já roubou território seu, ou de quem
// você já roubou. yourTerritoryKm2/rivalTerritoryKm2 são o território que
// cada um de vocês SEGURA HOJE especificamente vindo do outro (célula que
// você possui agora e cuja captura mais recente veio dele, e vice-versa)
// — não o território total de cada um. yourSteals/rivalSteals já são
// contagem histórica completa, independente de quem segura a célula hoje.
export async function getRivals(userId: string, activityType: 'run' | 'ride') {
  const [yourHeldFromRival, rivalHeldFromYou, yourSteals, rivalSteals] = await Promise.all([
    // células que EU possuo agora, cuja captura mais recente veio de cada rival
    query<RivalAreaRow>(
      `WITH last_event AS (
         SELECT DISTINCT ON (tce.h3_index)
                tce.h3_index, tce.previous_owner_user_id, tc.cell_area_m2
           FROM territory_capture_events tce
           JOIN territory_cells tc
             ON tc.h3_index = tce.h3_index AND tc.activity_type = tce.activity_type
          WHERE tce.activity_type = $2 AND tc.owner_user_id = $1
          ORDER BY tce.h3_index, tce.captured_at DESC
       )
       SELECT previous_owner_user_id AS rival_id, SUM(cell_area_m2) AS area
         FROM last_event
        WHERE previous_owner_user_id IS NOT NULL
        GROUP BY previous_owner_user_id`,
      [userId, activityType]
    ),
    // células que cada rival possui agora, cuja captura mais recente veio de MIM
    query<RivalAreaRow>(
      `WITH last_event AS (
         SELECT DISTINCT ON (tce.h3_index)
                tce.h3_index, tce.previous_owner_user_id, tce.new_owner_user_id, tc.cell_area_m2, tc.owner_user_id
           FROM territory_capture_events tce
           JOIN territory_cells tc
             ON tc.h3_index = tce.h3_index AND tc.activity_type = tce.activity_type
          WHERE tce.activity_type = $2
          ORDER BY tce.h3_index, tce.captured_at DESC
       )
       SELECT owner_user_id AS rival_id, SUM(cell_area_m2) AS area
         FROM last_event
        WHERE previous_owner_user_id = $1 AND owner_user_id IS NOT NULL AND owner_user_id <> $1
        GROUP BY owner_user_id`,
      [userId, activityType]
    ),
    // quantas vezes eu já roubei de cada um (histórico completo)
    query<RivalCountRow>(
      `SELECT previous_owner_user_id AS rival_id, COUNT(*) AS count
         FROM territory_capture_events
        WHERE activity_type = $2 AND new_owner_user_id = $1
          AND previous_owner_user_id IS NOT NULL AND previous_owner_user_id <> $1
        GROUP BY previous_owner_user_id`,
      [userId, activityType]
    ),
    // quantas vezes cada um já roubou de mim (histórico completo)
    query<RivalCountRow>(
      `SELECT new_owner_user_id AS rival_id, COUNT(*) AS count
         FROM territory_capture_events
        WHERE activity_type = $2 AND previous_owner_user_id = $1
          AND new_owner_user_id IS NOT NULL AND new_owner_user_id <> $1
        GROUP BY new_owner_user_id`,
      [userId, activityType]
    ),
  ]);

  const rivalIds = new Set<string>();
  const yourAreaMap = new Map<string, number>();
  const rivalAreaMap = new Map<string, number>();
  const yourStealsMap = new Map<string, number>();
  const rivalStealsMap = new Map<string, number>();

  for (const r of yourHeldFromRival) { rivalIds.add(r.rival_id); yourAreaMap.set(r.rival_id, Number(r.area)); }
  for (const r of rivalHeldFromYou) { rivalIds.add(r.rival_id); rivalAreaMap.set(r.rival_id, Number(r.area)); }
  for (const r of yourSteals) { rivalIds.add(r.rival_id); yourStealsMap.set(r.rival_id, Number(r.count)); }
  for (const r of rivalSteals) { rivalIds.add(r.rival_id); rivalStealsMap.set(r.rival_id, Number(r.count)); }

  if (rivalIds.size === 0) return [];

  const rivalRows = await query<RivalRow>(
    `SELECT id, display_name, avatar_url, profile_color FROM app_users WHERE id = ANY($1::uuid[])`,
    [Array.from(rivalIds)]
  );
  const rivalInfo = new Map(rivalRows.map((r) => [r.id, r]));

  const rivals = Array.from(rivalIds)
    .map((rivalId) => {
      const info = rivalInfo.get(rivalId);
      return {
        id: rivalId,
        name: info?.display_name ?? 'Corredor',
        avatarUrl: info?.avatar_url ?? '',
        color: info?.profile_color ?? '#999999',
        yourTerritoryKm2: (yourAreaMap.get(rivalId) ?? 0) / 1_000_000,
        yourSteals: yourStealsMap.get(rivalId) ?? 0,
        rivalTerritoryKm2: (rivalAreaMap.get(rivalId) ?? 0) / 1_000_000,
        rivalSteals: rivalStealsMap.get(rivalId) ?? 0,
        activityType,
      };
    })
    // mais "quente" primeiro: soma de roubos nos dois sentidos
    .sort((a, b) => b.yourSteals + b.rivalSteals - (a.yourSteals + a.rivalSteals));

  return rivals;
}
