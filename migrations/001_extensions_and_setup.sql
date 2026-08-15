-- 001_extensions_and_setup.sql
-- Extensões base exigidas pelo restante do schema.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto; -- necessário para gen_random_uuid()
