-- 031_support_message_image.sql
--
-- Suporte a imagem nas mensagens de chat de suporte (app e staff) —
-- pra usuário poder relatar um erro anexando um print, por exemplo.
-- Reaproveita a rota de upload genérica que já existe (POST /uploads,
-- que já sobe pro R2 e devolve uma URL) — aqui só guarda essa URL
-- junto da mensagem.

ALTER TABLE support_messages
  ADD COLUMN image_url TEXT;
