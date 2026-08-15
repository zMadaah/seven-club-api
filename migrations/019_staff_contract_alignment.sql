-- 019_staff_contract_alignment.sql
-- Ajusta o backend pro contrato que o dashboard (DashboardSevenClub) já
-- tem escrito e funcionando — em vez de mudar o front já pronto, o
-- backend se adapta ao que ele espera.

ALTER TABLE admin_users RENAME TO staff_users;

-- username: conceito novo, o produto não tinha isso até agora (login é
-- por email/celular, identidade social é display_name). O dashboard
-- espera um campo obrigatório, então preenche automaticamente a partir
-- do e-mail pra quem já tem conta, e passa a gerar em todo cadastro novo.
ALTER TABLE app_users
  ADD COLUMN username VARCHAR(50) UNIQUE,
  ADD COLUMN role      VARCHAR(20) NOT NULL DEFAULT 'subscriber';

WITH derived AS (
  SELECT id,
         regexp_replace(lower(split_part(email, '@', 1)), '[^a-z0-9_]', '', 'g') AS base,
         ROW_NUMBER() OVER (
           PARTITION BY regexp_replace(lower(split_part(email, '@', 1)), '[^a-z0-9_]', '', 'g')
           ORDER BY created_at
         ) AS rn
    FROM app_users
   WHERE username IS NULL
)
UPDATE app_users u
   SET username = CASE WHEN d.rn = 1 THEN d.base ELSE d.base || d.rn::text END
  FROM derived d
 WHERE u.id = d.id;

-- support_tickets.status: o dashboard já foi escrito esperando
-- new/in_progress/resolved (sem "closed" separado, sem "pending"/"open").
-- Rebatizado direto (não é mapeamento em código) porque esse enum não é
-- checado em nenhum outro lugar sensível do sistema (diferente de
-- app_users.status, que o login usa — esse continua como está,
-- active/suspended/banned, com o mapeamento pro dashboard feito no
-- código, não no banco).
UPDATE support_tickets SET status = 'new' WHERE status = 'open';
UPDATE support_tickets SET status = 'in_progress' WHERE status = 'pending';
UPDATE support_tickets SET status = 'resolved' WHERE status = 'closed';

ALTER TABLE support_tickets ALTER COLUMN status SET DEFAULT 'new';
