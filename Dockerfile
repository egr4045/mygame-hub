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

# --- Service runtime: auth/social/chat/community/orchestrator's base (command set per-service in compose) ---
FROM base AS service
ENV NODE_ENV=production
CMD ["node", "--version"]

# --- Orchestrator: service runtime + docker CLI (controls per-game compose via the host socket) ---
FROM base AS orchestrator
RUN apk add --no-cache docker-cli docker-cli-compose
ENV NODE_ENV=production
CMD ["pnpm", "--filter", "@mygame/orchestrator", "start"]
