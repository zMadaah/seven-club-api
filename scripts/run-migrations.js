// scripts/run-migrations.js
//
// Aplica as migrations em migrations/*.sql, em ordem, contra o banco
// definido em DATABASE_URL. Cada migration roda dentro de uma única
// transação junto com o registro em `_migrations`, então é impossível
// ela ficar marcada como aplicada sem ter executado de verdade
// (bug que já pegamos antes com a 003_users_profile.sql).

require('dotenv').config({ path: process.env.ENV_FILE || '.env.homolog' });

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL não definida. Configure o .env.homolog (veja .env.homolog.example).');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name        TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

async function getAppliedMigrations(client) {
  const { rows } = await client.query('SELECT name FROM _migrations');
  return new Set(rows.map((r) => r.name));
}

async function run() {
  const client = await pool.connect();

  try {
    await ensureMigrationsTable(client);
    const applied = await getAppliedMigrations(client);

    const dir = path.join(__dirname, '..', 'migrations');
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    console.log(`Encontradas ${files.length} migrations em migrations/.\n`);

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`- ${file} (já aplicada, pulando)`);
        continue;
      }

      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      process.stdout.write(`> Aplicando ${file}... `);

      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log('OK');
      } catch (err) {
        await client.query('ROLLBACK');
        console.log('FALHOU');
        console.error(`\nErro em ${file}:`, err.message);
        throw err;
      }
    }

    console.log('\nTodas as migrations pendentes foram aplicadas com sucesso.');
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error('\nMigração interrompida:', err.message);
  process.exit(1);
});
