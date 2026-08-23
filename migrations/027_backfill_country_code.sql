-- 027_backfill_country_code.sql
-- O cadastro nunca definia country_code (ficava sempre NULL), e não
-- existe (nem precisa existir agora, o app é focado no Brasil) nenhuma
-- tela pro usuário escolher isso manualmente. Sem country_code, o
-- ranking "País" fica vazio pra todo mundo — mesmo quem já tem
-- atividade e território registrados.

UPDATE app_users
   SET country_code = 'BR'
 WHERE country_code IS NULL;
