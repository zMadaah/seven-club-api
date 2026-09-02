import { query } from '../../db/pool';

export class ReportError extends Error {}

// Chamado pelo app — usuário denunciando um post ou comentário.
export async function createReport(reporterId: string, targetType: 'post' | 'comment', targetId: string) {
  // Confirma que o alvo existe de verdade antes de aceitar a denúncia
  // — evita lixo no banco por causa de post_id/comment_id inválido
  // vindo de um cliente desatualizado ou de uma chamada direta à API.
  const table = targetType === 'post' ? 'posts' : 'post_comments';
  const exists = await query(`SELECT 1 FROM ${table} WHERE id = $1`, [targetId]);
  if (exists.length === 0) {
    throw new ReportError(targetType === 'post' ? 'Post não encontrado.' : 'Comentário não encontrado.');
  }

  await query(
    `INSERT INTO reports (reporter_id, target_type, target_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (reporter_id, target_type, target_id) DO NOTHING`,
    [reporterId, targetType, targetId]
  );
}

interface ReportRow {
  id: string;
  target_type: 'post' | 'comment';
  target_id: string;
  status: string;
  created_at: string;
  reporter_id: string;
  reporter_name: string;
  // Conteúdo denunciado — vem de posts OU post_comments conforme
  // target_type, por isso o LEFT JOIN duplo + COALESCE em vez de um
  // JOIN só (não dá pra saber de antemão qual tabela usar em SQL puro
  // sem repetir a query inteira pra cada tipo).
  content_text: string | null;
  content_author_id: string | null;
  content_author_name: string | null;
  post_id_for_comment: string | null;
}

// Lista pro dashboard — staff só, com o texto denunciado e quem é o
// autor já resolvidos, pra não precisar de uma segunda chamada por
// item.
export async function listReports(status?: string) {
  const params: string[] = [];
  let statusFilter = '';
  if (status && status !== 'all') {
    params.push(status);
    statusFilter = `WHERE r.status = $${params.length}`;
  }

  const rows = await query<ReportRow>(
    `SELECT
       r.id, r.target_type, r.target_id, r.status, r.created_at,
       r.reporter_id, reporter.display_name AS reporter_name,
       COALESCE(p.caption, pc.body) AS content_text,
       COALESCE(p.user_id, pc.user_id) AS content_author_id,
       COALESCE(p_author.display_name, pc_author.display_name) AS content_author_name,
       pc.post_id AS post_id_for_comment
     FROM reports r
     JOIN app_users reporter ON reporter.id = r.reporter_id
     LEFT JOIN posts p ON r.target_type = 'post' AND p.id = r.target_id
     LEFT JOIN app_users p_author ON p_author.id = p.user_id
     LEFT JOIN post_comments pc ON r.target_type = 'comment' AND pc.id = r.target_id
     LEFT JOIN app_users pc_author ON pc_author.id = pc.user_id
     ${statusFilter}
     ORDER BY r.created_at DESC
     LIMIT 200`,
    params
  );

  return rows.map((r) => ({
    id: r.id,
    targetType: r.target_type,
    targetId: r.target_id,
    postIdForComment: r.post_id_for_comment,
    status: r.status,
    createdAt: r.created_at,
    reporterId: r.reporter_id,
    reporterName: r.reporter_name,
    contentText: r.content_text,
    // null aqui significa: o post/comentário já foi apagado desde a
    // denúncia (LEFT JOIN não achou nada) — o dashboard mostra isso
    // como "conteúdo removido" em vez de quebrar.
    contentAuthorId: r.content_author_id,
    contentAuthorName: r.content_author_name,
  }));
}

export async function updateReportStatus(
  reportId: string,
  staffId: string,
  status: 'reviewed' | 'dismissed'
) {
  const rows = await query<{ id: string }>(
    `UPDATE reports SET status = $1, reviewed_by = $2, reviewed_at = now() WHERE id = $3 RETURNING id`,
    [status, staffId, reportId]
  );
  if (rows.length === 0) throw new ReportError('Denúncia não encontrada.');
}
