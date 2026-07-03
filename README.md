# mygame — game platform hub

A browser game **platform** in the spirit of Steam: one shared account, a friends/social layer, and a
launcher that wakes each game on demand. Individual games (CIVA, Своя игра, Leaders, …) are **separate
products on their own origins** — the hub logs you in once and hands that identity off to them.

> **Scope note.** This repository is the *platform* (launcher + social + auth + orchestrator + the
> `@mygame/sdk` games embed). It does **not** contain a game. The CIVA 4X game has its own design
> docs (`docs/DESIGN.md`) and is deployed as an on-demand stack the orchestrator starts; its code
> lives outside this repo.

## What works today

See **`docs/STATUS.md`** for the authoritative, audited feature-by-feature breakdown (real backend vs.
in-memory vs. UI-only mock). The short version:

- ✅ **Real, with a backend:** account login (JWT), cross-game SSO handoff, Telegram account
  linking/login (real bot), friends graph + live presence/activity, invite codes, chat (DMs **and**
  groups, persisted, read receipts), on-demand game launch (Docker orchestrator), **Postgres
  persistence** for accounts/friends/invites/conversations (gated on `DATABASE_URL`). The chat UI ships
  as part of `@mygame/sdk` — any game embedding the SDK gets it for free.
- 🟡 **Partial:** persistence falls back to in-memory when `DATABASE_URL` is unset; login is
  passwordless (the password field is ignored); groups have no add/remove-member yet.
- ❌ **UI-only mock (no backend):** voice/video calls, achievements, game store pages
  (changelog/forum/lobby browser), playtime stats, VK linking (deferred by request).

## Stack

- **Hub (frontend):** React + Vite + TypeScript + Zustand (`apps/hub`). No game engine here.
- **Platform services:** Node.js + TypeScript, dependency-injected ports & adapters (`services/*`):
  - `auth` — passwordless login, JWT access/refresh, short-lived SSO handoff tokens, Telegram linking.
  - `social` — Socket.io friends + presence + invites.
  - `chat` — Socket.io direct messages + groups, persisted history + read receipts.
  - `orchestrator` — wakes/reaps per-game Docker stacks on player entry/idle.
- **SDK:** `@mygame/sdk` — the framework-agnostic client a game embeds (`mygame.init()`), built to be
  usable by third-party games (dual ESM/CJS + a global IIFE, React as a peer dep). Ships a
  self-mounting Shadow-DOM overlay with a working **chat widget** (DMs + groups), toasts and a context
  menu — a game gets a real messenger with zero UI code. Friends UI isn't extracted into the SDK yet
  (data only, via `mygame.social.*`); see `docs/STATUS.md`.
- **Contract:** `@mygame/protocol` — zod schemas for every platform message (the isolation boundary).
- **Monorepo:** pnpm workspaces + Turborepo.

## Layout

```
apps/
  hub/                 launcher SPA (login → library → launch a game)
services/
  auth/                JWT login + SSO handoff + Telegram linking (Postgres or in-memory accounts)
  social/              Socket.io friends/presence/invites (Postgres or in-memory)
  chat/                Socket.io DMs + groups (Postgres or in-memory)
  orchestrator/        Docker compose wake/reap per game
packages/
  protocol/            zod wire schemas (auth, social, chat, invite, envelope, errors)
  sdk/                 @mygame/sdk — embeddable client + overlay
  auth-core/           JWT sign/verify (HS256)
  platform-db/         shared Postgres pool + migrations + write-behind queue
  shared-types/        domain vocabulary + ports (Clock/Logger/…)
  ui-kit/              design tokens
  test-harness/        in-memory fakes for standalone/tests
infra/                 docker-compose for local Postgres/Redis (Postgres used when DATABASE_URL set)
scripts/               service generator
docs/                  see below
```

## Docs

| Doc | What it covers |
|---|---|
| `docs/STATUS.md` | **Start here** — audited current state, real vs. mock, per feature. |
| `docs/ARCHITECTURE.md` | Services, SDK, hub, protocol, data flows, the persistence gap. |
| `docs/PLAN.md` | Platform roadmap — what's done and what's next. |
| `docs/ROADMAP-PLATFORM.md` | Launcher/lobby feature backlog (invite links, parties, quick-match…). |
| `docs/SSO-FEDERATION.md` | How a game accepts the platform login (handoff contract). |
| `docs/SERVER.md` | Production server map (`186.246.11.239`) — read before deploying. |
| `docs/CONVENTIONS.md` | Cross-cutting rules (protocol contract, ports/adapters, errors, naming). |
| `docs/DESIGN.md` | Design of the **CIVA game** (a separate product the platform launches). |

## Prerequisites

- Node.js >= 20 (tested on 24).
- pnpm 9 via Corepack. `corepack enable` needs admin on Windows; if it fails, prefix commands with
  `corepack pnpm` (e.g. `corepack pnpm install`).
- Docker — only the **orchestrator** needs it (to start games), and `infra/docker-compose.yml` for
  the (not-yet-wired) local Postgres/Redis.

## Quick start

```sh
corepack pnpm install
corepack pnpm build
corepack pnpm test
```

Run the platform backend + hub in dev. Prefer starting each service individually via `--filter`
(some `turbo run` invocations trip a pnpm-version guard when packages have changed — see below):

```sh
corepack pnpm --filter @mygame/auth dev          # :8081
corepack pnpm --filter @mygame/social dev        # :8083
corepack pnpm --filter @mygame/chat dev          # :8084
corepack pnpm --filter @mygame/orchestrator dev  # :8090
corepack pnpm --filter @mygame/hub dev           # hub on Vite (5173)
```

(`corepack pnpm dev:back` runs all four backend services together via Turborepo if your environment
doesn't hit the pnpm-version guard.)

The hub talks to `auth`/`social`/`chat` on `:8081`/`:8083`/`:8084` in dev (see
`packages/sdk/src/config.ts`); in production it talks to the same origin behind the gateway.

For **durable** dev data, start Postgres and point the services at it:

```sh
corepack pnpm infra:up                                  # Postgres on :5432 (civa/civa/civa)
DATABASE_URL=postgres://civa:civa@localhost:5432/civa corepack pnpm --filter @mygame/auth dev
DATABASE_URL=postgres://civa:civa@localhost:5432/civa corepack pnpm --filter @mygame/social dev
DATABASE_URL=postgres://civa:civa@localhost:5432/civa corepack pnpm --filter @mygame/chat dev
```

Without `DATABASE_URL` the services run in-memory (data lost on restart). `dev:standalone` is always
in-memory by design. Telegram linking additionally needs `TELEGRAM_BOT_TOKEN` set on `auth` (see
`docs/SERVER.md`).

## Isolation contract

Every service:

1. Talks to the outside world only through zod schemas in `packages/protocol`.
2. Depends on storage/clock/logger through **ports** (`@mygame/shared-types`), so a real adapter
   (Postgres, system clock) swaps in for a test/in-memory one without touching service logic.
3. Has a `dev:standalone` entry that runs it in isolation against in-memory adapters.
