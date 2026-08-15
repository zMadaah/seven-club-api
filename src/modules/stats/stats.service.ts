import { query } from '../../db/pool';

export async function getMyStats(userId: string, activityType: 'run' | 'ride') {
  const areaRows = await query<{ area: string }>(
    `SELECT COALESCE(SUM(cell_area_m2), 0) AS area
       FROM territory_cells
      WHERE owner_user_id = $1 AND activity_type = $2`,
    [userId, activityType]
  );

  const stealRows = await query<{ steals: string }>(
    `SELECT COUNT(*) AS steals
       FROM territory_capture_events
      WHERE new_owner_user_id = $1 AND activity_type = $2
        AND previous_owner_user_id IS NOT NULL AND previous_owner_user_id <> $1`,
    [userId, activityType]
  );

  const rankRows = await query<{ user_id: string; rank: string }>(
    `SELECT owner_user_id AS user_id, RANK() OVER (ORDER BY SUM(cell_area_m2) DESC) AS rank
       FROM territory_cells
      WHERE activity_type = $1 AND owner_user_id IS NOT NULL
      GROUP BY owner_user_id`,
    [activityType]
  );

  const myRank = rankRows.find((r) => r.user_id === userId);

  return {
    currentTerritoryM2: Number(areaRows[0].area),
    globalRank: myRank ? myRank.rank : null,
    totalSteals: Number(stealRows[0].steals),
    // Depende do país no perfil do usuário, que ainda não coletamos —
    // ver README, seção "O que ainda falta pro app".
    countryRank: null as string | null,
  };
}

// --- Histórico / rotina (ViewHistory) ---------------------------------------

interface WeeklyDistancePoint {
  weekStart: string;
  label: string;
  distanceKm: number;
}

interface TerritoryPoint {
  month: string;
  territoryM2: number;
}

export interface ActivityHistory {
  weeklyDistance: WeeklyDistancePoint[];
  territoryOverTime: TerritoryPoint[];
  totals: {
    totalDistanceKm: number;
    totalActivities: number;
    totalCapturedM2: number;
    cellsOwned: number;
  };
  memberSince: string;
}

const WEEKS_WINDOW = 8;
const MONTHS_WINDOW = 6;
const MONTH_LABELS = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

// Semana começando na segunda-feira, em UTC — combinamos isso com
// `AT TIME ZONE 'UTC'` nas queries pra não depender do timezone de sessão
// configurado no Postgres.
function startOfWeekUTC(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay();
  const diff = (day === 0 ? -6 : 1) - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}

function startOfMonthUTC(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function formatWeekLabel(date: Date): string {
  return `${date.getUTCDate().toString().padStart(2, '0')} ${MONTH_LABELS[date.getUTCMonth()]}`;
}

export async function getMyHistory(userId: string, activityType: 'run' | 'ride'): Promise<ActivityHistory> {
  const now = new Date();

  const currentWeekStart = startOfWeekUTC(now);
  const weeksWindowStart = new Date(currentWeekStart);
  weeksWindowStart.setUTCDate(weeksWindowStart.getUTCDate() - (WEEKS_WINDOW - 1) * 7);

  const currentMonthStart = startOfMonthUTC(now);
  const monthsWindowStart = new Date(currentMonthStart);
  monthsWindowStart.setUTCMonth(monthsWindowStart.getUTCMonth() - (MONTHS_WINDOW - 1));

  const [weeklyRows, baselineRows, monthlyDeltaRows, totalsRows, territoryRows, userRows] = await Promise.all([
    query<{ week_start: string; distance_meters: string }>(
      `SELECT date_trunc('week', started_at AT TIME ZONE 'UTC') AS week_start,
              SUM(distance_meters) AS distance_meters
         FROM activities
        WHERE user_id = $1 AND activity_type = $2 AND started_at >= $3
        GROUP BY 1`,
      [userId, activityType, weeksWindowStart.toISOString()]
    ),

    // Soma de tudo que aconteceu ANTES da janela de meses — é o ponto de
    // partida da linha acumulada, senão o gráfico "zeraria" território que
    // já existia de antes do período mostrado.
    query<{ baseline_area: string }>(
      `SELECT COALESCE(SUM(
                CASE WHEN tce.new_owner_user_id = $1 THEN tc.cell_area_m2 ELSE -tc.cell_area_m2 END
              ), 0) AS baseline_area
         FROM territory_capture_events tce
         JOIN territory_cells tc
           ON tc.h3_index = tce.h3_index AND tc.activity_type = tce.activity_type
        WHERE tce.activity_type = $2
          AND (tce.new_owner_user_id = $1 OR tce.previous_owner_user_id = $1)
          AND tce.captured_at < $3`,
      [userId, activityType, monthsWindowStart.toISOString()]
    ),

    query<{ month_start: string; delta: string }>(
      `SELECT date_trunc('month', tce.captured_at AT TIME ZONE 'UTC') AS month_start,
              SUM(CASE WHEN tce.new_owner_user_id = $1 THEN tc.cell_area_m2 ELSE -tc.cell_area_m2 END) AS delta
         FROM territory_capture_events tce
         JOIN territory_cells tc
           ON tc.h3_index = tce.h3_index AND tc.activity_type = tce.activity_type
        WHERE tce.activity_type = $2
          AND (tce.new_owner_user_id = $1 OR tce.previous_owner_user_id = $1)
          AND tce.captured_at >= $3
        GROUP BY 1`,
      [userId, activityType, monthsWindowStart.toISOString()]
    ),

    query<{ total_distance_meters: string; total_activities: string }>(
      `SELECT COALESCE(SUM(distance_meters), 0) AS total_distance_meters, COUNT(*) AS total_activities
         FROM activities
        WHERE user_id = $1 AND activity_type = $2`,
      [userId, activityType]
    ),

    query<{ area: string; cells: string }>(
      `SELECT COALESCE(SUM(cell_area_m2), 0) AS area, COUNT(*) AS cells
         FROM territory_cells
        WHERE owner_user_id = $1 AND activity_type = $2`,
      [userId, activityType]
    ),

    query<{ created_at: string }>(`SELECT created_at FROM app_users WHERE id = $1`, [userId]),
  ]);

  // --- distância semanal, com zero-fill nas semanas sem atividade ---
  const weeklyByStart = new Map<string, number>();
  for (const row of weeklyRows) {
    weeklyByStart.set(new Date(row.week_start).toISOString(), Number(row.distance_meters));
  }

  const weeklyDistance: WeeklyDistancePoint[] = [];
  for (let i = 0; i < WEEKS_WINDOW; i++) {
    const weekStart = new Date(weeksWindowStart);
    weekStart.setUTCDate(weekStart.getUTCDate() + i * 7);
    const meters = weeklyByStart.get(weekStart.toISOString()) ?? 0;
    weeklyDistance.push({
      weekStart: weekStart.toISOString(),
      label: formatWeekLabel(weekStart),
      distanceKm: meters / 1000,
    });
  }

  // --- território acumulado ao longo do tempo (baseline + delta mensal) ---
  const monthlyDeltaByStart = new Map<string, number>();
  for (const row of monthlyDeltaRows) {
    monthlyDeltaByStart.set(new Date(row.month_start).toISOString(), Number(row.delta));
  }

  let running = Number(baselineRows[0]?.baseline_area ?? 0);
  const territoryOverTime: TerritoryPoint[] = [];
  for (let i = 0; i < MONTHS_WINDOW; i++) {
    const monthStart = new Date(monthsWindowStart);
    monthStart.setUTCMonth(monthStart.getUTCMonth() + i);
    running += monthlyDeltaByStart.get(monthStart.toISOString()) ?? 0;
    territoryOverTime.push({
      month: MONTH_LABELS[monthStart.getUTCMonth()],
      // nunca deve ficar negativo de verdade, mas arredondamentos de
      // ponto flutuante ao longo de muitos eventos podem chegar bem perto
      // de zero por baixo — trava em 0 pra não mostrar um gráfico esquisito
      territoryM2: Math.max(0, running),
    });
  }

  return {
    weeklyDistance,
    territoryOverTime,
    totals: {
      totalDistanceKm: Number(totalsRows[0].total_distance_meters) / 1000,
      totalActivities: Number(totalsRows[0].total_activities),
      totalCapturedM2: Number(territoryRows[0].area),
      cellsOwned: Number(territoryRows[0].cells),
    },
    memberSince: userRows[0]?.created_at ?? new Date().toISOString(),
  };
}
