# Deploying GAMEHUB next to the existing Leaders (one server)

The server (186.246.11.239, Ubuntu 24.04) already runs **Leaders**: a `docker compose` stack
(Caddy on 80/443, LiveKit, Postgres, Redis) plus the NestJS `leaders.service` on :3000, and a
separate `projectflow` stack. Caddy serves `mygame-quiz.ru`. **We add GAMEHUB additively and never
touch the running Leaders or projectflow.**

GAMEHUB ships as two compose stacks sharing a `gamehub-net` network:
- **Platform** (`deploy/gamehub`, always-on): `postgres` + `auth` + `social` + `chat` + `community` +
  `orchestrator` + the gateway Caddy (`web`, host port **8088**). The gateway fronts the SPA, auth,
  social/chat (Socket.io), community, the orchestrator, and the on-demand lobby.
- **Game** (`deploy/civa-game`, on-demand): `lobby`. The orchestrator starts it on player entry and
  stops it after 10 min idle. The host (Leaders) Caddy already forwards the **root domain**
  `mygame-quiz.ru` (everything except `/livekit/*`) straight to :8088 — no subdomain, no separate DNS
  entry. The game running there is still called CIVA; GAMEHUB is the name of the platform around it
  (the source repo is `mygame-hub`).

## 1. Get the code on the server

```sh
git clone https://github.com/egr4045/mygame-hub.git /root/gamehub
cd /root/gamehub && git checkout refactor/hub-split   # or whatever branch is current
# updating later: git -C /root/gamehub pull
```

> If `/root/civa` already exists from an older deploy (a different, unrelated repo history —
> `leaders-2.git`), stop its stack and remove it first: `cd /root/civa/deploy/civa && docker compose
> down; cd / && rm -rf /root/civa`. It shares no git history with `mygame-hub`, so `git pull` there
> was never going to work — this is a fresh clone under a new path, not an update in place.

## 2. Build & start the platform

```sh
docker network create gamehub-net 2>/dev/null || true
cd /root/gamehub/deploy/gamehub
SECRET=$(openssl rand -hex 32)
cp .env.example .env;           sed -i "s/change-me-to-a-long-random-string/$SECRET/" .env
cp ../civa-game/.env.example ../civa-game/.env
sed -i "s/change-me-to-a-long-random-string/$SECRET/" ../civa-game/.env   # SAME secret
bash build-images.sh            # builds service/web/orchestrator with --network=host (IPv4 registry)
docker compose up -d            # postgres + auth + social + chat + community + orchestrator + web
docker compose ps
```

> Why the build script? On this host the npm registry resolves to IPv6 (no IPv6 route) inside the
> default Docker build network, so the build must use `--network=host` (the host reaches the
> registry over IPv4).

`auth`/`social`/`chat`/`community` are Postgres-backed from the start (a dedicated `postgres`
container in this stack, isolated from Leaders' own Postgres) — data survives a restart. Set
`AUTH_BOOTSTRAP_ADMIN_IDS` in `.env` once you know your own accountId (log in once, read it from the
`/auth/login` response, or the hub's "Скопировать мой ID"), then `docker compose up -d auth` to pick
it up — this grants `apps/admin` access (including changelog publishing); every admin after this one
is promoted from within `apps/admin` itself, not by editing `.env` again.

`examplegame` (the SDK starter template, `apps/example-game`) is path-routed under the hub's own
origin (`mygame-quiz.ru/example-game/`), not its own port — same model as `admin` below. No host port
is published; Caddy's `handle_path /example-game/*` strips the prefix and proxies to `examplegame:5190`
internally. Vite can't read env vars at container runtime, so the `/example-game/` prefix is baked
into the bundle **at build time** via the `VITE_BASE_PATH` build arg (`build-images.sh` passes it,
must match the Caddyfile's path exactly). If that prefix ever changes, rebuild+recreate just that
image: `bash build-images.sh && docker compose up -d --build examplegame`.

`admin` (`apps/admin`, the ops panel) is path-routed under the same origin (`mygame-quiz.ru/admin/`,
no published port) — same model as `/example-game/`'s Caddy `handle_path`. It reuses the normal
register/login flow every player uses; access is gated server-side by `is_admin` (see
`AUTH_BOOTSTRAP_ADMIN_IDS` above), not by anything client-side.

The orchestrator brings the lobby up on the first `enter`. To check on-demand + idle:

```sh
curl -s -XPOST localhost:8088/orchestrator/games/civa/enter   # -> {"ready":true}; lobby starts
docker ps --format '{{.Names}}' | grep civa-game              # lobby now running
# ...with nobody connected for 10 min, the reaper stops it (watch: docker logs gamehub-orchestrator-1)
```

Verify on the server (bypasses Leaders' Caddy/TLS, checks GAMEHUB's own gateway directly):

```sh
curl -s localhost:8088/ | head -c 80                       # SPA html
curl -s -XPOST localhost:8088/auth/login \
  -H 'content-type: application/json' -d '{"displayName":"smoke"}' | head -c 120   # JWT json
curl -s localhost:8088/community/changelog/civa             # {"entries":[]}
```

Verify end-to-end through the real domain (from anywhere):

```sh
curl -s https://mygame-quiz.ru/ | head -c 80
curl -s -XPOST https://mygame-quiz.ru/auth/login \
  -H 'content-type: application/json' -d '{"displayName":"smoke"}' | head -c 120
```

## 3. The public entry point — already live, nothing to do

There is **no GAMEHUB subdomain** — none is needed, and none should be created. The Leaders Caddyfile
(`/root/leaders/deploy/Caddyfile`) already has a block forwarding the **root domain**
(`mygame-quiz.ru`, `www.mygame-quiz.ru`) straight to `host.docker.internal:8088` (i.e. this stack's
`web` gateway) for everything except `/livekit/*` (LiveKit stays with Leaders). TLS is already
provisioned for that domain. **GAMEHUB is reached at https://mygame-quiz.ru** — the same domain
Leaders itself used to answer on directly.

A verbatim copy of that live block is kept at `deploy/gamehub/leaders-caddy-reference.snippet` purely
as a disaster-recovery reference (e.g. if `/root/leaders/deploy/Caddyfile` is ever rebuilt from
scratch and needs re-populating) — do not re-apply it if the block is already there.

> Games get a path under this same domain going forward (e.g. `mygame-quiz.ru/civa`), not their own
> subdomain — see `docs/PLAN.md`. That's a separate, not-yet-started piece of work (Caddy per-game
> path routes + each game's SPA base path + the hub's launch/handoff code, which currently addresses a
> game by port, not path).

## Updating

```sh
git -C /root/gamehub pull && cd /root/gamehub/deploy/gamehub && docker compose up -d --build
```

## Rollback (GAMEHUB only — Leaders/projectflow untouched)

```sh
cd /root/gamehub/deploy/gamehub && docker compose down
```

Nothing to undo on the Leaders side — its Caddyfile forwarding `mygame-quiz.ru` to `:8088` predates
this stack and isn't touched by deploying/rolling back GAMEHUB. `docker compose down` alone just
means that domain 502s until GAMEHUB is brought back up.

## Notes
- Resource use: auth/social/chat/community are tiny Node processes; the web is static; `postgres` is
  the heaviest addition. Watch free RAM on this box (shared with Leaders + projectflow).
- `social`/`chat` run their Socket.io servers on custom paths (`/social.io/`, `/chat.io/`), not the
  default `/socket.io/` — that path is reserved for the game lobby's own socket, on the same shared
  origin (see `docs/ARCHITECTURE.md`).
- JWT issuer (`civa`) and the SDK's `localStorage` keys (`civa.session`) are unchanged by the
  GAMEHUB rename — deliberately: renaming those would invalidate every existing session/token
  cross-game, which wasn't asked for. Only the deploy path/repo/image names moved.

## Spellforge (cards) — карточная игра

Отдельный репозиторий (не в этом монорепо), on-demand стек по образцу `deploy/civa-game`. Первый
деплой:

```sh
# 1) Код игры на сервер (путь /root/cards зашит в манифест оркестратора и его volume-маунт).
git clone <cards-repo-url> /root/cards

# 2) Секреты и образы игры.
cd /root/cards/deploy && cp .env.example .env   # выставить CARDS_JWT_SECRET и CARDS_PG_PASSWORD
bash build-images.sh

# 3) Обновлённая платформа (Caddyfile получил /cards-io/* и /cards/*; оркестратор — манифест cards).
git -C /root/gamehub pull
cd /root/gamehub/deploy/gamehub && docker compose up -d --build web orchestrator

# 4) Smoke.
curl -s -X POST localhost:8088/orchestrator/games/cards/enter   # {"ready":true} — стек поднялся
docker ps | grep cards-                                         # cards-postgres/server/web живы
curl -s localhost:8088/cards/ | head -c 60                      # SPA отдаётся
```

Обновление игры: `git -C /root/cards pull && bash /root/cards/deploy/build-images.sh && cd
/root/cards/deploy && docker compose up -d`. Оркестратор гасит стек после 10 минут без игроков
(`/cards-io/`-сокеты считаются через `GET /metrics` на `cards-server:8091`); данные Postgres
переживают stop/start на named volume `cards-postgres-data`.

## Своя игра (Svoyak) — квиз-баззер

Отдельный репозиторий (не в этом монорепо, `deploy/svoyak/Dockerfile` клонирует его при сборке
образа). Раздаётся по HTTPS через шлюз хаба на `https://mygame-quiz.ru/svoyak/` (**secure context**,
нужен для `getUserMedia` — голос/камера в игре) — прямой `http://<host>:8089` остаётся только как
dev-фолбэк (`ports: '8089:8089'` в `deploy/svoyak/docker-compose.yml`).

Три части этой маршрутизации должны катиться **вместе** (иначе ассеты с префиксом `/svoyak/*` 404):
Caddyfile-роут (`handle_path /svoyak/*`), сборка Свояка с `VITE_BASE_PATH=/svoyak/`, и
`apps/hub/src/platform/games.ts`'s `path: 'svoyak'`. Первый деплой:

```sh
# 1) Секреты и образ игры (тот же JWT_SECRET, что у платформы — см. deploy/gamehub/.env).
cd /root/gamehub/deploy/svoyak && cp .env.example .env
PLATFORM_SECRET=$(grep ^JWT_SECRET= ../gamehub/.env | cut -d= -f2)
sed -i "s/change-me-to-a-long-random-string/$PLATFORM_SECRET/" .env

# --no-cache: Dockerfile git-clone'ит репозиторий Свояка внутри сборки — без этого флага
# образ пересоберётся со СТАРЫМ кодом игры из кэша слоя git clone.
docker build --network=host --no-cache -t svoyak:latest .

# 2) Платформа уже несёт Caddy-роут /svoyak/* и path:'svoyak' в реестре — просто поднять оба стека.
cd /root/gamehub/deploy/gamehub && docker compose up -d web
cd /root/gamehub/deploy/svoyak && docker compose up -d --force-recreate

# 3) Smoke — стек on-demand, будим оркестратором.
curl -s -X POST localhost:8088/orchestrator/games/svoyak/enter        # {"ready":true}
curl -s localhost:8088/svoyak/ | grep -o "/svoyak/assets/[^\"']*"     # ассеты с правильным префиксом
curl -s -o /dev/null -w "%{http_code}" localhost:8088/svoyak/vendor/mygame-sdk.global.js   # 200
```

Обновление игры: пересобрать образ (`--no-cache`, шаг 1 выше) и
`docker compose up -d --force-recreate` в `deploy/svoyak`. Оркестратор гасит стек после 10 минут без
игроков (`GET /metrics` на `svoyak:8089`, путь пробы не меняется base-путём — он живёт в корне).
