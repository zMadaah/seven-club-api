import { query } from '../../db/pool';

interface ActivityRow {
  id: string;
  user_id: string;
  display_name: string;
  name: string;
  activity_type: string;
  distance_meters: string;
  duration_seconds: number;
  loop_closed: boolean;
  capture_m2: string;
  created_at: string;
}

export async function listActivitiesForStaff(params: {
  page: number;
  pageSize: number;
  activityType?: 'run' | 'ride';
  userId?: string;
}) {
  const { page, pageSize, activityType, userId } = params;
  const offset = (page - 1) * pageSize;

  const conditions: string[] = [];
  const values: any[] = [];
  let i = 0;

  if (activityType) {
    i++;
    conditions.push(`a.activity_type = $${i}`);
    values.push(activityType);
  }
  if (userId) {
    i++;
    conditions.push(`a.user_id = $${i}`);
    values.push(userId);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countRows = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM activities a ${whereClause}`,
    values
  );

  const rows = await query<ActivityRow>(
    `SELECT a.id, a.user_id, u.display_name, a.name, a.activity_type, a.distance_meters,
            a.duration_seconds, a.loop_closed, a.capture_m2, a.created_at
       FROM activities a
       JOIN app_users u ON u.id = a.user_id
       ${whereClause}
      ORDER BY a.created_at DESC
      LIMIT $${i + 1} OFFSET $${i + 2}`,
    [...values, pageSize, offset]
  );

  const total = Number(countRows[0].count);

  return {
    activities: rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      userName: r.display_name,
      name: r.name,
      activityType: r.activity_type,
      distanceMeters: Number(r.distance_meters),
      durationSeconds: r.duration_seconds,
      loopClosed: r.loop_closed,
      captureM2: Number(r.capture_m2),
      createdAt: r.created_at,
    })),
    pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  };
}

interface TerritoryRow {
  user_id: string;
  display_name: string;
  profile_color: string | null;
  area_m2: string;
  cells: string;
}

// Ranking GLOBAL (não filtra por quem está pedindo — é visão de staff,
// diferente do /leaderboard do app, que sempre exclui o próprio
// requisitante da lista de concorrentes).
export async function getTerritoryDominance(activityType: 'run' | 'ride') {
  const rows = await query<TerritoryRow>(
    `SELECT tc.owner_user_id AS user_id, u.display_name, u.profile_color,
            SUM(tc.cell_area_m2) AS area_m2, COUNT(*) AS cells
       FROM territory_cells tc
       JOIN app_users u ON u.id = tc.owner_user_id
      WHERE tc.activity_type = $1 AND tc.owner_user_id IS NOT NULL
      GROUP BY tc.owner_user_id, u.display_name, u.profile_color
      ORDER BY area_m2 DESC
      LIMIT 100`,
    [activityType]
  );

  return rows.map((r, index) => ({
    rank: index + 1,
    userId: r.user_id,
    userName: r.display_name,
    color: r.profile_color ?? '#999999',
    territoryKm2: Number(r.area_m2) / 1_000_000,
    cellsOwned: Number(r.cells),
  }));
}
