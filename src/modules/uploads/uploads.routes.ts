import { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { authenticate } from '../../plugins/authenticate';
import { uploadToR2, R2UploadError } from '../../integrations/r2/client';

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024; // 8MB

function extensionFor(mimeType: string): string {
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/webp') return '.webp';
  return '.jpg';
}

export async function uploadsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.post(
    '/uploads',
    { config: { rateLimit: { max: 20, timeWindow: '15 minutes' } } },
    async (request, reply) => {
      const file = await request.file({ limits: { fileSize: MAX_FILE_SIZE_BYTES } });

      if (!file) {
        return reply.code(400).send({ error: 'Nenhum arquivo enviado.' });
      }

      if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
        return reply.code(400).send({ error: 'Formato de imagem não suportado. Use JPEG, PNG ou WebP.' });
      }

      // Precisa ler o arquivo inteiro na memória antes de mandar pro R2
      // (o SDK do S3 não aceita stream direto do jeito que o @fastify/
      // multipart entrega) — com o limite de 8MB já configurado acima,
      // isso não é um problema de memória.
      const chunks: Buffer[] = [];
      for await (const chunk of file.file) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);

      if (file.file.truncated) {
        return reply.code(400).send({ error: 'Arquivo maior que 8MB.' });
      }

      const key = `${request.userId}/${randomUUID()}${extensionFor(file.mimetype)}`;

      try {
        const url = await uploadToR2({ key, body: buffer, contentType: file.mimetype });
        return reply.code(201).send({ url });
      } catch (err) {
        if (err instanceof R2UploadError) return reply.code(500).send({ error: err.message });
        request.log.error(err, 'Falha ao enviar arquivo pro R2');
        return reply.code(500).send({ error: 'Falha ao processar o upload.' });
      }
    }
  );
}
