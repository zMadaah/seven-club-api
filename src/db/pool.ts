import { Pool } from 'pg';
import { env } from '../config/env';

// Postgres local (localhost/127.0.0.1) não usa SSL. Supabase, Render e
// praticamente todo Postgres gerenciado exigem — sem isso, a conexão
// falha assim que o DATABASE_URL apontar pra fora da própria máquina.
// rejectUnauthorized: false é o padrão pra esses provedores (o
// certificado deles não costuma estar na cadeia de confiança padrão do
// Node, mesmo sendo uma conexão criptografada de verdade).
const isLocalDatabase = /localhost|127\.0\.0\.1/.test(env.databaseUrl);

export const pool = new Pool({
  connectionString: env.databaseUrl,
  ssl: isLocalDatabase ? undefined : { rejectUnauthorized: false },
});

export async function query<T = any>(text: string, params: any[] = []): Promise<T[]> {
  const { rows } = await pool.query(text, params);
  return rows as T[];
}
