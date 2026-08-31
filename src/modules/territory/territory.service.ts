import { pool } from '../../db/pool';
import { cellsForLoop, cellAreaM2, cellCenter, cellBoundary } from '../../utils/h3';
import { LatLng } from '../../utils/geo';
import { getTotalXp, levelFromTotalXp } from '../progress/xp.service';
import { createNotification } from '../notifications/notifications.service';
import { sendExpoPushNotification } from '../notifications-push/push.service';

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
  // Quem perdeu território nessa captura específica, e quanto — pra
  // notificar cada um só uma vez no final, mesmo perdendo várias
  // células (em vez de mandar uma notificação por célula).
  const stolenFrom = new Map<string, { cells: number; areaM2: number }>();

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
      if (previousOwner) {
        cellsStolenFromOthers += 1;
        const prev = stolenFrom.get(previousOwner) ?? { cells: 0, areaM2: 0 };
        stolenFrom.set(previousOwner, { cells: prev.cells + 1, areaM2: prev.areaM2 + area });
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // Notifica quem perdeu território — depois do commit, só se a
  // captura realmente foi salva. Cada dono anterior recebe UMA
  // notificação (não uma por célula), mesmo perdendo vários hexágonos
  // pro mesmo capturador na mesma atividade.
  if (stolenFrom.size > 0) {
    const nameRows = await pool.query<{ display_name: string }>(
      `SELECT display_name FROM app_users WHERE id = $1`,
      [userId]
    );
    const capturerName = nameRows.rows[0]?.display_name ?? 'Alguém';

    // Fire-and-forget deliberado — quem está registrando a atividade
    // não deveria esperar o tempo de notificar N pessoas diferentes.
    // Erro em uma notificação (token inválido, etc.) não derruba as
    // outras nem a resposta da atividade em si.
    for (const [previousOwnerId, lost] of stolenFrom) {
      notifyTerritoryLost(previousOwnerId, capturerName, lost.cells, lost.areaM2).catch((err) => {
        console.warn(`Falha ao notificar ${previousOwnerId} sobre território perdido:`, err);
      });
    }
  }

  return { captureM2, cellsCaptured, cellsStolenFromOthers };
}

// Mensagem varia conforme quanto foi perdido — "1 hexágono" no
// singular, e a área em m² (perdas pequenas, mais comum) ou km²
// (perdas grandes) pra não mostrar um número gigante tipo "45000 m²".
async function notifyTerritoryLost(userId: string, capturerName: string, cells: number, areaM2: number) {
  const cellsLabel = cells === 1 ? '1 hexágono' : `${cells} hexágonos`;
  const areaLabel = areaM2 >= 10000 ? `${(areaM2 / 1_000_000).toFixed(2)} km²` : `${Math.round(areaM2)} m²`;
  const title = 'Você perdeu território!';
  const subtitle = `${capturerName} tomou ${cellsLabel} seus (${areaLabel}). Corre lá pra retomar.`;

  await createNotification({ userId, category: 'territory', title, subtitle });

  const rows = await pool.query<{ expo_push_token: string | null }>(
    `SELECT expo_push_token FROM app_users WHERE id = $1`,
    [userId]
  );
  const token = rows.rows[0]?.expo_push_token;
  if (token) {
    await sendExpoPushNotification({ expoPushToken: token, title, body: subtitle });
  }
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

export class TerritoryCellError extends Error {}

// Detalhe de "quem dominou esse hexágono" — pro modal que abre ao tocar
// numa célula no mapa. Junta o dono atual com a atividade mais recente
// que capturou essa célula especificamente (via territory_capture_events,
// não territory_cells — essa segunda só guarda o estado atual, não
// histórico de quando/como foi capturada).
export async function getCellOwnerDetail(h3Index: string) {
  const cellRows = await pool.query(
    `SELECT owner_user_id FROM territory_cells WHERE h3_index = $1`,
    [h3Index]
  );
  if (cellRows.rows.length === 0 || !cellRows.rows[0].owner_user_id) {
    throw new TerritoryCellError('Esse hexágono ainda não tem dono.');
  }
  const ownerId = cellRows.rows[0].owner_user_id;

  const ownerRows = await pool.query(
    `SELECT display_name, avatar_url, location, country_code FROM app_users WHERE id = $1`,
    [ownerId]
  );
  if (ownerRows.rows.length === 0) {
    throw new TerritoryCellError('Usuário não encontrado.');
  }
  const owner = ownerRows.rows[0];

  // Última atividade que capturou essa célula PRO DONO ATUAL — se a
  // célula já trocou de mão várias vezes, pega só a captura mais
  // recente que resultou no dono de agora (ignora capturas antigas de
  // donos anteriores).
  const captureRows = await pool.query(
    `SELECT a.id, a.distance_meters, a.duration_seconds, a.capture_m2,
            a.avg_pace_sec_per_km, tce.captured_at
       FROM territory_capture_events tce
       JOIN activities a ON a.id = tce.activity_id
      WHERE tce.h3_index = $1 AND tce.new_owner_user_id = $2
      ORDER BY tce.captured_at DESC
      LIMIT 1`,
    [h3Index, ownerId]
  );

  const totalXp = await getTotalXp(ownerId);
  const { level } = levelFromTotalXp(totalXp);

  const capture = captureRows.rows[0] ?? null;

  return {
    ownerId,
    ownerName: owner.display_name,
    ownerAvatarUrl: owner.avatar_url,
    ownerLevel: level,
    location: owner.location,
    countryCode: owner.country_code,
    activity: capture
      ? {
          activityId: capture.id,
          distanceMeters: Number(capture.distance_meters),
          durationSeconds: capture.duration_seconds,
          captureM2: Number(capture.capture_m2),
          avgPaceSecPerKm: capture.avg_pace_sec_per_km ? Number(capture.avg_pace_sec_per_km) : null,
          capturedAt: capture.captured_at,
        }
      : null,
  };
}
