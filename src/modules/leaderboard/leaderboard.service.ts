import { query } from '../../db/pool';

export class LeaderboardError extends Error {}

export type LeaderboardScope = 'country' | 'area' | 'lobby' | 'crew';

function flagEmoji(countryCode: string | null): string {
  if (!countryCode || countryCode.length !== 2) return '';
  const codePoints = [...countryCode.toUpperCase()].map((c) => 127397 + c.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

// Monta o "pool" de concorrentes conforme o escopo. Os casos são SQL
// fixo (não vem de input do usuário), então interpolar aqui é seguro.
// "lobby" é o único que usa um terceiro parâmetro ($3, o lobbyId).
function poolCte(scope: LeaderboardScope): string {
  // "país" e "área" usam o MESMO pool (todo mundo do mesmo país) — a
  // diferença entre os dois não está em QUEM compete, está em QUAL
  // critério ranqueia (ver rankExpression mais abaixo: país por km
  // percorridos, área por hexágonos capturados). Área já tentou usar um
  // pool mais restrito, pareando por texto de localização do perfil —
  // removido porque esse campo nunca tinha um jeito confiável de ser
  // preenchido (não existe tela pra editar, e a captura automática via
  // GPS não se mostrou suficiente), deixando o ranking sempre vazio.
  if (scope === 'country' || scope === 'area') {
    return `pool AS (
      SELECT id FROM app_users
       WHERE status = 'active'
         AND country_code IS NOT NULL
         AND country_code = (SELECT country_code FROM app_users WHERE id = $1)
    )`;
  }

  if (scope === 'lobby') {
    return `pool AS (
      SELECT creator_id AS id FROM lobbies WHERE id = $3
      UNION
      SELECT user_id AS id FROM lobby_members WHERE lobby_id = $3
    )`;
  }

  throw new LeaderboardError(`Escopo desconhecido: ${scope}`);
}

interface LeaderboardRow {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  country_code: string | null;
  area_m2: string;
  cells_owned: string;
  distance_km: string;
  rank: string;
}

export async function getLeaderboard(
  userId: string,
  scope: LeaderboardScope,
  activityType: 'run' | 'ride',
  lobbyId?: string,
  gender?: 'Masculino' | 'Feminino'
) {
  if (scope === 'lobby') {
    if (!lobbyId) throw new LeaderboardError('Escopo "lobby" exige lobbyId.');

    // só quem faz parte do lobby (dono ou membro) pode ver esse ranking —
    // é um espaço privado, não vale expor pra quem não está dentro
    const membership = await query(
      `SELECT 1 FROM lobbies WHERE id = $1 AND creator_id = $2
       UNION
       SELECT 1 FROM lobby_members WHERE lobby_id = $1 AND user_id = $2`,
      [lobbyId, userId]
    );
    if (membership.length === 0) {
      throw new LeaderboardError('Você não faz parte desse lobby.');
    }
  }

  const params: (string | undefined)[] = [userId, activityType];
  if (scope === 'lobby') params.push(lobbyId);

  // Filtro de gênero é opcional e sempre o ÚLTIMO parâmetro da lista —
  // isso evita ter que recalcular os índices ($3, $4...) dos outros
  // parâmetros conforme o escopo muda. Só faz sentido pra país/área
  // (ranking entre indivíduos); "crew"/"lobby" competem em grupo, não
  // tem gênero de crew.
  let genderFilter = '';
  if (gender && (scope === 'country' || scope === 'area')) {
    params.push(gender);
    genderFilter = `AND u.gender = $${params.length}`;
  }

  // Cada escopo ranqueia por um critério diferente, de propósito:
  // - "país": só km percorridos. A primeira versão somava território
  //   (km²) com distância (km) como se fossem a mesma unidade — na
  //   prática, alguém com pouquíssima distância mas muito território
  //   ficava na frente de quem correu bem mais, o que não fazia
  //   sentido pra um ranking pensado em "quem mais se movimentou".
  // - "área": contagem de hexágonos capturados — mais direto de
  //   entender que km² fracionado, e é a mecânica central do jogo
  //   (capturar território). Pode não ser a palavra final (ainda
  //   estamos validando essa lógica), mas é mais claro que km² por
  //   enquanto.
  const rankExpression = scope === 'country' ? 'distance_km' : 'cells_owned';

  const rows = await query<LeaderboardRow>(
    `WITH ${poolCte(scope)},
     totals AS (
       SELECT u.id AS user_id, u.display_name, u.avatar_url, u.country_code,
              COALESCE(SUM(tc.cell_area_m2), 0) AS area_m2,
              COUNT(tc.h3_index) AS cells_owned,
              COALESCE(
                (SELECT SUM(a.distance_meters) / 1000.0
                   FROM activities a
                  WHERE a.user_id = u.id AND a.activity_type = $2),
                0
              ) AS distance_km
         FROM pool p
         JOIN app_users u ON u.id = p.id ${genderFilter}
         LEFT JOIN territory_cells tc
           ON tc.owner_user_id = u.id AND tc.activity_type = $2
        GROUP BY u.id, u.display_name, u.avatar_url, u.country_code
     )
     SELECT user_id, display_name, avatar_url, country_code, area_m2, cells_owned, distance_km,
            RANK() OVER (ORDER BY ${rankExpression} DESC) AS rank
       FROM totals
      ORDER BY ${rankExpression} DESC
      LIMIT 500`,
    params
  );

  const mapped = rows.map((r) => ({
    id: r.user_id,
    rank: Number(r.rank),
    name: r.display_name,
    avatarUrl: r.avatar_url ?? '',
    countryFlag: flagEmoji(r.country_code),
    countryCode: r.country_code ?? '',
    territoryKm2: Number(r.area_m2) / 1_000_000,
    cellsOwned: Number(r.cells_owned),
    distanceKm: Number(r.distance_km),
    activityType,
  }));

  // "seu rank" nunca faz parte da lista de concorrentes — é separado
  const myRank = mapped.find((e) => e.id === userId) ?? null;
  const entries = mapped.filter((e) => e.id !== userId).slice(0, 50);

  return { entries, myRank };
}

interface CrewLeaderboardRow {
  crew_id: string;
  crew_name: string;
  crew_picture_url: string | null;
  area_m2: string;
  cells_owned: string;
  distance_km: string;
  rank: string;
}

// Diferente dos outros escopos (que ranqueiam INDIVÍDUOS dentro de um
// pool), aqui quem compete é o CREW — o território "dele" é a soma do
// território de todos os membros (criador + crew_members). Usa CTEs
// separadas pra território e distância antes de juntar, pra não sofrer
// "fan-out" (multiplicar linhas) se desse um JOIN triplo direto entre
// membros + território + atividades ao mesmo tempo.
export async function getCrewLeaderboard(userId: string, activityType: 'run' | 'ride') {
  const rows = await query<CrewLeaderboardRow>(
    `WITH crew_all_members AS (
       SELECT id AS crew_id, creator_id AS user_id FROM crews
       UNION
       SELECT crew_id, user_id FROM crew_members
     ),
     member_territory AS (
       SELECT cam.crew_id, COALESCE(SUM(tc.cell_area_m2), 0) AS area_m2,
              COUNT(tc.h3_index) AS cells_owned
         FROM crew_all_members cam
         LEFT JOIN territory_cells tc ON tc.owner_user_id = cam.user_id AND tc.activity_type = $1
        GROUP BY cam.crew_id
     ),
     member_distance AS (
       SELECT cam.crew_id, COALESCE(SUM(a.distance_meters), 0) / 1000.0 AS distance_km
         FROM crew_all_members cam
         LEFT JOIN activities a ON a.user_id = cam.user_id AND a.activity_type = $1
        GROUP BY cam.crew_id
     )
     SELECT c.id AS crew_id, c.name AS crew_name, c.picture_url AS crew_picture_url,
            COALESCE(mt.area_m2, 0) AS area_m2,
            COALESCE(mt.cells_owned, 0) AS cells_owned,
            COALESCE(md.distance_km, 0) AS distance_km,
            RANK() OVER (ORDER BY COALESCE(mt.area_m2, 0) DESC) AS rank
       FROM crews c
       LEFT JOIN member_territory mt ON mt.crew_id = c.id
       LEFT JOIN member_distance md ON md.crew_id = c.id
      ORDER BY area_m2 DESC
      LIMIT 500`,
    [activityType]
  );

  const mapped = rows.map((r) => ({
    id: r.crew_id,
    rank: Number(r.rank),
    name: r.crew_name,
    avatarUrl: r.crew_picture_url ?? '',
    countryFlag: '',
    countryCode: '',
    territoryKm2: Number(r.area_m2) / 1_000_000,
    cellsOwned: Number(r.cells_owned),
    distanceKm: Number(r.distance_km),
    activityType,
  }));

  // Qual crew é "o seu" pra fins de myRank — se estiver em mais de um,
  // usa o mais antigo (o primeiro que criou/entrou). O app hoje só
  // suporta um "crew ativo" por vez no cliente mesmo.
  const myCrewRows = await query<{ crew_id: string }>(
    `SELECT id AS crew_id FROM crews WHERE creator_id = $1
     UNION
     SELECT crew_id FROM crew_members WHERE user_id = $1
     ORDER BY crew_id
     LIMIT 1`,
    [userId]
  );

  const myCrewId = myCrewRows[0]?.crew_id;
  const myRankEntry = myCrewId ? mapped.find((e) => e.id === myCrewId) ?? null : null;
  const entriesOnly = myCrewId ? mapped.filter((e) => e.id !== myCrewId) : mapped;

  return { entries: entriesOnly.slice(0, 50), myRank: myRankEntry };
}
