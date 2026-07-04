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
             │ JWT login│ │ friends +│ │ dm +     │ │ docker       │
             │ + handoff│ │ presence │ │ group    │ │ compose      │
             │ + telegram│ │ + invites│ │ messages│ │ per game     │
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
- `POST /auth/achievements` (Bearer access) `{ gameId, achievementId }` → `{ achievement, granted }` —
  idempotent grant (`granted: false` if already held).
- `GET /auth/achievements` (Bearer access) → `{ achievements: Achievement[] }` — every game's unlocked
  achievements for the caller.
- `PUT /auth/profile/avatar` / `PUT /auth/profile/wallpaper` (Bearer access) `{ dataUrl }` → sets the
  image (a data URL); the read side of these two routes has a raised body-size cap (4MB raw bytes,
  independent of the general 200KB default — see below).
- `PUT /auth/profile/title` (Bearer access) `{ titleAchievement: { gameId, achievementId } | null }` —
  sets (or `null` clears) the cross-game "title" badge. Rejected (400) if the account doesn't actually
  hold that achievement.
- `GET /auth/profile` (Bearer access) → `{ avatarIcon, wallpaper, titleAchievement }` (all nullable).
- `GET /health`, `GET /ready`.

JWTs are HS256 via `@mygame/auth-core` (`signAccess` 15m, `signRefresh` 30d, `signHandoff` 120s,
`verify`). Accounts live in `AccountStore` (real Postgres or in-memory).

**Telegram.** When `TELEGRAM_BOT_TOKEN` is set, `index.ts` starts a bot: `telegram.ts` is a minimal
Bot API client using **long polling** (no public webhook needed — run a single auth instance);
`telegramLinking.ts` holds short-lived (5 min) link/login codes and handles `/start <code>` (binds the
chat to the account) and `/login` (issues a login code). The `telegram_id` mapping persists via the
account store.

**Achievements.** An `Account`'s `achievements: AccountAchievement[]` is a flat list of
`{ gameId, achievementId, unlockedAt }` — deliberately opaque ids, so two games can reuse the same
`achievementId` without colliding (scoped by `gameId`). The platform stores only *that* something is
unlocked and *when*; it has no notion of what the achievement is called or looks like — that's a
per-game/client presentation concern (see the SDK section). Trust model: the caller's own access
token authorizes the grant, same as chat DMs not being restricted to friends — a game's client can
self-report an unlock that wasn't strictly earned; a game that cares should grant from its own trusted
backend instead of its client.

**Profile (avatar/wallpaper/title).** Images are stored as **data URLs directly on the account row**
(`accounts.avatar_icon` / `.wallpaper`, both `TEXT`) rather than in an object-storage service — none
exists in this stack (`infra/docker-compose.yml` has Postgres/Redis/LiveKit only), and adding one
(MinIO/S3 + a client dependency + a new env var + upload plumbing) is disproportionate to "let people
set an avatar" at this project's scale (single small server, `docs/SERVER.md`). The tradeoff: `readJson`
defaults to a 200KB body cap (comfortably covers every other route's tiny payloads), and the two
profile-image routes explicitly raise it to 4MB raw bytes; the `dataUrl` field itself is capped at
2.5M characters (~1.8MB decoded) by the zod schema. A request over the raw-byte cap is rejected
(413) *while streaming* (`readJson`'s `maxBytes` param), before the full body is ever buffered — a
request under that cap but over the zod string-length cap gets a clean 400 instead. If this needs to
scale past prototype usage, swapping in real object storage is a clean, well-scoped follow-up (same
shape as the "deploy reconciliation" follow-up already tracked) — nothing else would need to change,
since the client already treats the avatar/wallpaper values as opaque URLs.

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

Socket.io server for **direct messages and groups**, unified as a single `Conversation` concept (a DM
is just a 2-member conversation). Mirrors `social`'s shape closely: same JWT handshake auth
(`io.use`), same "push the full view on any change" model, same in-memory-then-Postgres adapter split.

- **A DM is found-or-created, deterministically, per account pair** via `openDm(a, b)` (calling it
  twice for the same two accounts always returns the same conversation). A **group** is created
  explicitly via `createGroup(creator, name, memberIds)` — membership is fixed at creation (no
  add/remove/leave yet, see `PLAN.md`).
- **Store (`store.ts`):** `conversations` + a `dmIndex` (sorted account pair → conversation id) +
  messages bucketed by conversation. `threads(accountId)` derives, per conversation, the last message,
  unread count, and (dm only) the other participant's `otherReadAt`.
- **Read state is per-member, not per-message** (`lastReadAt` in `conversation_members`) — this is
  what lets the model scale to N-member groups without a combinatorial "read by whom" state per
  message. New members start at `lastReadAt = 0` ("read nothing"), not `now()` — a message landing in
  the same tick as the conversation's creation must still count as unread.
- **C2S/S2C events:** see `protocol/src/chat.ts` (`openDm`, `createGroup`, `send`, `markRead`,
  `getHistory`, `getState` / `threads`, `message`, `read`, `error`). Mutating calls reply via ack;
  `message`/`threads`/`read` are pushed to every participant of the affected conversation.
- **Read receipts:** simplified to `sent` | `read`, **dm only** (no `delivered` state, and groups don't
  render per-message read state — `ChatThread.otherReadAt` is `null` for groups). A dm message is
  "read" once `otherReadAt >= message.createdAt`; the client recomputes this on every `chat.threads`/
  `chat.read` push using the message's raw timestamp (not the formatted display string).
- **Known v1 simplifications** (see `STATUS.md`): no group membership changes (add/remove/leave), no
  reactions, no typing indicators, history is capped (last 100) with no pagination, messaging isn't
  restricted to friends (any known accountId can be DMed or added to a group — same trust model as
  friend codes).

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

The framework-agnostic client a game embeds, plus the overlay the hub also uses. Built with the
explicit goal of being usable by third-party games (and eventually open-sourced): dual ESM/CJS build
plus a global IIFE (`window.mygame`) for non-bundler consumers, React as a peer dependency, and a
self-mounting Shadow-DOM overlay so the platform UI works on top of any host page's CSS.

- **`client.ts`** — the `mygame` singleton. `mygame.init(gameId, { hubUrl })` configures endpoints,
  mounts the overlay, and opens the social **and** chat connections. Sub-APIs:
  - `auth` — session, tokens, handoff.
  - `social` — friends/presence (`getFriends`, `addByCode`, `setActivity`, `subscribe`).
  - `chat` — `open`, `openWithUser` (find-or-create a dm), `createGroup`, `send`, `getThreads`,
    `getUnreadCount`, `subscribe`. A game can either just call `open()`/`openWithUser()` and rely on
    the SDK-shipped `ChatWidget`, or build its own UI entirely on this data.
  - `achievements` — `grant(achievementId)` (scoped to `this.gameId` from `init()`; fires a toast on a
    genuinely new unlock, silent on a re-grant) and `list()` (every game's unlocked achievements).
  - `profile` — `get()`, `setAvatar(dataUrl)`, `setWallpaper(dataUrl)`, `setTitle(ref | null)`. `ref`
    is validated server-side against the account's own unlocked achievements.
  - `ui` — context menu, toasts.
  The plain functions behind `achievements`/`profile` (`grantAchievement`, `getAchievements`,
  `getProfile`, `setAvatar`, `setWallpaper`, `setTitleAchievement` — `authClient.ts`) are also exported
  directly for a caller that hasn't gone through `mygame.init()` — the hub uses those, since it doesn't
  call `init()` itself (see "Hub" below).
- **`config.ts`** — runtime endpoints. Dev → `localhost:8081/8083/8084`; prod → same origin; a game
  points it at the hub via `mygame.init(id, { hubUrl })`.
- **`authClient.ts`** — login + session persistence in `localStorage` (`civa.session`), `getHandoff()`,
  Telegram helpers (`createTelegramLinkCode`, `getTelegramStatus`, `loginWithTelegram`), achievement
  helpers (`grantAchievement`, `getAchievements`), and profile helpers (`getProfile`, `setAvatar`,
  `setWallpaper`, `setTitleAchievement`).
- **State (Zustand):** `socialStore` and `chatStore` (both **real**, own Socket.io connections),
  `menuStore`, `toastStore`.
- **Overlay (`overlay/mount.tsx`, `components/*`)** — self-mounting Shadow-DOM overlay rendering
  `MygameOverlay` (toasts, context menu, **`ChatWidget`**, **`FriendsWidget`**) so a game gets the
  platform's social UI without writing any of its own. The host is click-through
  (`pointer-events: none`); every interactive component explicitly re-enables `pointerEvents: 'auto'`
  on its own root.
- **`ChatWidget`** (`components/ChatWidget.tsx`) and **`FriendsWidget`**/**`FriendsSidebar`**
  (`components/FriendsWidget.tsx`, `FriendsSidebar.tsx`) are the platform widgets that ship with the
  SDK. `ChatWidget` renders as a small launcher button with an unread badge when closed, and the full
  draggable/resizable messenger (DM + group list, create-group form, message view) when open.
  `FriendsWidget` similarly renders as a minimized "friends & chat" button (online count) or the
  expanded friends list. Moving `FriendsSidebar` dropped its one hub-specific dependency
  (`usePlatformStore().selectedGame`, used only to disable the already-mock "Invite to current game"
  menu item) rather than plumbing hub-only state into a component meant to be generic — the action was
  `alert(...)` either way, so nothing real was lost; the item is just no longer conditionally disabled.
- Built with `tsup` (`tsup.config.ts`) for external consumption.

## Hub (`apps/hub`)

React + Vite SPA. `App.tsx` routes on session: no account → `AuthScreen`, else `HubScreen` (the
Steam-style library/launcher). State:

- **`platform/platformStore.ts`** — the account session + selected game (persisted to `localStorage`).
- **`platform/games.ts`** — the front-end game registry; `externalPort` marks a game that is its own
  SPA (selecting it wakes it via the orchestrator, then navigates with a handoff token).
- Social/chat/menu/toast come from `@mygame/sdk` stores (single source shared with embedded games).
  `ChatWidget`/`FriendsWidget` are likewise imported straight from `@mygame/sdk` (not local hub
  components) — `HubScreen` renders them directly in its own tree, `MygameOverlay` renders the *same*
  components for embedded games via the Shadow-DOM mount. One component each, two mounting paths.
  `SteamOverlay.tsx` (`apps/hub/src/components`) also imports `FriendsSidebar` from `@mygame/sdk`, but
  is itself dead code — imported by `HubScreen` but never actually rendered.

The hub still renders `ContextMenu`/`ToastContainer`/`ChatWidget`/`FriendsWidget` itself inside
`HubScreen` rather than using the SDK's self-mount overlay (that mounting path is for embedded games).

> **The hub never calls `mygame.init()`.** It wires `socialStore`/`chatStore` `connect()` directly
> (`App.tsx`) instead, so `mygame.gameId` is always `null` there. Anything gated on `this.gameId`
> (e.g. `mygame.achievements.grant`, which scopes to "the current game") won't work from the hub's own
> code for that reason — the hub calls the lower-level exported functions directly instead
> (`grantAchievement('civa', id)`), passing the game id explicitly. This only matters for hub-side
> code; a real embedded game that calls `init()` doesn't hit this.

## Contract (`packages/protocol` → `@mygame/protocol`)

The single source of truth for platform wire messages: `auth.ts`, `social.ts`, `chat.ts`,
`achievements.ts`, `invite.ts`, `envelope.ts` (the WS envelope
`{ v, type, seq, ts, traceId?, payload }` + `CONTRACT_VERSION`), `errors.ts` (`ErrorCode` +
`ContractError.toProtocol()`). Per-game protocols live in each game's repo and may re-export these
primitives.

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
Both are only exercised from the hub today via a demo button — no real game calls them yet (see
"Deep links" below).

**Receive + join an invite (deep link or push).** A pushed `social.invite` lands in
`socialStore.invites`; the hub's 🔔 notification center renders it (and pending friend requests)
alongside a live count badge. Opening `<origin>/?invite=CODE` does the same thing without a socket:
`App.tsx` reads the query param once on load, and — once there's an account (logging in first if
needed) — resolves it via the unauthenticated `GET /invite/:code` (`resolveInvite`) and hands it to
`routeToInvite` (`apps/hub/src/platform/inviteRouting.ts`): wake the game (orchestrator), mint a
handoff token, navigate to `http://host:PORT/?pt=<handoff>&join=<room>`. Both paths — a friend's push
and a shared link — converge on the same `routeToInvite` call, so they behave identically. The query
param is stripped (`history.replaceState`) once consumed, whether or not resolution succeeded, so a
page refresh doesn't retrigger it.

> **Gap:** the *receiving* side (this flow) is real; the *sending* side has no real trigger yet.
> `createInvite`/`inviteFriend` aren't exposed on `mygame.social.*` (the framework-agnostic API a game
> would call), only on the React `useSocialStore` hook the hub uses directly — and the hub itself
> can't meaningfully invite "to the current game" since it stops tracking your session the moment you
> navigate into a game's own origin. Real "invite a friend to join me" has to be triggered by the game
> itself, from its own lobby/room UI, once `mygame.social` grows those methods.

**Start a DM / group.** `openChatWithUser` → `chat.openDm` (ack returns the conversation id,
found-or-created) → `openChat`. `createGroup` → `chat.createGroup` (ack) → `openChat`.

**Send a message.** `chatStore.sendMessage(conversationId, text)` → `chat.send` (ack) → server
persists + pushes `chat.message` to every participant (sender included, for multi-device echo), and a
refreshed `chat.threads` to each. Opening a conversation (`openChat`) fetches `chat.getHistory` and
fires `chat.markRead`, which advances the reader's `lastReadAt` and pushes `chat.read` to the other
participants so a dm sender's checkmarks update.

**Launch a game.** `handlePlay` → `enterGame(id)` (`POST /orchestrator/games/:id/enter`, best-effort)
→ `getHandoff()` → navigate to `http://host:PORT/?pt=<handoff>`. The game exchanges the token at its
own `/auth/platform` and federates the identity.

## Persistence

`@mygame/platform-db` provides the shared Postgres plumbing: `createPool`, `runMigrations` (the
platform schema — `accounts`, `friendships`, `invites`, `conversations`, `conversation_members`,
`messages`), and a `WriteQueue`. Each service has its own adapter next to its port
(`auth/src/pgStore.ts`, `social/src/pgStore.ts` + `social/src/pgInvites.ts`, `chat/src/pgStore.ts`).

> The `messages` table's shape changed (DM-only `sender/recipient/read_at` → `conversation_id`-based)
> when groups landed. That happened before this repo had real production data, so it was a plain
> additive `CREATE TABLE` (no `ALTER`) — anyone with an old local dev Postgres volume from testing
> DM-only chat should run `corepack pnpm infra:reset` before testing groups. By contrast, the
> `accounts` table already held real data by the time profile customization was added, so *that*
> migration genuinely uses `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` (`wallpaper`, `title_achievement`)
> — the first real use of ALTER in this schema, and the template for any future evolution of a table
> that already has rows worth keeping.

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
