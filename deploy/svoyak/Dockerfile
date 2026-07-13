# syntax=docker/dockerfile:1
# Builds svoyak (Vue SPA + Express/Socket.io server) into one container. The server serves the
# built SPA, its own auth/api and socket.io on PORT. Native modules (bcrypt, sqlite3) need toolchain.
# Build with `docker build --network=host` on this server (IPv6/registry quirk; the flag doesn't
# exist on `docker compose build` there).
#
# trixie (glibc 2.41), NOT bookworm (2.36): sqlite3's npm prebuilds for current Node ABIs are
# linked against glibc 2.38+, and neither npm_config_build_from_source nor `npm rebuild
# --build-from-source` reliably reaches node-pre-gyp — the runtime just has to satisfy the prebuilt.
FROM node:22-trixie-slim
ENV NODE_OPTIONS=--dns-result-order=ipv4first
RUN apt-get update \
  && apt-get install -y --no-install-recommends git python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

ARG SVOYAK_REPO=https://github.com/egr4045/svoyak
RUN git clone --depth 1 "$SVOYAK_REPO" .

# Frontend build -> /app/dist (served by the server from ../dist). VITE_BASE_PATH=/svoyak/ makes Vite
# emit asset/socket.io/API URLs under /svoyak/ so the game is served over the hub's HTTPS origin
# (mygame-quiz.ru/svoyak/, secure context for getUserMedia). MUST ship together with the Caddyfile
# /svoyak/* route that strips the prefix — without it these asset paths 404. See deploy/gamehub/Caddyfile.
ENV VITE_BASE_PATH=/svoyak/
RUN npm ci && npm run build
# Backend deps: prebuilt native bindings are fine on trixie's glibc (see the FROM comment); the
# toolchain above still covers any package without a prebuild.
RUN cd server && npm ci --omit=dev

ENV NODE_ENV=production
ENV PORT=8089
WORKDIR /app/server
CMD ["node", "index.js"]
