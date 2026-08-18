import { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';
import { pipeline } from 'stream/promises';
import { authenticate } from '../../plugins/authenticate';

// ATENÇÃO — isto é um upload de DESENVOLVIMENTO/HOMOLOGAÇÃO, não uma
// solução de produção: grava no disco local da instância da API. No
// Render (e na maioria dos PaaS), o disco não é persistente entre deploys
// e reinícios — os arquivos somem. Antes de ir pra produção, isso precisa
// virar upload de verdade pra um provedor de object storage (S3,
// Cloudinary, Supabase Storage etc.) — decisão de fornecedor, não técnica.
const UPLOADS_DIR = path.join(__dirname, '..', '..', '..', 'uploads');
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024; // 8MB

function extensionFor(mimeType: string): string {
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/webp') return '.webp';
  return '.jpg';
}

export async function uploadsRoutes(app: FastifyInstance) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });

  app.addHook('preHandler', authenticate);

  app.post('/uploads', {
    config: { rateLimit: { max: 20, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
    const file = await request.file({ limits: { fileSize: MAX_FILE_SIZE_BYTES } });

    if (!file) {
      return reply.code(400).send({ error: 'Nenhum arquivo enviado.' });
    }

    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      return reply.code(400).send({ error: 'Formato de imagem não suportado. Use JPEG, PNG ou WebP.' });
    }

    const filename = `${randomUUID()}${extensionFor(file.mimetype)}`;
    const destination = path.join(UPLOADS_DIR, filename);

    try {
      await pipeline(file.file, fs.createWriteStream(destination));
    } catch {
      return reply.code(400).send({ error: 'Falha ao processar o arquivo (pode ter excedido 8MB).' });
    }

    if (file.file.truncated) {
      fs.unlink(destination, () => {});
      return reply.code(400).send({ error: 'Arquivo maior que 8MB.' });
    }

    const url = `${request.protocol}://${request.headers.host}/uploads/${filename}`;
    return reply.code(201).send({ url });
  });
}
