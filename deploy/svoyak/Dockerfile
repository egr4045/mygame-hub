# syntax=docker/dockerfile:1
# Builds svoyak (Vue SPA + Express/Socket.io server) into one container. The server serves the
# built SPA, its own auth/api and socket.io on PORT. Native modules (bcrypt, sqlite3) need toolchain.
# Build with --network=host on this server (IPv6/registry quirk).
FROM node:22-bookworm-slim
ENV NODE_OPTIONS=--dns-result-order=ipv4first
RUN apt-get update \
  && apt-get install -y --no-install-recommends git python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

ARG SVOYAK_REPO=https://github.com/egr4045/svoyak
RUN git clone --depth 1 "$SVOYAK_REPO" .

# Frontend build -> /app/dist (served by the server from ../dist).
RUN npm ci && npm run build
# Backend deps. Native modules (sqlite3, bcrypt) MUST be compiled here: the npm prebuilds for
# recent Node ABIs are linked against glibc 2.38+, newer than bookworm's 2.36 (ERR_DLOPEN_FAILED
# at runtime). The env var alone doesn't reliably reach node-pre-gyp through npm ci, so an
# explicit rebuild --build-from-source is the enforcement step.
RUN cd server && npm ci --omit=dev \
  && npm rebuild --build-from-source sqlite3 bcrypt

ENV NODE_ENV=production
ENV PORT=8089
WORKDIR /app/server
CMD ["node", "index.js"]
