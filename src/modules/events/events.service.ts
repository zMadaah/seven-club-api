import { query } from '../../db/pool';

// O dashboard espera um status ('scheduled'/'live'/'finished') mas a
// tabela não guarda isso como coluna — é calculado na hora a partir de
// starts_at/ends_at comparado com o momento atual. "cancelled" não tem
// como ser derivado disso (precisaria de uma coluna própria); por
// enquanto o create/list só cobrem os 3 estados que vêm do calendário.
interface EventRow {
  id: string;
  name: string;
  region: string | null;
  starts_at: string;
  ends_at: string;
  created_at: string;
  status: 'scheduled' | 'live' | 'finished';
  participants: string;
}

function mapEvent(r: EventRow) {
  return {
    id: r.id,
    name: r.name,
    location: r.region ?? '',
    eventDate: r.starts_at,
    status: r.status,
    participants: Number(r.participants),
    createdAt: r.created_at,
  };
}

export async function listEvents(params: {
  page: number;
  pageSize: number;
  status?: 'scheduled' | 'live' | 'finished';
}) {
  const { page, pageSize, status } = params;
  const offset = (page - 1) * pageSize;

  const baseCte = `
    WITH computed AS (
      SELECT e.id, e.name, e.region, e.starts_at, e.ends_at, e.created_at,
             CASE
               WHEN now() < e.starts_at THEN 'scheduled'
               WHEN now() BETWEEN e.starts_at AND e.ends_at THEN 'live'
               ELSE 'finished'
             END AS status,
             COALESCE(
               (SELECT COUNT(*) FROM event_participants ep WHERE ep.event_id = e.id),
               0
             ) AS participants
        FROM events e
    )
  `;

  const whereClause = status ? `WHERE status = $1` : '';
  const params2 = status ? [status, pageSize, offset] : [pageSize, offset];
  const limitOffsetIdx = status ? [2, 3] : [1, 2];

  const countRows = await query<{ count: string }>(
    `${baseCte} SELECT COUNT(*) AS count FROM computed ${whereClause}`,
    status ? [status] : []
  );

  const rows = await query<EventRow>(
    `${baseCte}
     SELECT * FROM computed
     ${whereClause}
     ORDER BY starts_at DESC
     LIMIT $${limitOffsetIdx[0]} OFFSET $${limitOffsetIdx[1]}`,
    params2
  );

  const total = Number(countRows[0].count);

  return {
    events: rows.map(mapEvent),
    pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  };
}

export async function createEvent(input: { name: string; location: string; eventDate: string }) {
  // O dashboard manda uma data só (eventDate) — a tabela tem starts_at/
  // ends_at separados. Decisão simples: o evento "dura o dia inteiro" a
  // partir da data escolhida (starts_at = eventDate, ends_at = +24h).
  const startsAt = new Date(input.eventDate);
  const endsAt = new Date(startsAt.getTime() + 24 * 60 * 60 * 1000);

  const rows = await query<{ id: string }>(
    `INSERT INTO events (name, region, starts_at, ends_at)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [input.name, input.location, startsAt.toISOString(), endsAt.toISOString()]
  );

  const result = await listEvents({ page: 1, pageSize: 1 });
  const created = result.events.find((e) => e.id === rows[0].id);
  return (
    created ?? {
      id: rows[0].id,
      name: input.name,
      location: input.location,
      eventDate: startsAt.toISOString(),
      status: 'scheduled' as const,
      participants: 0,
    }
  );
}
