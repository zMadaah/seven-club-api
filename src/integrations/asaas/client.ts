// Cliente HTTP fino pra API da Asaas — v3. Nenhuma lógica de negócio
// aqui, só a chamada em si + tratamento de erro consistente.
import { env } from '../../config/env';

const BASE_URL = env.asaasApiUrl; // sandbox ou produção, por variável de ambiente

export class AsaasError extends Error {
  constructor(message: string, public status: number, public details?: unknown) {
    super(message);
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
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
}

export async function createAsaasCustomer(params: { name: string; email: string; externalReference: string }) {
  return request<AsaasCustomer>('/customers', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export interface AsaasCheckout {
  id: string;
  link: string; // URL do checkout hospedado — é isso que o app abre
  status: string;
}

// "Checkout com Assinatura (recorrente)" — chargeTypes: RECURRENT +
// subscription.cycle é o que faz a Asaas gerar cobranças repetidas
// automaticamente, sem eu precisar disparar nada manualmente a cada
// ciclo.
export async function createSubscriptionCheckout(params: {
  customerId: string;
  cycle: 'MONTHLY' | 'YEARLY';
  valueCents: number;
  description: string;
  externalReference: string;
  successUrl: string;
  cancelUrl: string;
  expiredUrl: string;
}) {
  return request<AsaasCheckout>('/checkouts', {
    method: 'POST',
    body: JSON.stringify({
      customer: params.customerId,
      billingTypes: ['CREDIT_CARD', 'PIX'],
      chargeTypes: ['RECURRENT'],
      minutesToExpire: 60,
      callback: {
        successUrl: params.successUrl,
        cancelUrl: params.cancelUrl,
        expiredUrl: params.expiredUrl,
      },
      items: [
        {
          name: params.description,
          quantity: 1,
          value: params.valueCents / 100,
        },
      ],
      subscription: {
        cycle: params.cycle,
      },
      externalReference: params.externalReference,
    }),
  });
}
