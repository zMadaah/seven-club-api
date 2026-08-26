import { query } from '../../db/pool';
import { getCancellationRate } from '../staff-payments/staff-payments.service';

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

interface DailySummaryRow {
  day: string;
  activity_count: string;
  distance_km: string;
  capture_km2: string;
}

// Agregado por dia — diferente de listActivitiesForStaff (lista paginada,
// item por item), essa função é feita especificamente pra alimentar
// gráfico de tendência: todos os dias do período de uma vez, já somados.
export async function getActivitiesDailySummary(params: {
  activityType: 'run' | 'ride';
  days: number;
}) {
  const { activityType, days } = params;

  const rows = await query<DailySummaryRow>(
    `SELECT date_trunc('day', created_at) AS day,
            COUNT(*) AS activity_count,
            COALESCE(SUM(distance_meters), 0) / 1000.0 AS distance_km,
            COALESCE(SUM(capture_m2), 0) / 1000000.0 AS capture_km2
       FROM activities
      WHERE activity_type = $1
        AND created_at >= now() - ($2 || ' days')::interval
      GROUP BY day
      ORDER BY day ASC`,
    [activityType, days]
  );

  return rows.map((r) => ({
    day: r.day,
    activityCount: Number(r.activity_count),
    distanceKm: Number(r.distance_km),
    captureKm2: Number(r.capture_km2),
  }));
}

// Diferente de DELETE /activities/:id (que só apaga a PRÓPRIA atividade
// do usuário autenticado do app) — staff pode apagar qualquer uma, útil
// pra limpar duplicatas geradas em teste sem precisar do token da conta
// de usuário específica.
export async function deleteActivityAsStaff(activityId: string) {
  await query(`DELETE FROM activities WHERE id = $1`, [activityId]);
}

export function resolveOverviewDateRange(params: {
  rangeDays?: string;
  rangeYear?: string;
  rangeMonth?: string;
}): { start: Date; end: Date } {
  if (params.rangeYear && params.rangeMonth) {
    const year = Number(params.rangeYear);
    const month = Number(params.rangeMonth); // 1-12
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 1)); // 1º dia do mês seguinte
    return { start, end };
  }
  const days = Number(params.rangeDays) || 7;
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  return { start, end };
}

// Alimenta a aba "Análises" dentro da Home (visão executiva/resumo) —
// diferente de listActivitiesForStaff/getTerritoryDominance (a página
// /analises, com detalhe/tabela). Os dois convivem: um é resumo, o
// outro é drill-down.
export async function getAnalyticsOverview(range: { start: Date; end: Date }) {
  const { start, end } = range;
  const startIso = start.toISOString();
  const endIso = end.toISOString();

  const dailyRows = await query<{ day: string; activity_count: string; capture_km2: string }>(
    `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
            COUNT(*) AS activity_count,
            COALESCE(SUM(capture_m2), 0) / 1000000.0 AS capture_km2
       FROM activities
      WHERE created_at >= $1 AND created_at < $2
      GROUP BY 1
      ORDER BY 1`,
    [startIso, endIso]
  );

  const statsRows = await query<{ activities_count: string; active_users: string }>(
    `SELECT COUNT(*) AS activities_count, COUNT(DISTINCT user_id) AS active_users
       FROM activities
      WHERE created_at >= $1 AND created_at < $2`,
    [startIso, endIso]
  );

  // Tempo médio até a primeira resposta do staff em cada ticket — só
  // considera tickets que já tiveram alguma resposta.
  const responseRows = await query<{ avg_minutes: string | null }>(
    `WITH first_user_msg AS (
       SELECT DISTINCT ON (ticket_id) ticket_id, created_at AS user_time
         FROM support_messages
        WHERE sender_type = 'user'
        ORDER BY ticket_id, created_at ASC
     ),
     first_staff_reply AS (
       SELECT DISTINCT ON (sm.ticket_id) sm.ticket_id, sm.created_at AS staff_time
         FROM support_messages sm
         JOIN first_user_msg fum ON fum.ticket_id = sm.ticket_id
        WHERE sm.sender_type = 'staff' AND sm.created_at > fum.user_time
        ORDER BY sm.ticket_id, sm.created_at ASC
     )
     SELECT AVG(EXTRACT(EPOCH FROM (staff_time - user_time)) / 60) AS avg_minutes
       FROM first_user_msg fum
       JOIN first_staff_reply fsr ON fsr.ticket_id = fum.ticket_id`,
    []
  );

  // Mesmo cálculo de status usado em events.service.ts (não é coluna,
  // é derivado de starts_at/ends_at comparado com agora).
  const eventsRows = await query<{ status: string; count: string }>(
    `SELECT
       CASE
         WHEN now() < starts_at THEN 'scheduled'
         WHEN now() BETWEEN starts_at AND ends_at THEN 'live'
         ELSE 'finished'
       END AS status,
       COUNT(*) AS count
     FROM events
     GROUP BY 1`,
    []
  );

  const anticheatRows = await query<{ status: string; count: string }>(
    `SELECT status, COUNT(*) AS count FROM anticheat_flags GROUP BY 1`,
    []
  );

  const eventsByStatus: Record<string, number> = {};
  for (const r of eventsRows) eventsByStatus[r.status] = Number(r.count);

  const antiCheatByStatus: Record<string, number> = {};
  for (const r of anticheatRows) antiCheatByStatus[r.status] = Number(r.count);

  return {
    weeklyActivity: dailyRows.map((r) => ({
      date: r.day,
      activities: Number(r.activity_count),
      territories: Number(r.capture_km2),
    })),
    stats: {
      activitiesThisWeek: Number(statsRows[0]?.activities_count ?? 0),
      activeUsersThisWeek: Number(statsRows[0]?.active_users ?? 0),
      // Agora com dado real: % de assinaturas já criadas que acabaram
      // canceladas de verdade (status='canceled', não conta
      // past_due/expired, que podem só ser atraso passageiro).
      cancellationRate: await getCancellationRate(),
      avgResponseMinutes:
        responseRows[0]?.avg_minutes != null ? Math.round(Number(responseRows[0].avg_minutes)) : null,
    },
    eventsByStatus,
    antiCheatByStatus,
  };
}
