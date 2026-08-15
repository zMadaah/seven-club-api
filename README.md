# Seven Club — API (núcleo)

Backend real por trás do app (`https://github.com/zMadaah/SevenClub`), construído
a partir da leitura direta do código do app — tipos em `src/types/`, mocks em
`src/services/mock/` e a lógica de captura que hoje roda só localmente em
`src/utils/geo.ts` / `ActivityStart/index.tsx`.

Escopo desta entrega ("núcleo"): **auth real com cadastro verificado por SMS,
activities, territory (H3), stats, saved routes, rate limiting**. Camada
social (crew, lobby, feed, rivals, leaderboard, badges, seasons) e
notificações/privacidade ficam para as próximas fases.

## Setup

1. O banco `sevenclub_homolog` precisa existir (`scripts/create-homolog-db.ps1`).
2. Copie `.env.example` para `.env` e preencha `DATABASE_URL` e `JWT_ACCESS_SECRET`.
3. Copie `.env.example` também para `.env.homolog` (usado só pelo script de
   migration) com a mesma `DATABASE_URL`.
4. Instale as dependências e rode as migrations (001 a 013):

   ```powershell
   npm install
   npm run migrate:homolog
   ```

5. Suba a API em modo dev:

   ```powershell
   npm run dev
   ```

   Por padrão sobe em `http://localhost:3333`. `GET /health` deve responder
   `{ "status": "ok" }`.

## Cadastro em 3 etapas (nome/email/celular → código → senha)

O cadastro deixou de ser um passo único. Agora:

1. **`POST /auth/signup/start`** — recebe `name`, `email`, `phone`. Cria um
   registro pendente em `signup_verifications` (a conta **não** é criada
   ainda em `app_users`) e gera um código de 6 dígitos.
2. **`POST /auth/signup/verify-code`** — recebe `signupId` e `code`. Até 5
   tentativas erradas por cadastro; código expira em 10 minutos.
3. **`POST /auth/signup/set-password`** — recebe `signupId` e `password`.
   Só aqui a conta é criada de verdade em `app_users`, já com
   `phone_verified = true`. Devolve `accessToken`/`refreshToken` — a pessoa
   termina o cadastro logada.

A rota antiga `POST /auth/register` (um passo só, sem verificar celular) foi
**removida** — ela permitia criar conta sem validar nada, o que não faz
sentido tendo esse fluxo novo ao lado.

### Verificação por SMS

Não tem gateway de SMS integrado ainda — isso é uma decisão de fornecedor
(Zenvia, Twilio, AWS SNS...) que não é técnica, é de custo/contrato, então
não escolhi por você. O código está pronto para plugar: é só substituir o
`TODO` em `src/modules/auth/signup.service.ts` (função `startSignup`) pela
chamada real ao provedor escolhido.

Enquanto isso, em qualquer ambiente com `NODE_ENV` diferente de
`production`, a resposta de `/auth/signup/start` já devolve o código no
campo `devCode`, pra dar pra testar o fluxo inteiro sem SMS de verdade.
**Antes de ir pra produção, `NODE_ENV=production` precisa estar setado** —
sem isso, o código de verificação vaza na resposta da API.

## Rate limiting

Adicionei `@fastify/rate-limit` — dois níveis:

- **Global**: 100 requisições/minuto por IP, em toda a API. É o teto de
  segurança contra a API cair sob carga (pico de lançamento, bug de retry
  no app, ataque simples).
- **Por rota, nas mais sensíveis** (somam ao limite global, não substituem):

  | Rota | Limite | Por quê |
  |---|---|---|
  | `POST /auth/signup/start` | 5 / 15 min por IP | cada chamada pode disparar um SMS de verdade (custo) |
  | `POST /auth/signup/resend` | 5 / 15 min por IP | idem, mais cooldown de 60s no mesmo cadastro |
  | `POST /auth/signup/verify-code` | 15 / 15 min por IP | é uma tentativa de adivinhar um código de 6 dígitos |
  | `POST /auth/signup/set-password` | 10 / 15 min por IP | fecha a conta |
  | `POST /auth/password-reset/start` | 5 / 15 min por IP | idem ao signup/start |
  | `POST /auth/password-reset/resend` | 5 / 15 min por IP | idem ao signup/resend |
  | `POST /auth/password-reset/verify-code` | 15 / 15 min por IP | idem ao signup/verify-code |
  | `POST /auth/password-reset/complete` | 10 / 15 min por IP | troca a senha da conta |
  | `POST /auth/login` | 10 / 1 min por IP | alvo clássico de força bruta |
  | `POST /auth/refresh` | 20 / 1 min por IP | folga pra uso legítimo, ainda limitado |

Além do limite por IP, `startSignup` também bloqueia pedidos repetidos pro
mesmo **celular** em menos de 60 segundos — cobre o caso de alguém trocar de
IP mas continuar mirando o mesmo número (evita SMS bombing).

**Importante pro deploy**: o Fastify está com `trustProxy: true`, porque em
produção a API roda atrás do proxy do Render — sem isso, o rate limit
enxergaria o IP do proxy (igual pra todo mundo) em vez do IP real de cada
cliente, e o limite por IP viraria, na prática, um limite global.

O rate limit hoje é em memória (por instância). Isso é suficiente pro Render
free tier (uma instância só). Se algum dia escalar pra múltiplas instâncias,
`@fastify/rate-limit` suporta um store compartilhado via Redis — não
implementei isso agora porque seria complexidade sem necessidade real no
estágio atual.

## O motor de captura de território

Hoje o app calcula a área capturada **localmente**, com um polígono simples
(`polygonArea()` em `src/utils/geo.ts` do app) — sem grid, sem disputa entre
usuários, sem persistência. É só um placeholder visual.

O backend substitui isso por captura de verdade:

1. Recebe o loop de GPS (`POST /activities`).
2. Recalcula distância e "loop fechado" no servidor (não confia no app).
3. Se o loop está fechado, converte o polígono em células H3 (resolução 10,
   `h3.polygonToCells`).
4. Pra cada célula: se já é sua, ignora; se é de outro usuário ou de
   ninguém, você captura (e isso é registrado como "steal" se tinha dono).
5. Devolve `captureM2` = soma da área das células realmente capturadas
   nessa atividade.

Território é um **grid independente por `run`/`ride`** (confirmado lendo os
mocks do app — `MOCK_TERRITORIES`, `MOCK_COUNTRY_POOL` etc. são todos
`Record<ActivityType, ...>`).

## Recuperação de senha

Mesmo padrão do cadastro (código de 6 dígitos), mas pra quem já tem conta:

1. **`POST /auth/password-reset/start`** — recebe `method` (`email` ou
   `phone`) e `contact`. A resposta é **sempre a mesma**, exista ou não uma
   conta com esse contato — isso evita que a rota vire uma forma de
   descobrir quais e-mails/celulares têm cadastro. Sem conta encontrada,
   nenhum código é enviado, mas a API responde igual.
2. **`POST /auth/password-reset/verify-code`** — mesmo padrão do cadastro.
3. **`POST /auth/password-reset/complete`** — define a senha nova e
   **revoga todas as sessões existentes** do usuário (proteção padrão pra
   caso a senha antiga tenha vazado). Não devolve tokens — a pessoa faz
   login de novo com a senha nova.

`POST /auth/signup/resend` e `POST /auth/password-reset/resend` reenviam o
código pro mesmo cadastro/pedido pendente (cooldown de 60s entre reenvios).

## Endpoints

| Método | Rota | Autenticado | Descrição |
|---|---|---|---|
| `POST` | `/auth/signup/start` | não | Etapa 1 do cadastro (name, email, phone) |
| `POST` | `/auth/signup/resend` | não | Reenvia o código do cadastro pendente |
| `POST` | `/auth/signup/verify-code` | não | Etapa 2 (signupId, code) |
| `POST` | `/auth/signup/set-password` | não | Etapa 3 (signupId, password) — devolve tokens |
| `POST` | `/auth/password-reset/start` | não | Pede recuperação (method, contact) |
| `POST` | `/auth/password-reset/resend` | não | Reenvia o código de recuperação |
| `POST` | `/auth/password-reset/verify-code` | não | Valida o código (resetId, code) |
| `POST` | `/auth/password-reset/complete` | não | Define a nova senha, derruba sessões antigas |
| `POST` | `/auth/login` | não | Login (email, password) |
| `POST` | `/auth/refresh` | não | Troca um refresh token válido por um novo par |
| `POST` | `/auth/logout` | não | Revoga o refresh token |
| `GET` | `/auth/me` | sim | Perfil do usuário autenticado |
| `POST` | `/activities` | sim | Registra uma atividade finalizada e dispara a captura |
| `GET` | `/activities` | sim | Lista as atividades do usuário |
| `GET` | `/activities/:id` | sim | Detalhe de uma atividade (com trajetória) |
| `GET` | `/territory?activityType=run\|ride` | sim | Atividades com captura, formato `TerritoryEntry`-lite |
| `GET` | `/stats/me?activityType=run\|ride` | sim | `ActivityStats`: território atual, rank, roubos |
| `POST` | `/routes` | sim | Salva uma rota planejada, com estimativa de captura |
| `GET` | `/routes` | sim | Lista rotas salvas |
| `DELETE` | `/routes/:id` | sim | Remove uma rota salva |

Rotas autenticadas exigem `Authorization: Bearer <accessToken>`.

## Coleção do Insomnia

`insomnia/seven-club.insomnia.json` — importe em **Insomnia → Create → Import
From File**. Traz 21 requisições organizadas em 8 pastas (Sistema, Auth —
Cadastro, Auth — Recuperação de senha, Auth — Sessão, Activities, Territory,
Stats, Saved Routes) e um ambiente "Homologação (local)" com `base_url` já
apontando pro `localhost:3333`.

Como as respostas não se auto-propagam (isso é uma limitação conhecida do
Insomnia, já vimos isso antes com outro projeto), o fluxo é manual:

1. Rode **1. Cadastro** → copie `signupId` e `devCode` da resposta para as
   variáveis de ambiente `signup_id` e `dev_code` (aba Environment, canto
   superior direito).
2. Rode **2. Validar código** e **3. Criar senha** → copie `accessToken` e
   `refreshToken` da resposta de "3. Criar senha" para `access_token` e
   `refresh_token`.
3. A partir daí, todas as rotas autenticadas (Activities, Territory, Stats,
   Saved Routes) já usam `{{ access_token }}` automaticamente.

## O que ainda falta pro app (fora do escopo desta entrega)

- **`TerritoryEntry` completo**: `rankInGroup`, `countryRank`, `globalRank`,
  `avgSpeedKmh`, `maxSpeedKmh`, `elevationGainM/LossM`, `speedSamples`,
  `elevationSamples`, `likes`, `comments`. Elevação e velocidade por ponto
  exigem capturar altitude no `useActivityTracker` do app (hoje só pega
  `latitude`/`longitude`) — isso é mudança no app, não só no backend. Likes/
  comentários dependem do módulo social (feed/comment).
- **Camada social**: `crew`, `lobby` + `lobbyChat` (provavelmente precisa de
  WebSocket pro chat/presença em tempo real), `feed`/`post`/`comment`,
  `rivals`, `leaderboard`, `badge` + `season`.
- **Conta**: `notification` + `notificationPreference`, `privacySettings`
  (bloqueios/visibilidade). `preference.ts` (`UnitSystem`) não precisa de
  backend — dá pra manter só como estado local do app.
- **Gateway de SMS de verdade** — ver seção "Verificação por SMS" acima.
- **`AuthContext` do app**: ainda é só um toggle (`login()` sem parâmetros).
  Quando formos ligar o app de verdade, essa parte precisa ser reescrita pra
  chamar `/auth/login` (ou o fluxo de signup) de fato e guardar os tokens
  (sugiro `expo-secure-store` pro refresh token).

## Próximos passos sugeridos

1. Escolher o provedor de SMS e plugar em `signup.service.ts`.
2. Reescrever o `AuthContext` do app pra usar `/auth/*` de verdade.
3. Trocar `useActivityTracker`/`ActivityStart` pra chamar `POST /activities`
   no lugar do cálculo local, e exibir o `captureM2` que a API devolve.
4. A partir daí, decidir a ordem da camada social.
