import { FastifyInstance } from 'fastify';
import { authenticate } from '../../plugins/authenticate';
import { pool } from '../../db/pool';
import { formatDuration } from '../../utils/format';
import { getTerritoryCellsInBounds, getCellOwnerDetail, TerritoryCellError } from './territory.service';

export async function territoryRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  // Formato inspirado em TerritoryEntry (src/types/territory.ts do app).
  // Campos que dependem de camadas ainda não construídas ficam de fora
  // por enquanto — ver README, seção "O que ainda falta pro app".
  app.get('/territory', async (request) => {
    const { activityType } = request.query as { activityType?: 'run' | 'ride' };
    const type = activityType === 'ride' ? 'ride' : 'run';

    const { rows } = await pool.query(
      `SELECT a.id, a.name, a.activity_type, a.distance_meters, a.duration_seconds,
              a.capture_m2, a.created_at, ST_AsGeoJSON(a.trajectory) AS trajectory_geojson
         FROM activities a
        WHERE a.user_id = $1 AND a.activity_type = $2 AND a.capture_m2 > 0
        ORDER BY a.created_at DESC
        LIMIT 50`,
      [request.userId, type]
    );

    return rows.map((r: any) => {
      const geojson = JSON.parse(r.trajectory_geojson);
      const points = geojson.coordinates.map(([lng, lat]: [number, number]) => ({
        latitude: lat,
        longitude: lng,
      }));

      return {
        id: r.id,
        points,
        captureM2: Number(r.capture_m2),
        activityName: r.name,
        activityType: r.activity_type,
        capturedAtLabel: r.created_at,
        distanceKm: Number(r.distance_meters) / 1000,
        durationLabel: formatDuration(r.duration_seconds),
      };
    });
  });

  // Território pra desenhar no mapa — mina + de todo mundo, dentro da
  // região que o app está mostrando na tela naquele momento.
  app.get('/territory/cells', async (request, reply) => {
    const { activityType, minLat, maxLat, minLng, maxLng } = request.query as Record<string, string>;
    const type = activityType === 'ride' ? 'ride' : 'run';

    const bounds = [minLat, maxLat, minLng, maxLng].map(Number);
    if (bounds.some((n) => Number.isNaN(n))) {
      return reply.code(400).send({ error: 'minLat, maxLat, minLng, maxLng são obrigatórios.' });
    }

    return getTerritoryCellsInBounds({
      activityType: type,
      requesterId: request.userId!,
      minLat: bounds[0],
      maxLat: bounds[1],
      minLng: bounds[2],
      maxLng: bounds[3],
    });
  });

  // Detalhe de quem dominou um hexágono específico — abre o modal ao
  // tocar numa célula no mapa.
  app.get('/territory/cells/:h3Index/owner', async (request, reply) => {
    const { h3Index } = request.params as { h3Index: string };
    try {
      return await getCellOwnerDetail(h3Index);
    } catch (err) {
      if (err instanceof TerritoryCellError) return reply.code(404).send({ error: err.message });
      throw err;
    }
  });
}
