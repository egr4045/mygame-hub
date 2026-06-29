# Server infrastructure — READ THIS FIRST (humans & AI agents)

Server `186.246.11.239` (Ubuntu 24.04, 4 CPU, ~8 GB RAM). It runs **two independent products**.
Do not break one while touching the other.

## 🟥 Golden rules
1. **Never touch the live Leaders** unless explicitly asked. It is in production.
2. **Additive only**: new things get their own containers / ports / compose, never edit Leaders'.
3. **Docker builds must use `--network=host`** — this host resolves the npm registry to IPv6 and has
   no IPv6 route, so default-network builds fail. The host reaches the registry fine over IPv4.
4. In Dockerfiles install pnpm via `npm i -g pnpm` (corepack's downloader fails here) and set
   `NODE_OPTIONS=--dns-result-order=ipv4first`.
5. Public ports are **80/443 only** (Caddy). Everything else is internal or behind the gateway.

## Product A — Leaders (live, do not disturb)
- Code: `/root/leaders` (its own git, its own `CLAUDE.md`).
- Runs as: `docker compose` (project `leaders`) → **caddy** (80/443), **livekit** (7881), **postgres**
  (127.0.0.1:5432), **redis** (127.0.0.1:6379); plus **`leaders.service`** (systemd) = NestJS on `:3000`.
- Domain: **mygame-quiz.ru** → Caddy → static SPA + proxy `/api`,`/socket.io`,`/media`→:3000, `/livekit`→livekit.

## Product B — CIVA game platform (this repo)
- Repo: **github.com/egr4045/leaders-2** at `/root/civa`. Update: `git -C /root/civa pull`.
- A multi-game platform: one **launcher** (login → pick game), an **orchestrator** that starts a game
  on player entry and **stops it when idle** (to save RAM), and per-game stacks.
- **Always-on platform stack** (`deploy/civa`, project `civa`): `auth` (JWT) + `orchestrator` +
  `web` (gateway Caddy, host port **8088**). Entry point: **http://186.246.11.239:8088**.
- **On-demand games** (started/stopped by the orchestrator):
  - CIVA lobby — `deploy/civa-game` (project `civa-game`).
  - (more games register in the orchestrator manifest + their own `deploy/<game>` compose).
- Networking: a shared external Docker network **`civa-net`**; the gateway routes one origin:
  `/auth/*`→auth, `/orchestrator/*`→orchestrator, `/socket.io/*`→game lobby, `/`→SPA.
- Orchestrator controls Docker via the host socket; it `docker compose up/stop`s each game's compose.
  Idle policy: stop after `CIVA_IDLE_MS` (default 10 min) with zero players (polls each game `/metrics`).

### State & secrets (important)
- **Platform state is in-memory.** `auth`, `social` and invites use in-memory stores — restarting a
  platform container **wipes accounts, friends and invites**. Postgres adapters are the planned fix
  (see `STATUS.md`). The Leaders Postgres (127.0.0.1:5432) is Leaders-only; do not reuse it for the
  platform without an explicit decision.
- **Secrets via env only, never committed.** Set per-container in the deploy `.env`:
  - `JWT_SECRET` — shared secret for SSO; the **same** value must be set on every game that accepts
    the platform login (see `SSO-FEDERATION.md`).
  - `TELEGRAM_BOT_TOKEN` — the Telegram bot token for account linking (when that feature lands).
    Keep it out of git, logs and docs.

### Deploy / update CIVA
See **`/root/civa/deploy/DEPLOY.md`**. TL;DR:
```sh
git -C /root/civa pull
docker network create civa-net 2>/dev/null || true
cd /root/civa/deploy/civa && bash build-images.sh && docker compose up -d
```
Check on-demand: `curl -sXPOST localhost:8088/orchestrator/games/civa/enter` then `docker ps | grep civa-game`.

## Ports
| Port | Who | Public? |
|---|---|---|
| 80/443 | Leaders Caddy | yes |
| 3000 | Leaders NestJS | no (proxied) |
| 7881 | LiveKit | yes (rtc) |
| 5432 / 6379 | Leaders pg/redis | localhost |
| 8088 | CIVA gateway (launcher) | yes (http; TLS via subdomain later) |
| 8081 / 8082 / 8090 | CIVA auth / lobby / orchestrator | internal (civa-net) |

## Quick orientation for an agent
- This file is the map. The CIVA repo's `docs/` has DESIGN.md (game), DEPLOY.md (ops), PLAN.md (roadmap).
- To change CIVA: edit in the repo, `git push`, then on the server `git pull` + redeploy (above).
- To check what's running: `docker ps`. Leaders containers are prefixed `leaders-`, CIVA `civa-`.
