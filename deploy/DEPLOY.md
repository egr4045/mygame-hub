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
`COMMUNITY_ADMIN_IDS` in `.env` once you know your own accountId (log in once, read it from the
`/auth/login` response, or the hub's "Скопировать мой ID"), then `docker compose up -d community` to
pick it up — until then, changelog reads work but nobody can publish.

`examplegame` (the SDK starter template, `apps/example-game`) is unlike every other service here: it
runs on **its own origin** (host port **5190**), same model as an on-demand game, so its bundle needs
`GAMEHUB_PUBLIC_URL` (set in `.env`, default `https://mygame-quiz.ru`) baked in **at build time** —
Vite can't read env vars at container runtime, only when `vite build` runs. `build-images.sh` reads
that value from `.env` and passes it as a Docker build arg. If `GAMEHUB_PUBLIC_URL` ever changes,
rebuild+recreate just that image: `bash build-images.sh && docker compose up -d --build examplegame`.

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
