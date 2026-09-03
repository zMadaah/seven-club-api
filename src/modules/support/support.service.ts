import { query } from '../../db/pool';

export class SupportError extends Error {}

interface MessageRow {
  id: string;
  ticket_id: string;
  sender_type: 'user' | 'staff';
  body: string;
  image_url: string | null;
  created_at: string;
}

function mapMessage(row: MessageRow) {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    sender: row.sender_type,
    text: row.body,
    imageUrl: row.image_url,
    createdAt: row.created_at,
  };
}

// Um usuário tem no máximo um ticket "aberto" por vez — reaproveita se já
// existir, em vez de abrir um novo toda hora que a pessoa manda mensagem.
// Vocabulário de status (new/in_progress/resolved) é o que o dashboard já
// espera — ver migration 019 pra por que isso mudou de open/pending/closed.
async function getOrCreateOpenTicket(userId: string): Promise<string> {
  const existing = await query<{ id: string }>(
    `SELECT id FROM support_tickets
      WHERE user_id = $1 AND status IN ('new', 'in_progress')
      ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );
  if (existing.length > 0) return existing[0].id;

  const created = await query<{ id: string }>(
    `INSERT INTO support_tickets (user_id, subject) VALUES ($1, $2) RETURNING id`,
    [userId, 'Relato pelo app']
  );
  return created[0].id;
}

// text pode vir vazio SE imageUrl existir (manda só a imagem, sem
// legenda) — mas não os dois vazios ao mesmo tempo, isso é validado na
// rota (schema), não aqui.
export async function sendSupportMessage(userId: string, text: string, imageUrl?: string) {
  const ticketId = await getOrCreateOpenTicket(userId);

  const rows = await query<MessageRow>(
    `INSERT INTO support_messages (ticket_id, sender_type, sender_id, body, image_url)
     VALUES ($1, 'user', $2, $3, $4)
     RETURNING id, ticket_id, sender_type, body, image_url, created_at`,
    [ticketId, userId, text, imageUrl ?? null]
  );

  // "new" — mensagem do usuário sinaliza que precisa de atenção do staff.
  // Reabre até um ticket já "resolved" se a pessoa mandar mensagem de novo.
  await query(`UPDATE support_tickets SET status = 'new', updated_at = now() WHERE id = $1`, [
    ticketId,
  ]);

  return mapMessage(rows[0]);
}

export async function listMyMessages(userId: string) {
  const ticketRows = await query<{ id: string }>(
    `SELECT id FROM support_tickets WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );
  if (ticketRows.length === 0) return [];

  const rows = await query<MessageRow>(
    `SELECT id, ticket_id, sender_type, body, image_url, created_at
       FROM support_messages
      WHERE ticket_id = $1
      ORDER BY created_at ASC`,
    [ticketRows[0].id]
  );

  return rows.map(mapMessage);
}

// ── Lado staff (dashboard) ──────────────────────────────────────────────
// A partir daqui, formato de resposta segue exatamente o que
// DashboardSevenClub/src/features/chat/api.ts já espera — inclusive a
// mistura de camelCase (lista de tickets) com snake_case (mensagens), que
// não escolhi, só respeitei o que o front já tem escrito.

interface StaffTicketRow {
  id: string;
  user_id: string;
  display_name: string;
  status: string;
  last_message: string | null;
  updated_at: string;
  created_at: string;
}

export async function listTicketsForStaff(params: { status?: string; page: number; pageSize: number }) {
  const { status, page, pageSize } = params;
  const offset = (page - 1) * pageSize;

  const conditions: string[] = [];
  const values: any[] = [];
  let i = 0;
  if (status) {
    i++;
    conditions.push(`t.status = $${i}`);
    values.push(status);
  }
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countRows = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM support_tickets t ${whereClause}`,
    values
  );

  const rows = await query<StaffTicketRow>(
    `SELECT t.id, t.user_id, u.display_name, t.status, t.updated_at, t.created_at,
            (SELECT body FROM support_messages WHERE ticket_id = t.id ORDER BY created_at DESC LIMIT 1) AS last_message
       FROM support_tickets t
       JOIN app_users u ON u.id = t.user_id
       ${whereClause}
      ORDER BY t.updated_at DESC
      LIMIT $${i + 1} OFFSET $${i + 2}`,
    [...values, pageSize, offset]
  );

  const total = Number(countRows[0].count);

  return {
    tickets: rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      userName: r.display_name,
      status: r.status,
      lastMessage: r.last_message,
      updatedAt: r.updated_at,
      createdAt: r.created_at,
    })),
    pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  };
}

export async function listTicketMessagesForStaff(ticketId: string) {
  const rows = await query<MessageRow & { sender_id: string | null }>(
    `SELECT id, ticket_id, sender_type, sender_id, body, image_url, created_at
       FROM support_messages
      WHERE ticket_id = $1
      ORDER BY created_at ASC`,
    [ticketId]
  );

  return rows.map((r) => ({
    id: r.id,
    ticket_id: r.ticket_id,
    sender: r.sender_type,
    staff_id: r.sender_type === 'staff' ? r.sender_id : null,
    message: r.body,
    image_url: r.image_url,
    created_at: r.created_at,
  }));
}

export async function sendStaffMessage(staffId: string, ticketId: string, message: string, imageUrl?: string) {
  const ticketExists = await query(`SELECT id FROM support_tickets WHERE id = $1`, [ticketId]);
  if (ticketExists.length === 0) throw new SupportError('Ticket não encontrado.');

  const rows = await query<MessageRow & { sender_id: string | null }>(
    `INSERT INTO support_messages (ticket_id, sender_type, sender_id, body, image_url)
     VALUES ($1, 'staff', $2, $3, $4)
     RETURNING id, ticket_id, sender_type, sender_id, body, image_url, created_at`,
    [ticketId, staffId, message, imageUrl ?? null]
  );

  await query(`UPDATE support_tickets SET status = 'in_progress', updated_at = now() WHERE id = $1`, [
    ticketId,
  ]);

  const r = rows[0];
  return {
    id: r.id,
    ticket_id: r.ticket_id,
    sender: r.sender_type,
    staff_id: r.sender_id,
    message: r.body,
    image_url: r.image_url,
    created_at: r.created_at,
  };
}

export async function updateTicketStatusForStaff(ticketId: string, status: string) {
  const rows = await query<StaffTicketRow>(
    `UPDATE support_tickets t SET status = $2, updated_at = now()
      WHERE t.id = $1
     RETURNING t.id, t.user_id,
       (SELECT display_name FROM app_users WHERE id = t.user_id) AS display_name,
       t.status, t.updated_at, t.created_at,
       (SELECT body FROM support_messages WHERE ticket_id = t.id ORDER BY created_at DESC LIMIT 1) AS last_message`,
    [ticketId, status]
  );
  if (rows.length === 0) throw new SupportError('Ticket não encontrado.');

  const r = rows[0];
  return {
    id: r.id,
    userId: r.user_id,
    userName: r.display_name,
    status: r.status,
    lastMessage: r.last_message,
    updatedAt: r.updated_at,
    createdAt: r.created_at,
  };
}
