-- 023_push_tokens.sql

ALTER TABLE app_users
  ADD COLUMN expo_push_token VARCHAR(255);
