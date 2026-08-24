import { env } from '../../config/env';

export class AsaasError extends Error {
  constructor(message: string, public status: number, public raw: unknown) {
    super(message);
  }
}

async function asaasRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${env.asaasApiUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      access_token: env.asaasApiKey,
      ...options.headers,
    },
  });

  const data: any = await res.json().catch(() => null);

  if (!res.ok) {
    const message = data?.errors?.[0]?.description ?? `Erro ${res.status} na Asaas`;
    throw new AsaasError(message, res.status, data);
  }

  return data as T;
}

export interface AsaasCustomer {
  id: string;
  name: string;
  email: string;
  cpfCnpj: string;
}

export async function createAsaasCustomer(params: { name: string; email: string; cpfCnpj: string }) {
  return asaasRequest<AsaasCustomer>('/customers', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export interface AsaasSubscription {
  id: string;
  customer: string;
  status: string;
  value: number;
  cycle: string;
  nextDueDate: string;
}

export interface AsaasSubscriptionFirstPayment {
  invoiceUrl?: string;
}

// billingType: UNDEFINED deixa o próprio cliente escolher a forma de
// pagamento na página hospedada da Asaas (cartão, PIX, boleto) — é o
// que gera a experiência de "link de checkout" que decidimos usar, sem
// a gente precisar lidar com dado de cartão dentro do app.
export async function createAsaasSubscription(params: {
  customerId: string;
  value: number;
  cycle: 'MONTHLY' | 'YEARLY';
  description: string;
}) {
  return asaasRequest<AsaasSubscription>('/subscriptions', {
    method: 'POST',
    body: JSON.stringify({
      customer: params.customerId,
      billingType: 'UNDEFINED',
      value: params.value,
      cycle: params.cycle,
      nextDueDate: new Date().toISOString().slice(0, 10),
      description: params.description,
    }),
  });
}

// A assinatura em si não tem link de checkout direto — precisa buscar
// a primeira cobrança gerada por ela, que sim tem invoiceUrl.
export async function getFirstPaymentInvoiceUrl(subscriptionId: string): Promise<string | null> {
  const result = await asaasRequest<{ data: AsaasSubscriptionFirstPayment[] }>(
    `/payments?subscription=${subscriptionId}&limit=1`
  );
  return result.data[0]?.invoiceUrl ?? null;
}

export async function cancelAsaasSubscription(subscriptionId: string) {
  return asaasRequest<{ deleted: boolean }>(`/subscriptions/${subscriptionId}`, { method: 'DELETE' });
}
