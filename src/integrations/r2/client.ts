import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { env } from '../../config/env';

// R2 é compatível com a API do S3 — o mesmo SDK da AWS funciona, só
// trocando o endpoint pro domínio da Cloudflare específico da conta.
const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${env.r2AccountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: env.r2AccessKeyId,
    secretAccessKey: env.r2SecretAccessKey,
  },
});

export class R2UploadError extends Error {}

export async function uploadToR2(params: {
  key: string;
  body: Buffer;
  contentType: string;
}): Promise<string> {
  if (!env.r2AccountId || !env.r2AccessKeyId || !env.r2BucketName || !env.r2PublicUrl) {
    throw new R2UploadError('Upload de imagem não configurado no servidor (variáveis do R2 ausentes).');
  }

  await r2Client.send(
    new PutObjectCommand({
      Bucket: env.r2BucketName,
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType,
    })
  );

  // r2PublicUrl é a URL pública do bucket (pub-xxxx.r2.dev ou domínio
  // customizado) — sem barra final, por convenção do .env.
  return `${env.r2PublicUrl}/${params.key}`;
}
