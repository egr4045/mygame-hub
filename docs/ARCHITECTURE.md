# Architecture

How the platform is put together: the services, the SDK, the hub, the contract between them, and the
main data flows. For *what works vs. what's mocked* see `STATUS.md`.

## Big picture

```
                 ┌─────────────────────────────────────────────┐
                 │  hub SPA (apps/hub)  — React + Zustand        │
                 │  AuthScreen → HubScreen (library/launcher)    │
                 │  embeds @mygame/sdk (overlay: friends/chat/…) │
                 └──┬───────────┬───────────────┬───────────┬───┘
                    │ HTTP      │ Socket.io      │ Socket.io │ HTTP
                    ▼           ▼                ▼           ▼
             ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐
             │ auth     │ │ social   │ │ chat     │ │ orchestrator │
             │ JWT login│ │ friends +│ │ direct   │ │ docker       │
             │ + handoff│ │ presence │ │ messages │ │ compose      │
             │ + telegram│ │ + invites│ │ (DMs)   │ │ per game     │
             └──────────┘ └──────────┘ └──────────┘ └──────┬───────┘
                    ▲                                       │ docker
                    │ verifies platform JWT                 ▼
             ┌──────┴──────────────────────┐       per-game stacks
             │ a game on its own origin    │       (CIVA, svoyak, …)
             │ POST /auth/platform (SSO)   │
             └──────────────────────────────┘
```

Everything that crosses a platform boundary is a zod schema in `@mygame/protocol`. Services never
import each other's internals — only the contract.

## Services (`services/*`)

All four follow the same shape: a `createApp`/`createServer` that takes **ports** (deps) so the same
logic runs against real or in-memory adapters; an `index.ts` "production" entry; a `standalone.ts` for
isolated dev; a `config.ts` reading env. `auth`, `social` and `chat` are Postgres-backed when
`DATABASE_URL` is set, else fall back to in-memory (see `STATUS.md` and "Persistence" below).

### auth (`services/auth`) — port 8081

Passwordless identity provider. Routes (`app.ts`):

- `POST /auth/login` `{ displayName, accountId? }` → `{ accountId, displayName, accessToken, refreshToken }`.
  `accountId` lets a returning client **re-claim** the same durable identity.
- `POST /auth/refresh` `{ refreshToken }` → `{ accessToken }`.
- `POST /auth/handoff` `{ refreshToken }` → `{ handoffToken, accountId, displayName }` — a 120s token
  to carry identity into a game (see `SSO-FEDERATION.md`).
- `POST /auth/telegram/link-code` (Bearer access) → `{ code, url }` — one-time code bound to the
  account; the bot consumes it via `/start <code>`.
- `GET /auth/telegram/status` (Bearer access) → `{ linked, telegramId? }`.
- `POST /auth/social/login` `{ network, recoveryCode }` → session — redeem a `/login` code from the
  bot to sign in on a new device (currently `network: 'telegram'` only).
- `GET /health`, `GET /ready`.

JWTs are HS256 via `@mygame/auth-core` (`signAccess` 15m, `signRefresh` 30d, `signHandoff` 120s,
`verify`). Accounts live in `AccountStore` (real Postgres or in-memory).

**Telegram.** When `TELEGRAM_BOT_TOKEN` is set, `index.ts` starts a bot: `telegram.ts` is a minimal
Bot API client using **long polling** (no public webhook needed — run a single auth instance);
`telegramLinking.ts` holds short-lived (5 min) link/login codes and handles `/start <code>` (binds the
chat to the account) and `/login` (issues a login code). The `telegram_id` mapping persists via the
account store.

### social (`services/social`) — port 8083

Socket.io server layering live presence over a durable friendship graph.

- **Auth:** every socket handshake carries the platform **access** token; `io.use(...)` verifies it
  and binds the socket to `accountId`.
- **Graph:** `SocialStore` (`store.ts`) — undirected edges keyed by sorted account pair, with a
  `by` field for pending direction. In-memory.
- **Presence/activity:** *not* in the store — held in `server.ts` maps (`socketsOf`, `activityOf`)
  and recomputed live. Online = has ≥1 connected socket.
- **Push model:** on any change the server pushes the **full** friends list (with presence +
  activity resolved) to the affected account and everyone it has an edge with.
- **C2S/S2C events:** see `protocol/src/social.ts` (`request`, `accept`, `decline`, `remove`,
  `setActivity`, `getState`, `createInvite`, `inviteFriend` / `friends`, `me`, `invite`, `error`).
- **Invites:** `InviteStore` (`invites.ts`) mints opaque random codes (unambiguous alphabet, 1h TTL)
  resolving to `{ game, room, role, inviter }`. Public HTTP `GET /invite/:code` resolves a code
  before any socket exists (for deep links).

### chat (`services/chat`) — port 8084

Socket.io server for **direct messages** (1:1 only — no group chat yet, see `PLAN.md`). Mirrors
`social`'s shape closely: same JWT handshake auth (`io.use`), same "push the full view on any change"
model, same in-memory-then-Postgres adapter split.

- **Threads have no id of their own** — since a DM is always exactly two accounts, the *other*
  account's id identifies the thread from either side (`ChatThread.accountId`).
- **Store (`store.ts`):** messages bucketed by the sorted account pair; `threads(accountId)` derives
  the last message + unread count per thread; `markRead` flips `readAt` on the recipient's unread
  messages and returns the timestamp to notify the sender.
- **C2S/S2C events:** see `protocol/src/chat.ts` (`send`, `markRead`, `getHistory`, `getState` /
  `threads`, `message`, `read`, `error`). `send` and `getHistory` reply via ack; `message`/`threads`/
  `read` are pushed.
- **Read receipts:** simplified to `sent` | `read` (no `delivered` state). A message is "read" once
  the recipient's client calls `markRead` (the hub does this on `openChat`).
- **Known v1 simplifications** (see `STATUS.md`): no group chat, no reactions, no typing indicators,
  history is capped (last 100) with no pagination, DMs aren't restricted to friends (any known
  accountId can message any other — same trust model as friend codes).

### orchestrator (`services/orchestrator`) — port 8090

Wakes a game when a player enters and reaps it when idle, so empty games burn no RAM.

- `Orchestrator` (`orchestrator.ts`) is pure control logic over ports — fully testable without Docker.
  `ensureUp(id)` is idempotent and concurrency-safe (overlapping callers share one start).
- **Ports:** `ContainerRuntime` (real adapter `docker.ts` shells `docker compose up/stop/ps`),
  `ActivityProbe` (real adapter `probe.ts` polls a game's `/metrics` for `{ players }`).
- **Reaper:** periodic `tick()` stops any non-`alwaysOn` game that has sat at zero players past
  `idleMs` (default 10 min).
- **Routes (`app.ts`):** `GET /games`, `POST /games/:id/enter`, `GET /health`.
- **Manifest:** games declared in `config.ts` (`defaultGames()`), each with its compose dir/project,
  activity URL, and idle policy. Add a game = one entry + its `deploy/<game>` compose.

## SDK (`packages/sdk` → `@mygame/sdk`)

The framework-agnostic client a game embeds, plus the overlay the hub also uses.

- **`client.ts`** — the `mygame` singleton. `mygame.init(gameId, { hubUrl })` configures endpoints,
  mounts the overlay, and opens the social **and** chat connections. Sub-APIs: `auth`, `social`,
  `chat`, `ui`.
- **`config.ts`** — runtime endpoints. Dev → `localhost:8081/8083/8084`; prod → same origin; a game
  points it at the hub via `mygame.init(id, { hubUrl })`.
- **`authClient.ts`** — login + session persistence in `localStorage` (`civa.session`), `getHandoff()`,
  plus Telegram helpers (`createTelegramLinkCode`, `getTelegramStatus`, `loginWithTelegram`).
- **State (Zustand):** `socialStore` and `chatStore` (both **real**, own Socket.io connections),
  `menuStore`, `toastStore`.
- **Overlay (`overlay/mount.tsx`, `components/*`)** — self-mounting Shadow-DOM overlay rendering
  `MygameOverlay` (toasts, context menu) so a game gets the platform UI without importing React itself.
- Built with `tsup` (`tsup.config.ts`) for external consumption.

## Hub (`apps/hub`)

React + Vite SPA. `App.tsx` routes on session: no account → `AuthScreen`, else `HubScreen` (the
Steam-style library/launcher). State:

- **`platform/platformStore.ts`** — the account session + selected game (persisted to `localStorage`).
- **`platform/games.ts`** — the front-end game registry; `externalPort` marks a game that is its own
  SPA (selecting it wakes it via the orchestrator, then navigates with a handoff token).
- Social/chat/menu/toast come from `@mygame/sdk` stores (single source shared with embedded games).

The hub still renders the overlay components itself inside `HubScreen` (the SDK self-mount overlay is
for embedded games).

## Contract (`packages/protocol` → `@mygame/protocol`)

The single source of truth for platform wire messages: `auth.ts`, `social.ts`, `chat.ts`, `invite.ts`,
`envelope.ts` (the WS envelope `{ v, type, seq, ts, traceId?, payload }` + `CONTRACT_VERSION`),
`errors.ts` (`ErrorCode` + `ContractError.toProtocol()`). Per-game protocols live in each game's repo
and may re-export these primitives.

## Supporting packages

- **`auth-core`** — HS256 sign/verify, `TokenError` with a `reason`.
- **`shared-types`** — `ports.ts` (`Clock`, `Logger`, …) used everywhere; plus CIVA game-domain types
  (resources/biomes/buildings/units/tech) the **platform does not use** (see `STATUS.md`).
- **`ui-kit`** — design tokens.
- **`test-harness`** — in-memory fakes for standalone/contract tests.

## Key data flows

**Login.** Hub `AuthScreen` → `platformStore.login(name)` → `sdk.authClient.login` → `POST /auth/login`
→ session saved to `localStorage` → `App` opens the social connection.

**Friends/presence.** `socialStore.connect()` refreshes the access token via `/auth/login`, opens the
Socket.io connection with `auth.token`, and renders whatever `social.friends` the server pushes.

**Invite a friend.** `inviteFriend` → server checks friendship, mints a code, pushes
`social.invite` to the friend's sockets. Or `createInvite` → ack returns a code to share as a link.

**Send a DM.** `chatStore.sendMessage` → `chat.send` (ack) → server persists + pushes `chat.message`
to both the sender's other sockets and the recipient, and a refreshed `chat.threads` to both. Opening
a thread (`openChat`) fetches `chat.getHistory` and fires `chat.markRead`, which flips `readAt` and
pushes `chat.read` back to the sender so their checkmarks update.

**Launch a game.** `handlePlay` → `enterGame(id)` (`POST /orchestrator/games/:id/enter`, best-effort)
→ `getHandoff()` → navigate to `http://host:PORT/?pt=<handoff>`. The game exchanges the token at its
own `/auth/platform` and federates the identity.

## Persistence

`@mygame/platform-db` provides the shared Postgres plumbing: `createPool`, `runMigrations` (the
platform schema — `accounts`, `friendships`, `invites`, `messages`), and a `WriteQueue`. Each service
has its own adapter next to its port (`auth/src/pgStore.ts`, `social/src/pgStore.ts` +
`social/src/pgInvites.ts`, `chat/src/pgStore.ts`).

**Write-behind model.** The in-memory store stays authoritative for **reads** (the hot
friends/presence/chat path is synchronous and fast). Every **write** also goes to Postgres through the
`WriteQueue` — ordered, non-blocking, errors logged not thrown. On boot each adapter's `init()`
hydrates memory from the DB (the social/chat adapters replay their graph/messages through the store's
own public API or a dedicated `hydrate()`, so state is reconstructed exactly). A restart no longer
loses data.

**Wiring.** Production entries (`index.ts`) use Postgres when `DATABASE_URL` is set, else fall back to
the in-memory store with a loud warning. `standalone.ts` is always in-memory (isolation/dev). The
`accounts` table is shared: `auth` is authoritative for profile fields; `social`/`chat` only refresh
`display_name`. Set `DATABASE_URL=postgres://civa:civa@localhost:5432/civa` (matches
`infra/docker-compose.yml`) to enable it. Redis is provisioned but not yet used.

> Trade-off: write-behind means a crash in the gap between the in-memory write and the DB write can
> lose that single write. Acceptable for now; a synchronous/transactional path can replace it later if
> needed. `WriteQueue.drain()` exists for graceful-shutdown flushing.
