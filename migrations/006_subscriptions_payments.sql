-- 006_subscriptions_payments.sql
-- Planos, assinaturas de usuários e histórico de pagamentos.

CREATE TABLE subscription_plans (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code              VARCHAR(30) UNIQUE NOT NULL, -- free, pro_monthly, pro_annual
  name              VARCHAR(100) NOT NULL,
  price_cents       INTEGER NOT NULL,
  currency          VARCHAR(3) NOT NULL DEFAULT 'BRL',
  billing_interval  VARCHAR(20), -- month, year, null para o plano free
  active            BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE user_subscriptions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  plan_id                UUID NOT NULL REFERENCES subscription_plans(id),
  status                 VARCHAR(20) NOT NULL DEFAULT 'active', -- active, canceled, expired, past_due
  current_period_start   TIMESTAMPTZ NOT NULL,
  current_period_end     TIMESTAMPTZ NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_subscriptions_user_id ON user_subscriptions(user_id);
CREATE INDEX idx_user_subscriptions_status ON user_subscriptions(status);

CREATE TABLE payments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  subscription_id       UUID REFERENCES user_subscriptions(id) ON DELETE SET NULL,
  amount_cents          INTEGER NOT NULL,
  currency              VARCHAR(3) NOT NULL DEFAULT 'BRL',
  status                VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending, paid, failed, refunded
  provider              VARCHAR(30) NOT NULL,
  provider_payment_id   VARCHAR(255),
  paid_at               TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_payments_user_id ON payments(user_id);
CREATE INDEX idx_payments_status ON payments(status);
