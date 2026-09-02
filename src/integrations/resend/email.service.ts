import { env } from '../../config/env';

export function isEmailConfigured(): boolean {
  return Boolean(env.resendApiKey);
}

// API REST do Resend direto — sem SDK extra, só uma chamada HTTP simples.
export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.resendFromEmail,
      to,
      subject,
      html,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Falha ao enviar e-mail via Resend (${res.status}): ${detail}`);
  }
}
