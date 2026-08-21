import { pool } from '../../db/pool';
import { totalDistance, isLoopClosed, LatLng } from '../../utils/geo';
import { formatPace } from '../../utils/format';
import { captureTerritoryForActivity } from '../territory/territory.service';
import { grantXp } from '../progress/xp.service';

export interface SubmitActivityInput {
  userId: string;
  name: string;
  activityType: 'run' | 'ride';
  points: LatLng[];
  startedAt: string;
  endedAt: string;
}

function toLineString(points: LatLng[]): string {
  return `LINESTRING(${points.map((p) => `${p.longitude} ${p.latitude}`).join(', ')})`;
}

export async function submitActivity(input: SubmitActivityInput) {
  const { userId, name, activityType, points, startedAt, endedAt } = input;

  if (points.length < 2) {
    throw new Error('Atividade precisa de pelo menos 2 pontos de GPS.');
  }

  // Distância e loop fechado são recalculados aqui — nunca confiamos só
  // no que o app manda, já que isso decide se território é capturado.
  const distanceMeters = totalDistance(points);
  const durationSeconds = Math.max(
    1,
    Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000)
  );
  const loopClosed = isLoopClosed(points);
  const avgPaceSecPerKm = distanceMeters > 10 ? durationSeconds / (distanceMeters / 1000) : null;

  const { rows } = await pool.query(
    `INSERT INTO activities
       (user_id, name, activity_type, started_at, ended_at, distance_meters,
        duration_seconds, avg_pace_sec_per_km, trajectory, loop_closed, capture_m2, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, ST_GeomFromText($9, 4326)::geography, $10, 0, 'validated')
     RETURNING id, created_at`,
    [
      userId, name, activityType, startedAt, endedAt, distanceMeters,
      durationSeconds, avgPaceSecPerKm, toLineString(points), loopClosed,
    ]
  );

  const activityId = rows[0].id as string;
  let captureM2 = 0;

  if (loopClosed) {
    const result = await captureTerritoryForActivity({ activityId, userId, activityType, points });
    captureM2 = result.captureM2;

    await pool.query(`UPDATE activities SET capture_m2 = $1 WHERE id = $2`, [captureM2, activityId]);
    await pool.query(
      `UPDATE app_users
          SET total_distance_km = total_distance_km + $1,
              total_territory_km2 = total_territory_km2 + $2
        WHERE id = $3`,
      [distanceMeters / 1000, captureM2 / 1_000_000, userId]
    );
  } else {
    await pool.query(
      `UPDATE app_users SET total_distance_km = total_distance_km + $1 WHERE id = $2`,
      [distanceMeters / 1000, userId]
    );
  }

  // XP v1, propositalmente simples (mesmo espírito do EXP_PER_LEVEL em
  // xp.service.ts): 1 XP por km percorrido + 1 XP por 100m² de
  // território capturado. Antes disso, registrar atividade não gerava
  // XP nenhum — só desafios e insígnias concediam, deixando "correr de
  // verdade" sem recompensa direta no nível.
  const distanceXp = Math.floor(distanceMeters / 1000);
  const territoryXp = Math.floor(captureM2 / 100);
  const totalXpEarned = distanceXp + territoryXp;
  if (totalXpEarned > 0) {
    await grantXp(userId, 'activity', activityId, totalXpEarned);
  }

  return {
    id: activityId,
    name,
    activityType,
    points,
    distanceMeters,
    durationSeconds,
    paceLabel: formatPace(avgPaceSecPerKm),
    loopClosed,
    captureM2,
    createdAt: rows[0].created_at,
  };
}

export async function listActivities(userId: string) {
  const { rows } = await pool.query(
    `SELECT id, name, activity_type, distance_meters, duration_seconds,
            avg_pace_sec_per_km, loop_closed, capture_m2, created_at
       FROM activities
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 100`,
    [userId]
  );

  return rows.map((r: any) => ({
    id: r.id,
    name: r.name,
    activityType: r.activity_type,
    distanceMeters: Number(r.distance_meters),
    durationSeconds: r.duration_seconds,
    paceLabel: formatPace(r.avg_pace_sec_per_km === null ? null : Number(r.avg_pace_sec_per_km)),
    loopClosed: r.loop_closed,
    captureM2: Number(r.capture_m2),
    createdAt: r.created_at,
  }));
}

export async function getActivityById(userId: string, activityId: string) {
  const { rows } = await pool.query(
    `SELECT id, name, activity_type, distance_meters, duration_seconds,
            avg_pace_sec_per_km, loop_closed, capture_m2, created_at,
            ST_AsGeoJSON(trajectory) AS trajectory_geojson
       FROM activities
      WHERE id = $1 AND user_id = $2`,
    [activityId, userId]
  );

  if (rows.length === 0) return null;

  const r = rows[0];
  const geojson = JSON.parse(r.trajectory_geojson);
  const points: LatLng[] = geojson.coordinates.map(([lng, lat]: [number, number]) => ({
    latitude: lat,
    longitude: lng,
  }));

  return {
    id: r.id,
    name: r.name,
    activityType: r.activity_type,
    points,
    distanceMeters: Number(r.distance_meters),
    durationSeconds: r.duration_seconds,
    paceLabel: formatPace(r.avg_pace_sec_per_km === null ? null : Number(r.avg_pace_sec_per_km)),
    loopClosed: r.loop_closed,
    captureM2: Number(r.capture_m2),
    createdAt: r.created_at,
  };
}
