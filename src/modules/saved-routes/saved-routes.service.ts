import { query } from '../../db/pool';
import { cellsForLoop, cellAreaM2 } from '../../utils/h3';
import { totalDistance, isLoopClosed, LatLng } from '../../utils/geo';

export class SavedRouteError extends Error {}

const FREE_ROUTE_LIMIT = 3;

function toLineString(points: LatLng[]): string {
  return `LINESTRING(${points.map((p) => `${p.longitude} ${p.latitude}`).join(', ')})`;
}

export async function createSavedRoute(userId: string, name: string, points: LatLng[]) {
  const userRows = await query<{ role: string }>(`SELECT role FROM app_users WHERE id = $1`, [userId]);
  const isSubscriber = userRows[0]?.role === 'subscriber';

  if (!isSubscriber) {
    const countRows = await query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM saved_routes WHERE user_id = $1`,
      [userId]
    );
    if (Number(countRows[0].count) >= FREE_ROUTE_LIMIT) {
      throw new SavedRouteError(
        `Você já salvou ${FREE_ROUTE_LIMIT} rotas grátis. Assine o Seven Club Pro para salvar rotas ilimitadas.`
      );
    }
  }

  const distanceMeters = totalDistance(points);

  // Estimativa de captura só pra prévia — não reserva território de verdade
  // (isso só acontece quando a atividade é de fato registrada).
  const estimateM2 = isLoopClosed(points)
    ? cellsForLoop(points).reduce((sum, idx) => sum + cellAreaM2(idx), 0)
    : 0;

  const rows = await query<{ id: string; created_at: string }>(
    `INSERT INTO saved_routes (user_id, name, path, distance_meters, capture_m2_estimate)
     VALUES ($1, $2, ST_GeomFromText($3, 4326)::geography, $4, $5)
     RETURNING id, created_at`,
    [userId, name, toLineString(points), distanceMeters, estimateM2]
  );

  return {
    id: rows[0].id,
    name,
    points,
    distanceMeters,
    captureM2: estimateM2,
    createdAt: rows[0].created_at,
  };
}

export async function listSavedRoutes(userId: string) {
  const rows = await query<any>(
    `SELECT id, name, distance_meters, capture_m2_estimate, created_at,
            ST_AsGeoJSON(path) AS path_geojson
       FROM saved_routes
      WHERE user_id = $1
      ORDER BY created_at DESC`,
    [userId]
  );

  return rows.map((r) => {
    const geojson = JSON.parse(r.path_geojson);
    const points: LatLng[] = geojson.coordinates.map(([lng, lat]: [number, number]) => ({
      latitude: lat,
      longitude: lng,
    }));

    return {
      id: r.id,
      name: r.name,
      points,
      distanceMeters: Number(r.distance_meters),
      captureM2: Number(r.capture_m2_estimate),
      createdAt: r.created_at,
    };
  });
}

export async function deleteSavedRoute(userId: string, routeId: string) {
  await query(`DELETE FROM saved_routes WHERE id = $1 AND user_id = $2`, [routeId, userId]);
}
