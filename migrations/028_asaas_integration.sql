-- 028_asaas_integration.sql

-- CPF só é pedido na hora do checkout (a Asaas exige pra criar um
-- cliente) — não no cadastro geral, pra não gerar fricção em quem nunca
-- vai assinar. Fica salvo depois da primeira vez, pra próxima assinatura
-- não precisar pedir de novo.
ALTER TABLE app_users
  ADD COLUMN cpf_cnpj VARCHAR(20),
  ADD COLUMN asaas_customer_id VARCHAR(50);

ALTER TABLE user_subscriptions
  ADD COLUMN asaas_subscription_id VARCHAR(50);

-- Preço em placeholder — ajustar depois de decidir com o sandbox.
-- billing_interval 'month'/'year' já existia desde a migration 006.
INSERT INTO subscription_plans (code, name, price_cents, billing_interval)
VALUES
  ('pro_monthly', 'Seven Club Pro (mensal)', 1990, 'month'),
  ('pro_annual',  'Seven Club Pro (anual)',  19900, 'year')
ON CONFLICT (code) DO NOTHING;

-- Achado importante: a coluna `role` (migration 019) foi criada com
-- DEFAULT 'subscriber' — todo mundo já nascia marcado como assinante,
-- mesmo sem nunca ter pago nada. Isso não tinha efeito prático até
-- agora (role era só um placeholder, sem lógica real de gate em lugar
-- nenhum), mas quebraria totalmente o "3 rotas grátis, depois precisa
-- assinar" que vamos construir — corrigido o padrão daqui pra frente,
-- e revertidos pra 'free' quem nunca teve nenhuma assinatura ativa de
-- verdade (ou seja, praticamente todo mundo até agora).
ALTER TABLE app_users ALTER COLUMN role SET DEFAULT 'free';

UPDATE app_users
   SET role = 'free'
 WHERE role = 'subscriber'
   AND id NOT IN (
     SELECT user_id FROM user_subscriptions WHERE status = 'active'
   );
