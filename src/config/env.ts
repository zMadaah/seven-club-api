import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variável de ambiente ${name} não definida. Veja .env.example.`);
  }
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 3333),
  databaseUrl: required('DATABASE_URL'),
  jwtAccessSecret: required('JWT_ACCESS_SECRET'),
  refreshTokenTtlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 30),
  accessTokenTtl: process.env.ACCESS_TOKEN_TTL ?? '15m',
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
  isProduction: process.env.NODE_ENV === 'production',
  // Asaas — sem required() de propósito: enquanto a chave não estiver
  // configurada no ambiente, o resto do servidor continua funcionando
  // normal, só as rotas de assinatura falham com mensagem clara em vez
  // de derrubar o processo inteiro na inicialização.
  asaasApiKey: process.env.ASAAS_API_KEY ?? '',
  asaasApiUrl: process.env.ASAAS_API_URL ?? 'https://api-sandbox.asaas.com/v3',
  asaasWebhookToken: process.env.ASAAS_WEBHOOK_TOKEN ?? '',
  // R2 (Cloudflare) — sem required() de propósito, mesmo padrão da Asaas:
  // sem essas variáveis configuradas, o resto do servidor continua de pé,
  // só a rota de upload falha com mensagem clara.
  r2AccountId: process.env.R2_ACCOUNT_ID ?? '',
  r2AccessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
  r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
  r2BucketName: process.env.R2_BUCKET_NAME ?? '',
  r2PublicUrl: process.env.R2_PUBLIC_URL ?? '',
  // Resend (e-mail) — único canal de envio de código, tanto pra
  // verificação de cadastro quanto pra recuperação de senha. Sem a
  // chave configurada, cai no devCode (comportamento de antes).
  resendApiKey: process.env.RESEND_API_KEY ?? '',
  resendFromEmail: process.env.RESEND_FROM_EMAIL ?? 'Seven Club <onboarding@resend.dev>',
};
