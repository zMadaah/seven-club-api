import { pool } from '../../db/pool';
import { cellsForLoop, cellAreaM2, cellCenter } from '../../utils/h3';
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
