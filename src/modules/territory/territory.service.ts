import { pool } from '../../db/pool';
import { cellsForLoop, cellAreaM2, cellCenter, cellBoundary } from '../../utils/h3';
import { LatLng } from '../../utils/geo';

export interface CaptureResult {
  captureM2: number;
  cellsCaptured: number;
  cellsStolenFromOthers: number;
}

// Recebe o loop de uma atividade fechada e decide, célula por célula,
// quem passa a ser o dono. Território que já é seu não gera captura de
// novo (evita "farmar" reforçando a própria área). Roda tudo numa única
// transação para não deixar o grid inconsistente se algo falhar no meio.
export async function captureTerritoryForActivity(params: {
  activityId: string;
  userId: string;
  activityType: 'run' | 'ride';
  points: LatLng[];
}): Promise<CaptureResult> {
  const { activityId, userId, activityType, points } = params;

  const cells = cellsForLoop(points);
  if (cells.length === 0) {
    return { captureM2: 0, cellsCaptured: 0, cellsStolenFromOthers: 0 };
  }

  const client = await pool.connect();
  let captureM2 = 0;
  let cellsCaptured = 0;
  let cellsStolenFromOthers = 0;

  try {
    await client.query('BEGIN');

    const { rows: existing } = await client.query(
      `SELECT h3_index, owner_user_id
         FROM territory_cells
        WHERE activity_type = $1 AND h3_index = ANY($2::text[])`,
      [activityType, cells]
    );
    const ownerByCell = new Map<string, string | null>(
      existing.map((r: any) => [r.h3_index, r.owner_user_id])
    );

    for (const h3Index of cells) {
      const previousOwner = ownerByCell.get(h3Index) ?? null;
      if (previousOwner === userId) continue; // já é seu, sem captura nova

      const area = cellAreaM2(h3Index);
      const center = cellCenter(h3Index);

      await client.query(
        `INSERT INTO territory_cells (h3_index, activity_type, owner_user_id, captured_at, center, cell_area_m2)
         VALUES ($1, $2, $3, now(), ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, $6)
         ON CONFLICT (h3_index, activity_type)
         DO UPDATE SET owner_user_id = EXCLUDED.owner_user_id,
                        captured_at   = EXCLUDED.captured_at,
                        cell_area_m2  = EXCLUDED.cell_area_m2`,
        [h3Index, activityType, userId, center.longitude, center.latitude, area]
      );

      await client.query(
        `INSERT INTO territory_capture_events
           (activity_id, h3_index, activity_type, previous_owner_user_id, new_owner_user_id, captured_at)
         VALUES ($1, $2, $3, $4, $5, now())`,
        [activityId, h3Index, activityType, previousOwner, userId]
      );

      captureM2 += area;
      cellsCaptured += 1;
      if (previousOwner) cellsStolenFromOthers += 1;
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return { captureM2, cellsCaptured, cellsStolenFromOthers };
}

export interface TerritoryCellView {
  h3Index: string;
  ownerId: string;
  ownerName: string;
  ownerColor: string;
  isMine: boolean;
  boundary: LatLng[];
}

// Território pra desenhar no mapa (Home, tela de atividade em andamento
// etc.) — diferente de GET /territory, que devolve só as SUAS atividades
// com captura. Aqui é "o que existe nessa região do mapa, de quem for".
// Limitado a 3000 células por chamada — a resolução 10 (~65m/célula) gera
// muita coisa se a pessoa afastar o zoom demais; o client precisa
// re-buscar conforme move o mapa, não tentar carregar o mundo inteiro de
// uma vez.
export async function getTerritoryCellsInBounds(params: {
  activityType: 'run' | 'ride';
  requesterId: string;
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}): Promise<TerritoryCellView[]> {
  const { activityType, requesterId, minLat, maxLat, minLng, maxLng } = params;

  const { rows } = await pool.query<{
    h3_index: string;
    owner_user_id: string;
    display_name: string;
    profile_color: string | null;
  }>(
    `SELECT tc.h3_index, tc.owner_user_id, u.display_name, u.profile_color
       FROM territory_cells tc
       JOIN app_users u ON u.id = tc.owner_user_id
      WHERE tc.activity_type = $1
        AND tc.owner_user_id IS NOT NULL
        AND ST_Intersects(tc.center, ST_MakeEnvelope($2, $3, $4, $5, 4326)::geography)
      LIMIT 3000`,
    [activityType, minLng, minLat, maxLng, maxLat]
  );

  return rows.map((r) => ({
    h3Index: r.h3_index,
    ownerId: r.owner_user_id,
    ownerName: r.display_name,
    ownerColor: r.profile_color ?? '#999999',
    isMine: r.owner_user_id === requesterId,
    boundary: cellBoundary(r.h3_index),
  }));
}
