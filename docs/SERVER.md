# Server infrastructure — READ THIS FIRST (humans & AI agents)

Server `186.246.11.239` (Ubuntu 24.04, 4 CPU, ~8 GB RAM). It runs **three independent products**.
Do not break one while touching another.

## 🟥 Golden rules
1. **Never touch the live Leaders (or projectflow)** unless explicitly asked. They are in production.
2. **Additive only**: new things get their own containers / ports / compose, never edit another
   product's.
3. **Docker builds must use `--network=host`** — this host resolves the npm registry to IPv6 and has
   no IPv6 route, so default-network builds fail. The host reaches the registry fine over IPv4.
4. In Dockerfiles install pnpm via `npm i -g pnpm` (corepack's downloader fails here) and set
   `NODE_OPTIONS=--dns-result-order=ipv4first`.
5. Public ports are **80/443 only** (Caddy), routed by hostname. Everything else is internal or
   behind a gateway.

## Product A — Leaders (live, do not disturb)
- Code: `/root/leaders` (its own git, its own `CLAUDE.md`).
- Runs as: `docker compose` (project `leaders`) → **caddy** (80/443), **livekit** (7881), **postgres**
  (127.0.0.1:5432), **redis** (127.0.0.1:6379); plus **`leaders.service`** (systemd) = NestJS on `:3000`.
- **Domain routing (verified live, `/root/leaders/deploy/Caddyfile`):** `mygame-quiz.ru` +
  `www.mygame-quiz.ru` → Leaders' Caddy → `/livekit/*` → livekit:7880; **everything else** →
  `host.docker.internal:8088` (i.e. straight to GAMEHUB's gateway, see Product B). This is the actual
  live config, read via SSH — it supersedes any older doc claiming `/api`/`/socket.io`/`/media` route
  to Leaders' own `:3000` here; whether/where Leaders' NestJS is otherwise reachable wasn't
  re-verified while writing this.

## Product B — GAMEHUB game platform (this repo)
- Repo: **github.com/egr4045/mygame-hub** at `/root/gamehub`. Update: `git -C /root/gamehub pull`.
  (An older, unrelated-history checkout used to live at `/root/civa`, cloned from a different repo —
  `leaders-2.git` — under the DEPLOY.md that predated the GAMEHUB rename. It was removed; `git pull`
  there was never going to work since the two repos share no history.)
- A multi-game platform: one **launcher** (login → pick game), identity + social (friends/presence) +
  chat (DMs/groups) + community (changelog/discussions), an **orchestrator** that starts a game on
  player entry and **stops it when idle** (to save RAM), and per-game stacks.
- **Always-on platform stack** (`deploy/gamehub`, project `gamehub`): `postgres` + `auth` (JWT) +
  `social` + `chat` + `community` + `orchestrator` + `livekit` (chat voice/video — own instance,
  separate from Leaders' own LiveKit below) + `web` (gateway Caddy, host port **8088**).
  Reachable directly at **http://186.246.11.239:8088**, and — the real public entry point — at
  **https://mygame-quiz.ru** (the root domain, no subdomain; Leaders' Caddy already forwards it here,
  see Product A above).
- **On-demand games** (started/stopped by the orchestrator; each registers a manifest entry +
  its own `deploy/<game>` compose):
  - CIVA lobby — `deploy/civa-game` (project `civa-game`). The game itself is still called CIVA;
    GAMEHUB is the platform's name, not any one game's. On the legacy per-port model, not path-routed
    — `status: 'maintenance'` in the hub's registry rather than shipping a Play button that would hit
    the http→https browser upgrade bug (see `docs/ARCHITECTURE.md`'s Hub section).
  - Своя игра (svoyak) — `deploy/svoyak` (project `svoyak`). Path-routed at `/svoyak/` (HTTPS,
    same-origin — required for `getUserMedia`, mic/cam); no published host port. Own repo, cloned
    during the image build.
  - Spellforge (cards) — `deploy/cards` (its own repo, `/root/cards` on this server, not in this
    monorepo). Path-routed at `/cards/`, own Socket.io path `/cards-io/*`.
- Networking: a shared external Docker network **`gamehub-net`**; the gateway routes one origin:
  `/auth/*`→auth, `/social.io/*`→social (Socket.io, custom path), `/chat.io/*`→chat (Socket.io, custom
  path), `/chat/call/token`→chat (HTTP, mints a LiveKit token), `/community/*`→community,
  `/orchestrator/*`→orchestrator, `/gamehub-livekit/*`→livekit (WebSocket signaling only — deliberately
  not `/livekit/*`, which Leaders' own Caddy already claims for its own instance), `/socket.io/*`→game
  lobby (Socket.io, default path — doesn't collide since social/chat moved off it), `/`→SPA.
- **LiveKit (voice/video calls)**: GAMEHUB's own self-hosted instance (`deploy/gamehub/livekit.yaml` +
  the `livekit` service), fully separate from Leaders' own (Product A, port 7881) — different API
  keys, different ports, never shared. Signaling is proxied through the gateway (above); the actual
  RTC media is UDP/TCP and can't go through Caddy, so it's published directly on the host: tcp 7883 +
  udp 51000-51100, verified free via `ss -tulpn` on this host before deploying (Leaders' own LiveKit
  already occupies tcp 7881 and the entire 50000-50200 udp range).
- Orchestrator controls Docker via the host socket; it `docker compose up/stop`s each game's compose.
  Idle policy: stop after `CIVA_IDLE_MS` (default 10 min) with zero players (polls each game `/metrics`).

### State & secrets (important)
- **Platform state is Postgres-backed** via a dedicated `postgres` container in `deploy/gamehub`
  (isolated from Leaders' own Postgres — different container, different network). `auth`, `social`,
  `chat` and `community` all point `DATABASE_URL` at it; a restart no longer wipes
  accounts/friends/invites/messages/achievements/playtime/changelog/discussions. Do **not** reuse
  Leaders' Postgres (127.0.0.1:5432) for the platform.
- **Secrets via env only, never committed.** Set per-container in `deploy/gamehub/.env`:
  - `JWT_SECRET` — shared secret for SSO; the **same** value must be set on every game that accepts
    the platform login (see `SSO-FEDERATION.md`), and on `auth`/`social`/`chat`/`community`/
    `orchestrator` alike (orchestrator verifies tokens too, for its admin force-stop route).
  - `JWT_ISSUER` — defaults to `gamehub` in every service if unset; must also match across all five
    services above, same reason as `JWT_SECRET` — `jose`'s issuer check is a hard reject on mismatch,
    so a partial rollout of a `JWT_ISSUER` change breaks cross-service token verification, not just
    client sessions. **Not** the same key as the Postgres credentials below, which are unrelated and
    still literally `civa` (see `docs/STATUS.md`'s recent-history note on the 2026-07-16 issuer rename).
  - `DATABASE_URL` — e.g. `postgres://civa:civa@postgres:5432/civa`; set identically on
    `auth`/`social`/`chat`/`community` (and `orchestrator`, read-only, just for the admin check) for
    durable state.
  - `AUTH_BOOTSTRAP_ADMIN_IDS` (on `auth`) — comma-separated accountIds to grant the platform's
    `is_admin` flag on boot (one-time; the account must already exist — log in once first). Gates
    everything in `apps/admin`, including changelog publishing. Every admin after this one is managed
    via `apps/admin` itself, not by editing this and restarting.
  - `OPS_ALERT_BOT_TOKEN` — same Telegram bot as `TELEGRAM_BOT_TOKEN` below (two env var names, one
    token: `auth` reads it as `TELEGRAM_BOT_TOKEN` since it owns account linking; `chat` and
    `community` read it as `OPS_ALERT_BOT_TOKEN` since they only ever *send* through it — disk-space
    alerts and new-suggestion pings). Whoever first DMs the bot `admin` becomes the alert recipient
    (persisted). **`auth` must be the only long-poller** — Telegram allows exactly one `getUpdates`
    consumer per token; `chat`/`community` never poll, only send. Keep the token out of git, logs, docs.
  - `LIVEKIT_URL`/`LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` (on `chat`) + `LIVEKIT_KEYS` (on `livekit`,
    same key/secret pair, `"apikey: apisecret"` format) — GAMEHUB's own LiveKit, generate the secret
    with `openssl rand -hex 32`. `LIVEKIT_URL` must be the public address
    (`wss://mygame-quiz.ru/gamehub-livekit`), not an internal docker-network one — it's handed
    straight to the browser's `livekit-client`.

### Deploy / update GAMEHUB
See **`/root/gamehub/deploy/DEPLOY.md`**. TL;DR:
```sh
git -C /root/gamehub pull
docker network create gamehub-net 2>/dev/null || true
cd /root/gamehub/deploy/gamehub && bash build-images.sh && docker compose up -d
```
Check on-demand: `curl -sXPOST localhost:8088/orchestrator/games/civa/enter` then `docker ps | grep civa-game`.

## Product C — projectflow (live, do not disturb)
- Runs as `docker compose` project `projectflow` → `projectflow-app-1`, `projectflow-db-1` (own
  Postgres). Unrelated to GAMEHUB/Leaders; leave its containers alone.

## Ports
| Port | Who | Public? |
|---|---|---|
| 80/443 | Leaders Caddy | yes |
| 3000 | Leaders NestJS | no (proxied) |
| 7881 | LiveKit | yes (rtc) |
| 5432 / 6379 | Leaders pg/redis | localhost |
| 8088 | GAMEHUB gateway (launcher) | yes (http, direct); also https://mygame-quiz.ru via Leaders' Caddy |
| 8081 / 8082 / 8090 | GAMEHUB auth / lobby / orchestrator | internal (gamehub-net) |
| 8083 / 8084 / 8085 | GAMEHUB social / chat / community | internal (gamehub-net) |
| 7880 | GAMEHUB's own LiveKit (signaling) | internal (gamehub-net) — proxied at /gamehub-livekit/* |
| 7883 (tcp) / 51000-51100 (udp) | GAMEHUB's own LiveKit (rtc media) | yes — verified free via `ss -tulpn`; Leaders already owns tcp 7881 + the whole 50000-50200 udp range |
| (projectflow ports) | projectflow app/db | see its own compose — not this repo's concern |

## Quick orientation for an agent
- This file is the map. The GAMEHUB repo's `docs/` has DESIGN.md (game), DEPLOY.md (ops),
  ARCHITECTURE.md (how the platform is put together), STATUS.md (real vs. mock, start there).
- Every service in `deploy/gamehub/docker-compose.yml` carries a `mem_limit`, added directly on the
  server — this host is shared with Leaders + projectflow, watch free RAM before raising one. Check
  `git status` there before assuming the repo and the running config match; ops changes have landed
  on the server uncommitted before (see `deploy/DEPLOY.md`'s history).
- To change GAMEHUB: edit in the repo, `git push`, then on the server `git pull` + redeploy (above).
- To check what's running: `docker ps`. Leaders containers are prefixed `leaders-`, GAMEHUB
  `gamehub-` (plus `civa-game-*` for the on-demand lobby), projectflow `projectflow-`.
