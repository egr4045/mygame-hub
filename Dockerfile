# syntax=docker/dockerfile:1
# Multi-stage build for the GAMEHUB platform stack: one base with the monorepo + deps, a built web
# SPA served by a self-contained Caddy, and a generic service runtime image (auth/social/chat/
# community all share it — the command run is set per-service in compose).

FROM node:22-alpine AS base
# This host resolves npm registry to IPv6 but has no IPv6 route — force IPv4 so fetches work.
ENV NODE_OPTIONS=--dns-result-order=ipv4first
# Install pnpm via npm (more reliable in build sandboxes than corepack's downloader).
RUN npm install -g pnpm@9.15.9
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile

# --- Build the web SPA. In prod the client talks to auth/social/chat/community/lobby on the SAME
#     origin (the gateway Caddy path-routes between them), so no API URL needs baking in. ---
FROM base AS webbuild
RUN pnpm --filter @mygame/hub build

# --- Static web + self-contained reverse proxy (one origin for web + auth/social/chat/community + lobby) ---
FROM caddy:2-alpine AS web
COPY --from=webbuild /app/apps/hub/dist /srv/www
COPY deploy/gamehub/Caddyfile /etc/caddy/Caddyfile

# --- Build the example game SPA. Deployed behind a path on the SAME origin as the hub
#     (mygame-quiz.ru/example-game/, see deploy/gamehub/Caddyfile) — Vite needs that base path baked
#     in (VITE_BASE_PATH) so asset URLs resolve correctly; same-origin also means the SDK's own
#     sameOrigin default already finds auth/social/chat/community with no explicit URL needed.
#     VITE_HUB_URL stays supported (optional) for a deploy that instead puts this on its own
#     origin/port — Vite inlines import.meta.env.VITE_* during the build, it can't be set at
#     container runtime, so both must be provided as build args, not compose environment. ---
FROM base AS examplegamebuild
ARG VITE_HUB_URL=
ARG VITE_BASE_PATH=/
ENV VITE_HUB_URL=$VITE_HUB_URL
ENV VITE_BASE_PATH=$VITE_BASE_PATH
RUN pnpm --filter @mygame/example-game build

# --- Static file server for the example game. No reverse proxy needed on its own port: reached via
#     the gateway's path-route (deploy/gamehub/Caddyfile strips the /example-game/ prefix before
#     proxying here), and its JS talks to auth/social/chat/community same-origin (or VITE_HUB_URL,
#     if that was set at build time instead). ---
FROM caddy:2-alpine AS exampleweb
COPY --from=examplegamebuild /app/apps/example-game/dist /srv/www
COPY deploy/gamehub/example-game.Caddyfile /etc/caddy/Caddyfile

# --- Build the admin SPA. Same path-based-deploy pattern as example-game
#     (mygame-quiz.ru/admin/) — never shipped in the player-facing hub bundle. ---
FROM base AS adminbuild
ARG VITE_BASE_PATH=/
ENV VITE_BASE_PATH=$VITE_BASE_PATH
RUN pnpm --filter @mygame/admin build

# --- Static file server for the admin SPA. No reverse proxy needed on its own port: reached via the
#     gateway's path-route (deploy/gamehub/Caddyfile strips the /admin/ prefix before proxying here);
#     its JS talks to auth/community/orchestrator same-origin. ---
FROM caddy:2-alpine AS adminweb
COPY --from=adminbuild /app/apps/admin/dist /srv/www
COPY deploy/gamehub/admin.Caddyfile /etc/caddy/Caddyfile

# --- Service runtime: auth/social/chat/community/orchestrator's base (command set per-service in compose) ---
FROM base AS service
ENV NODE_ENV=production
CMD ["node", "--version"]

# --- Orchestrator: service runtime + docker CLI (controls per-game compose via the host socket) ---
FROM base AS orchestrator
RUN apk add --no-cache docker-cli docker-cli-compose
ENV NODE_ENV=production
CMD ["pnpm", "--filter", "@mygame/orchestrator", "start"]
