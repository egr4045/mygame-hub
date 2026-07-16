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
in-memory vs. mock). The short version:

- ✅ **Real, with a backend:** account login (password-based, JWT access/refresh), cross-game SSO
  handoff, Telegram account linking/login **and** ops alerting (real bot), friends graph + live
  presence/activity + avatar/title + search-by-nick-or-code, invite codes + deep-link auto-join, a
  Steam-style toast + 🔔 notification center, chat (DMs **and** groups — edit/delete/reply/pin, role
  management, typing indicators, persisted history with pagination), voice/video calls (self-hosted
  LiveKit — both conversation calls and portable game-room calls), achievements (unlocks **and** their
  display catalogs — a game registers its own name/icon/description, not a hardcoded platform list),
  profile (avatar/wallpaper/title), a player suggestions queue (Telegram-notified, admin-triaged),
  on-demand game launch (Docker orchestrator), a dedicated mobile hub shell, an instant-boot skeleton +
  caching, a standalone **admin panel** (`apps/admin`, path-routed at `/admin/`) covering all of the
  above, and **Postgres persistence** throughout (gated on `DATABASE_URL`). Chat/friends/calls ship as
  part of `@mygame/sdk` — any game embedding the SDK gets them for free.
- 🟡 **Partial:** persistence falls back to in-memory when `DATABASE_URL` is unset; *sending* an invite
  from inside a real game session has no UI yet (only a hub demo button exercises it — see
  `docs/STATUS.md`'s Known Gaps).
- ❌ **Not built:** VK linking (deferred by request), chat reactions, find-groups/lobby browsing
  (removed by request — games are expected to build their own matchmaking).

## Stack

- **Hub (frontend):** React + Vite + TypeScript + Zustand (`apps/hub`). No game engine here.
- **Admin panel (frontend):** React + Vite + TypeScript (`apps/admin`), path-routed at `/admin/`
  alongside the hub. Logs in through the same register/login password flow as any player; access is
  gated by a server-side `is_admin` check (403 if not admin), not a client-side gate. Ships game
  management (changelog CRUD, discussion moderation, achievement grant/revoke, per-game status
  override, notification-sound uploads, orchestrator force-stop), user management (search/detail, ban,
  clear avatar/wallpaper, grant/revoke achievements), a player suggestions triage queue, and general
  settings (admin roster promote/demote, a live service-health dashboard, branding/contact settings).
- **Platform services:** Node.js + TypeScript, dependency-injected ports & adapters (`services/*`):
  - `auth` — register/login (password, JWT access/refresh), short-lived SSO handoff tokens, Telegram
    linking + ops alerting (one bot, `auth` is the sole poller), achievements (unlocks **and** the
    display-catalog registry a game populates), profile (avatar/wallpaper/title) persistence, playtime,
    and the account administration routes `apps/admin` uses (roster, roles, ban, moderation).
  - `social` — Socket.io friends + presence + invites + search-by-nick-or-code.
  - `chat` — Socket.io direct messages + groups (edit/delete/reply/pin, role management, typing) +
    voice/video call signaling (self-hosted LiveKit), persisted history with pagination, rate-limited.
  - `community` — per-game changelog + discussion forum, platform branding/contact + per-game-status +
    notification-sound settings, and a player suggestions queue (Telegram-notified on submit).
  - `orchestrator` — wakes/reaps per-game Docker stacks on player entry/idle.
- **SDK:** `@mygame/sdk` — the framework-agnostic client a game embeds (`mygame.init()`), built to be
  usable by third-party games (dual ESM/CJS + a global IIFE, React as a peer dep). Ships a
  self-mounting Shadow-DOM overlay with a working **chat widget** (DMs + groups + calls), **friends
  widget** (search by nick/code), and a **call view** (portable — survives navigating into a game) —
  toasts, sounds, and a context menu on top — a game gets real social features with zero UI code.
- **Contract:** `@mygame/protocol` — zod schemas for every platform message (the isolation boundary).
- **Monorepo:** pnpm workspaces + Turborepo.

## Layout

```
apps/
  hub/                 launcher SPA (login → library → launch a game; a dedicated mobile shell too)
  admin/               admin panel (game/user/suggestions/settings management), path-routed at /admin/
  example-game/        minimal reference game exercising the whole SDK surface
services/
  auth/                password login + JWT + SSO handoff/exchange + Telegram + achievements + profile
                       + playtime + admin routes (Postgres or in-memory accounts)
  social/              Socket.io friends/presence/invites/search (Postgres or in-memory)
  chat/                Socket.io DMs + groups + call signaling (Postgres or in-memory)
  community/           changelog + discussions + suggestions + platform settings (Postgres or in-memory)
  orchestrator/        Docker compose wake/reap per game
packages/
  protocol/            zod wire schemas (auth, social, chat, achievements, community, invite, envelope, errors)
  sdk/                 @mygame/sdk — embeddable client + overlay
  auth-core/           JWT sign/verify (HS256)
  platform-db/         shared Postgres pool + migrations + write-behind queue
  shared-types/        infrastructure ports (Clock/Logger/EventBus)
  telegram/            minimal Bot API client (long-poll + send), shared by auth/chat/community
  ui-kit/              design tokens
  test-harness/        in-memory fakes for standalone/tests
infra/                 docker-compose for local Postgres/Redis/LiveKit (used when DATABASE_URL set)
scripts/               service generator
docs/                  see below
```

## Docs

| Doc | What it covers |
|---|---|
| `docs/STATUS.md` | **Start here** — audited current state, real vs. mock, per feature, known gaps. |
| `docs/ARCHITECTURE.md` | Services, SDK, hub, protocol, data flows, the persistence gap. |
| `docs/ROADMAP-PLATFORM.md` | Launcher/lobby feature *backlog* (invite links, parties, quick-match…) — proposed, not yet built. |
| `docs/SSO-FEDERATION.md` | How a game accepts the platform login (handoff contract). |
| `docs/SERVER.md` | Production server map (`186.246.11.239`) — read before deploying. |
| `docs/CONVENTIONS.md` | Cross-cutting rules (protocol contract, ports/adapters, errors, naming). |
| `docs/DESIGN.md` | Design of the **CIVA game** (a separate product the platform launches). |

## Prerequisites

- Node.js >= 20 (tested on 24).
- pnpm 9 via Corepack. `corepack enable` needs admin on Windows; if it fails, prefix commands with
  `corepack pnpm` (e.g. `corepack pnpm install`).
- Docker — the **orchestrator** needs it (to start games), and `infra/docker-compose.yml` for local
  Postgres (every service's durable-mode dev target) + Redis (provisioned, not yet used) + LiveKit.

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
corepack pnpm --filter @mygame/community dev     # :8085
corepack pnpm --filter @mygame/orchestrator dev  # :8090
corepack pnpm --filter @mygame/hub dev           # hub on Vite (5173)
```

(`corepack pnpm dev:back` runs all five backend services together via Turborepo if your environment
doesn't hit the pnpm-version guard.)

The hub talks to `auth`/`social`/`chat`/`community` on `:8081`/`:8083`/`:8084`/`:8085` in dev (see
`packages/sdk/src/config.ts`); in production it talks to the same origin behind the gateway.

For **durable** dev data, start Postgres and point the services at it:

```sh
corepack pnpm infra:up                                  # Postgres on :5432 (civa/civa/civa)
DATABASE_URL=postgres://civa:civa@localhost:5432/civa corepack pnpm --filter @mygame/auth dev
DATABASE_URL=postgres://civa:civa@localhost:5432/civa corepack pnpm --filter @mygame/social dev
DATABASE_URL=postgres://civa:civa@localhost:5432/civa corepack pnpm --filter @mygame/chat dev
DATABASE_URL=postgres://civa:civa@localhost:5432/civa corepack pnpm --filter @mygame/community dev
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
