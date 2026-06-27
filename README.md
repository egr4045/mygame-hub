# CIVA

Real-time 4X strategy for 5–8 players: authoritative tick server, hex map of Earth, built-in WebRTC
diplomacy, a UN General Assembly phase with a TTS announcer, and a logistics-driven economy.

See the full implementation plan at `docs/PLAN.md` (mirrors the approved plan).

## Stack

- **Frontend:** React + PixiJS + Vite + TypeScript (`apps/hub`)
- **Backend:** Node.js + TypeScript, Socket.io, authoritative tick loop (`services/*`)
- **WebRTC:** LiveKit (caucus rooms + global conference)
- **TTS announcer:** local Silero worker (reuses the `ml-box` job-queue contract)
- **Monorepo:** pnpm workspaces + Turborepo. Each game module is an isolated service/package
  that can run and be tested standalone.

## Prerequisites

- Node.js >= 20 (tested on 24)
- pnpm 9 via Corepack. `corepack enable` requires admin on Windows; if it fails, prefix all
  commands with `corepack pnpm` instead of `pnpm` (e.g. `corepack pnpm install`).
- Docker (for `infra/docker-compose.yml`: Postgres, Redis, LiveKit dev)

## Quick start

```sh
corepack pnpm install
corepack pnpm build
corepack pnpm test
```

## Layout

```
apps/        web client (+ companion later)
services/    isolated backend services (gateway, auth, lobby, game-engine, trade, diplomacy, assembly, tts-gateway)
packages/    shared libs (protocol, shared-types, sim-core, hex-core, game-config, ui-kit, test-harness)
infra/       docker-compose + local infra
scripts/     repo tooling (service generator)
```

## Isolation contract

Every service/module:

1. Talks to the outside world only through zod schemas in `packages/protocol`.
2. Has a `dev:standalone` script that runs it in isolation against `test-harness` fixtures + in-memory adapters.
3. Depends on storage/bus/clock through interfaces (swappable real vs. test adapters).
4. Ships three test tiers: **unit** (pure logic) → **contract** (service-in-a-box) → **integration** (compose).
