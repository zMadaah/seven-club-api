import { query } from '../../db/pool';

interface SeasonRow {
  id: string;
  number: number;
  name: string;
  starts_at: string;
  ends_at: string;
}

// Temporada "atual" = a que contém a data de hoje; se nenhuma bater (ex:
// atraso em cadastrar a próxima), cai pra mais recente que já começou —
// nunca deixa a função em branco.
export async function getCurrentSeason() {
  const active = await query<SeasonRow>(
    `SELECT id, number, name, starts_at, ends_at
       FROM seasons
      WHERE now() BETWEEN starts_at AND ends_at
      ORDER BY starts_at DESC
      LIMIT 1`
  );
  if (active.length > 0) return active[0];

  const fallback = await query<SeasonRow>(
    `SELECT id, number, name, starts_at, ends_at
       FROM seasons
      WHERE starts_at <= now()
      ORDER BY starts_at DESC
      LIMIT 1`
  );
  return fallback[0] ?? null;
}
