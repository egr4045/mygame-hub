# Architecture

How the platform is put together: the services, the SDK, the hub, the contract between them, and the
main data flows. For *what works vs. what's mocked* see `STATUS.md`. Rewritten 2026-07-16 — the
previous version predated several shipped systems (achievement catalogs, suggestions, calls, the
mobile hub, Telegram ops) and still described a "find groups/lobbies" feature that's since been removed.

## Big picture

```
                 ┌─────────────────────────────────────────────┐
                 │  hub SPA (apps/hub)  — React + Zustand        │
                 │  AuthScreen → HubScreen (library/launcher)    │
                 │  embeds @mygame/sdk (overlay: friends/chat/…) │
                 └──┬───────────┬───────────────┬───────────┬───┴────────┐
                    │ HTTP      │ Socket.io      │ Socket.io │ HTTP      │ HTTP
                    ▼           ▼                ▼           ▼           ▼
             ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐ ┌───────────┐
             │ auth     │ │ social   │ │ chat     │ │ orchestrator │ │ community │
             │ JWT login│ │ friends +│ │ dm+group │ │ docker       │ │ changelog │
             │ +handoff │ │ presence │ │ +calls   │ │ compose      │ │ +forum    │
             │ +telegram│ │ +invites │ │ signaling│ │ per game     │ │ +settings │
             │ +achieve-│ │ +search  │ │          │ │              │ │ +suggest- │
             │ ment cat.│ │          │ │          │ │              │ │ ions      │
             └──────────┘ └──────────┘ └──────────┘ └──────┬───────┘ └───────────┘
                    ▲                                       │ docker
                    │ verifies platform JWT (iss: gamehub)   ▼
             ┌──────┴──────────────────────┐       per-game stacks
             │ a game on its own origin/   │       (CIVA, svoyak, cards, …)
             │ path — POST /auth/exchange  │
             └──────────────────────────────┘
```

Everything that crosses a platform boundary is a zod schema in `@mygame/protocol`. Services never
import each other's internals — only the contract. Voice/video calls run through a fifth piece of
infrastructure, GAMEHUB's own self-hosted **LiveKit** (not pictured above — `chat` mints room tokens
for it, the SDK's `callStore` connects to it directly over WebRTC).

## Services (`services/*`)

All five follow the same shape: a `createApp`/`createServer` that takes **ports** (deps) so the same
logic runs against real or in-memory adapters; an `index.ts` production entry; a `standalone.ts` for
isolated dev; a `config.ts` reading env. `auth`, `social`, `chat` and `community` are Postgres-backed
when `DATABASE_URL` is set, else fall back to in-memory. `orchestrator` is the exception — it controls
Docker, not a datastore.

**JWT issuer is `gamehub`** (`JWT_ISSUER` env, same default across every service — was `civa` until
2026-07-16; see `STATUS.md`'s recent-history note). All five services must run the same issuer value
or cross-service token verification breaks, not just client sessions — a deploy that touches
`JWT_ISSUER` redeploys every service together.

### auth (`services/auth`) — port 8081

Identity provider, and also owns achievements (unlocks + display catalogs), profile customization, and
playtime — all account-scoped data with no reason to be a separate service. Routes (`app.ts`):

- `POST /auth/register` / `POST /auth/login` `{ displayName, password }` → tokens.
- `POST /auth/refresh` `{ refreshToken }` → `{ accessToken }`.
- `POST /auth/handoff` `{ refreshToken }` → 120s `handoffToken` (see `SSO-FEDERATION.md`).
- `POST /auth/exchange` `{ handoffToken }` → full session on the *target* game's own origin. Server
  verifies signature + `typ==='handoff'` + account still exists; the client never decodes it.
- `POST /auth/telegram/link-code` / `GET /auth/telegram/status` / `POST /auth/social/login` — linking
  and cross-device login via the bot (see "Telegram" below).
- `POST/GET /auth/achievements` — idempotent grant / list unlocks, `{ gameId, achievementId }`.
- `PUT/GET /auth/achievements/catalog(/:gameId)` — register/read a game's display catalog (see
  "Achievement catalog registry" below).
- `PUT/GET /auth/profile/{avatar,wallpaper,title,favorites,password,display-name}` — self-service
  profile customization.
- `POST /auth/stats/{enter,heartbeat}` / `GET /auth/stats` — playtime (see below).
- **Admin** (Bearer + `isAdmin`, 403 otherwise): `GET /auth/admin/admins` (roster), `GET/…/:id
  /auth/admin/accounts` (paginated search / detail), `PUT .../role` (promote/demote, refuses to demote
  the last admin), `PUT .../ban`, `PUT .../display-name`, `POST`/`DELETE .../achievements` (grant/revoke
  on anyone's behalf), `DELETE .../avatar` / `.../wallpaper` (clear only).

JWTs are HS256 via `@mygame/auth-core`. Accounts live in `AccountStore` (real Postgres or in-memory).

**Telegram.** One bot (`@mygame_quiz_hub_bot`, token `TELEGRAM_BOT_TOKEN`/`OPS_ALERT_BOT_TOKEN` —
same value, two env var names for historical reasons), long-polled **only by `auth`** — Telegram allows
exactly one `getUpdates` poller per token, so `chat`'s disk monitor and `community`'s suggestion
notifier only ever *send* through the same token, never poll. `telegramLinking.ts` handles `/start
<code>` (binds the chat to an account) and `/login` (issues a cross-device login code); a bare `admin`
message (from anyone, first one wins) registers that chat as the **ops alert recipient**, shared by
every service's alerting (persisted in `ops_alert_recipient`, a single-row table).

**Achievements.** `Account.achievements: AccountAchievement[]` is a flat `{gameId, achievementId,
unlockedAt}` list — deliberately opaque so two games can reuse an id without colliding. Trust model:
the caller's own token authorizes the grant (same posture as chat DMs not being restricted to
friends) — a game that cares should grant from its own trusted backend.

**Achievement catalog registry.** Separate from unlocks: `achievement_definitions` (game_id,
achievement_id, name, description, icon, color, sort_order) is how a game tells the platform what an
achievement *looks like*. A game calls `mygame.achievements.registerCatalog([...])` once on boot
(idempotent full-replace of that game's rows); the hub fetches every registered catalog (public read,
cached client-side with stale-while-revalidate) and renders a real showcase — locked+unlocked, hover =
description — on that game's own page, and decorates the profile's flat unlocked-achievements list with
real names/icons instead of bare ids. CIVA's catalog is seeded directly in the migration (its own repo
isn't in this monorepo, so it can't self-register yet); `example-game` registers a demo catalog as the
reference implementation. This *replaced* an earlier design where each game (really: just the hub's
`ProfileView`) kept its own hardcoded local catalog — that only ever worked for one game.

**Profile (avatar/wallpaper/title).** Images are data URLs directly on the account row (no object
storage — see `docs/SERVER.md` for why, at this scale). `readJson` defaults to a 200KB body cap; the
two profile-image routes raise it to 4MB raw bytes, with the `dataUrl` field itself capped at 2.5M
characters by the zod schema. Title must reference an achievement the account actually holds
(server-validated) — since the catalog registry landed, a title can reference *any* game's achievement,
not just one hardcoded game.

**Playtime (`game_stats`).** `POST /auth/stats/enter` stamps `last_played_at` on launch (hub calls it,
best-effort). `seconds_played` accrues from `POST /auth/stats/heartbeat`, called **from inside the
running game** (`mygame.stats`, auto-started by `mygame.init()`, ~30s interval, paused when the tab
isn't visible) — the hub can't time a session itself since it's a full-page navigation away. The server
computes credited duration, clamping each heartbeat's delta to ~60s so a missed beat/crash/backgrounded
tab never over-credits.

**Admin.** `isAdmin` is a plain boolean on the shared `accounts` table. The *first* admin is
bootstrapped via `AUTH_BOOTSTRAP_ADMIN_IDS` (comma-separated accountIds, checked once at boot,
idempotent); every admin after that is promoted/demoted from inside `apps/admin` itself, guarded
against demoting the last remaining admin.

### social (`services/social`) — port 8083

Socket.io server layering live presence over a durable friendship graph.

- **Auth:** every socket handshake carries the platform access token; `io.use(...)` verifies and binds
  the socket to `accountId`.
- **Socket path:** `/social.io/`, not the default `/socket.io/` (reserved for a game's own lobby
  socket on the same shared production origin). `chat` reserves `/chat.io/` for the same reason.
- **Graph:** `SocialStore` — undirected edges keyed by sorted account pair, with a `by` field for
  pending direction.
- **Presence/activity:** held in `server.ts` maps (`socketsOf`, `activityOf`), recomputed live —
  online = has ≥1 connected socket.
- **Profile mirroring:** `avatarIcon`/`titleAchievement` mirrored **read-only** from the shared
  `accounts` table `auth` owns, re-read on every socket connect (no live cross-service push).
- **Push model:** on any change, the server pushes the **full** friends list (presence + activity
  resolved) to the affected account and everyone it has an edge with.
- **Search (`social.search`).** Finds accounts by display-name substring or friend code, ranked with
  an exact code match first. Annotates the caller's relation to each hit (`self`/`friend`/`incoming`/
  `outgoing`/`none`) so the UI can show add/pending/already-friends without a second round trip; blocked
  accounts (either direction) are filtered out.
- **C2S/S2C events:** see `protocol/src/social.ts` — `request`, `search`, `accept`, `decline`,
  `remove`, `setActivity`, `getState`, `createInvite`, `inviteFriend`, `block`/`unblock`/`getBlocked` /
  `friends`, `me`, `invite`, `error`.
- **Invites:** `InviteStore` mints opaque random codes (1h TTL) resolving to `{game, room, role,
  inviter}`. Public `GET /invite/:code` resolves a code before any socket exists (for deep links).
- **~~Find groups / lobbies~~ — removed.** `social.getLobbies` used to derive joinable rooms live from
  presence (`activity.joinable`). Removed by request: it could show a "joinable" game even while that
  game was itself unreachable (maintenance), and games are expected to build their own matchmaking.
  Nothing in the platform replaces it — see `STATUS.md`.

### chat (`services/chat`) — port 8084

Socket.io server for **direct messages, groups, and call signaling**, unified as a single
`Conversation` concept (a DM is a 2-member conversation). Also owns the platform's shared upload store
and, opportunistically, the disk-space ops monitor (see below — proximity to the Postgres pool and the
upload filesystem beats a separate always-on process on this RAM-constrained shared host).

- **A DM is found-or-created** via `openDm(a, b)`. A **group** is created via `createGroup(creator,
  name, memberIds)`; membership and roles change afterward (`addMembers`/`removeMember`/`setGroupRole`).
- **Groups have an owner + promotable admins.** Any current member may add others. Removing yourself
  (leave) is always allowed; removing someone *else*, pinning a message, or renaming/re-avataring the
  group needs owner-or-admin — enforced server-side, not just the UI. Ownership doesn't transfer when
  the owner leaves (a documented v1 limitation).
- **Edit / delete are real.** Edit is sender-only, rejected on an already-deleted message. Delete is a
  **tombstone** (`deleted_at` + blanked text/attachments) — own messages always, someone else's only
  for a group owner/admin — so reply chains and message ordering survive; the client renders "Сообщение
  удалено" in place. `reply_to_id` links a message to the one it's quoting.
- **History pagination:** `getHistory` takes a `before` cursor (createdAt-based), returns `hasMore`.
- **Read state is per-member** (`lastReadAt`), not per-message — scales to N-member groups without a
  combinatorial "read by whom" per message. Read receipts render dm-only (`sent`|`read`).
- **Typing indicators:** throttled client-side, auto-expire server-side if a client goes silent.
- **Uploads:** `POST /chat/upload` (auth'd, participant-checked, 50MB cap via `CHAT_UPLOAD_MAX_BYTES`)
  → `GET /chat/media/:file` (public capability URL, filename validated by a strict regex against path
  traversal). Files live on a durable named volume (`gamehub-chat-uploads`), not container-ephemeral fs.
- **Retention:** messages older than `CHAT_RETENTION_DAYS` (default 30) are pruned daily, always
  keeping each conversation's most recent message so its thread preview never goes empty.
- **Rate limiting:** in-memory token buckets per accountId — send/edit/delete, typing, call signaling,
  and the upload/call-token HTTP routes all have separate limits.
- **C2S/S2C events:** see `protocol/src/chat.ts` — `openDm`, `createGroup`, `addMembers`,
  `removeMember`, `setGroupRole`, `updateGroupProfile`, `pinMessage`, `send`, `edit`, `delete`,
  `markRead`, `getHistory`, `getState`, `callRing`/`callAccept`/`callDecline`/`callHangup`, `typing` /
  `threads`, `message`, `messageEdited`, `messageDeleted`, `read`, `callState`, `typing`, `error`.

**Call signaling.** Ring/accept/decline/hangup lives here (ephemeral, in-memory, mirrors how
presence/activity work — not persisted). `callState` pushes the *live roster* of who's in a
conversation's call to every member, Discord-style, whenever it changes. `POST /chat/call/token` mints
a room-scoped LiveKit access token once the caller is confirmed to be a participant; the SDK's
`callStore` owns the actual media (join/leave, mic/cam/screenshare, remote track attachment) — chat only
ever signals *who's ringing/in a call*, never touches the media itself. See "Calls" under the SDK
section for the media-layer half of this.

**Ops: disk-space monitor.** Watches the upload volume's free space (`fs.statfs`, hysteresis so
crossing the threshold doesn't spam alert/recovered pairs) and DMs the shared ops recipient (see
"Telegram" under `auth`) below a configurable threshold. Send-only — never polls.

### orchestrator (`services/orchestrator`) — port 8090

Wakes a game when a player enters and reaps it when idle, so empty games burn no RAM.

- `Orchestrator` is pure control logic over ports — testable without Docker. `ensureUp(id)` is
  idempotent and concurrency-safe.
- **Ports:** `ContainerRuntime` (shells `docker compose up/stop/ps`), `ActivityProbe` (polls a game's
  `/metrics` for `{players}`).
- **Reaper:** stops any non-`alwaysOn` game that's sat at zero players past `idleMs` (default 10 min).
- **Routes:** `GET /games`, `POST /games/:id/enter` (public), `POST /games/:id/stop` (admin-only
  force-stop, bypasses the idle timer; 501s if no `DATABASE_URL` to check `isAdmin` against, rather
  than allowing an unauthenticated force-stop), `GET /health`.
- **Manifest:** games declared in `config.ts` (`defaultGames()`) — compose dir/project, activity URL,
  idle policy. Adding a game is one manifest entry + its own `deploy/<game>` compose.

### community (`services/community`) — port 8085

Per-game changelog, discussion forum, platform branding/contact settings, and the player suggestions
queue. A separate service from `auth`/`social`/`chat` — unbounded, low-trust user-generated content with
its own moderation profile, kept out of the security-critical identity process.

- **Trust model, three postures in one service:** changelog **writes** are admin-gated (curated patch
  notes, not user content) while **reads** are public; discussion threads/posts use the platform's
  normal "your own token authorizes it" posture, same as chat/achievements, with admin-gated soft-delete
  moderation; **suggestions** are submit-by-anyone-logged-in, triage-by-admin-only.
- **Routes:** `GET/POST /community/changelog(/:gameId)`, `PUT/DELETE /community/changelog/:id`
  (admin); `GET /community/threads(/:gameId)(/:threadId)`, `POST /community/threads`, `POST
  /community/posts`, `DELETE /community/threads/:id` / `.../posts/:id` (admin, soft-delete); `POST
  /community/suggestions`, `GET /community/admin/suggestions`, `PATCH
  /community/admin/suggestions/:id` (admin, status transitions); `GET/PUT /community/admin/settings`
  (a small fixed key-value set — branding/contact fields, per-game status overrides, notification-sound
  overrides); `GET /health`.
- **Suggestions.** `suggestions` table (`id, authorId, authorName, body, status, createdAt, updatedAt`),
  status one of `new`/`accepted`/`rejected`/`implemented`. Submitting pings the shared Telegram ops
  recipient (send-only, same token/recipient as the disk monitor) with the idea's text and a deep link
  straight into `apps/admin`'s Suggestions tab (`/admin/#suggestions` — the admin app reads the URL hash
  on load to land there directly).
- **Platform settings (`platform_settings`, key-value):** `brand_name`/`support_email`/`tos_url`
  (branding), `game_status_overrides` (a JSON map admin can use to flip a game playable/soon/maintenance
  without a redeploy — applied by the hub on boot), `sound_message`/`sound_call`/`sound_achievement`
  (admin-uploaded notification sound overrides, data URLs). Write body cap is raised to 1.5MB to allow
  a small uploaded sound file through.
- Postgres-backed when `DATABASE_URL` is set, in-memory fallback otherwise.

## SDK (`packages/sdk` → `@mygame/sdk`)

The framework-agnostic client a game embeds, plus the overlay the hub also uses. Built to be usable by
third-party games: dual ESM/CJS plus a global IIFE (`window.mygame`) for non-bundler consumers, React
as a peer dependency, self-mounting Shadow-DOM overlay.

- **`client.ts`** — the `mygame` singleton. `mygame.init(gameId, {hubUrl})` configures endpoints,
  mounts the overlay, opens social+chat, resumes any portable call, starts the playtime heartbeat, and
  wires the socket auto-revive listeners (below). Sub-APIs:
  - `auth` — `getAccount`, `getToken`, `login`, `register`, `logout`, `getHandoff` (mint),
    `loginWithToken` (redeem — the SSO half a game embedding the SDK calls), `adoptSession` (for a game
    whose own *server* redeemed the handoff and hands the browser a ready-made session — no second
    exchange; used by Svoyak's `/auth/platform-bridge` pattern).
  - `social` — `getMe`, `getFriends`, `addByCode`, `setActivity`, `subscribe`.
  - `chat` — `open`, `openWithUser`, `createGroup`, `addMembers`, `removeMember`, `leaveGroup`, `send`,
    `getThreads`, `getUnreadCount`, `subscribe`. A game can rely on the SDK-shipped `ChatWidget` or
    build its own UI on this data.
  - `call` — the **media** half of calls (`callStore` underneath — see "Calls" below):
    `joinGameRoom(game, room, opts)`, `joinConversation(conversationId, opts)`, `leave()`
    (signaling-aware — an active conversation call hangs up through the chat socket, a game-room call
    just drops media), `setMic`/`setCam`/`setScreenShare`, `setVolume`/`setMuted` (local playback only),
    `attachVideo(accountId, el)` (returns a detach fn), `setEmbedded(bool)` (host game renders video
    itself; SDK keeps only audio), `bindToRoom({game, room})` (host aliases a game room onto their
    conversation call), `inviteToGame(invite)` (push a "come play" invite over the data channel),
    `dismissInvite`, `resume()` (re-join the call this browser was in before a navigation — `init()`
    calls this automatically), `getState()`, `subscribe`.
  - `achievements` — `grant(id)` (scoped to `this.gameId`, fires a sound+toast on a genuinely new
    unlock), `list()` (every game's unlocks), `registerCatalog(defs)` (register this game's display
    catalog — see "Achievement catalog registry" under `auth` above).
  - `profile` — `get`, `setAvatar`, `setWallpaper`, `setTitle(ref|null)` (server-validated).
  - `stats` — `recordEnter`, `getStats`, `startHeartbeat`/`stopHeartbeat` (the latter two run
    automatically from `init()`/`auth.logout()`).
  - `community` — `getChangelog`, `getThreads`, `getThread`, `createThread`, `createPost` — all
    default `gameId` to `this.gameId` from `init()`.
  - `ui` — context menu, toasts.
  The plain functions behind each namespace (`grantAchievement`, `registerAchievementCatalog`,
  `getProfile`, `createSuggestion`, etc.) are also exported directly for a caller that hasn't called
  `init()` — the hub uses those, since it never calls `init()` itself (see "Hub" below).
- **Socket auto-revive.** A backgrounded/slept tab kills the websockets; socket.io's own reconnect
  reuses the stale (15-min) access token and can't recover. `visibilitychange`/`online`/`pageshow`
  listeners (wired in `init()` and separately in the hub's `App.tsx`, since the hub doesn't call
  `init()`) mint a fresh token via `connect()` and resume any call — no manual reload needed.
- **`config.ts`** — runtime endpoints. Dev → `localhost:8081/8083/8084/8085`; prod → same origin.
- **`authClient.ts`** — session persistence in `localStorage` under the key `gamehub.session` (was
  `civa.session` — see `STATUS.md`'s recent-history note), plus the handoff mint/redeem pair and every
  achievement/profile/catalog HTTP helper. `freshAccessToken` (re-mints from the stored session) is
  exported for sibling clients (`statsClient.ts`, `communityClient.ts`, `apps/admin`'s `adminClient.ts`).
- **`sound.ts`** — WebAudio-synthesized notification sounds (message/call/achievement), each
  overridable with a real audio file via `setCustomSound(kind, url)` (the hub wires this to
  admin-uploaded overrides from `platform_settings`). Respects a master volume from
  `notificationPrefsStore`.
- **State (Zustand):** `socialStore`, `chatStore`, `callStore` (own Socket.io/LiveKit connections),
  `menuStore`, `toastStore`, `notificationPrefsStore`.
- **Overlay (`overlay/mount.tsx`, `components/*`)** — self-mounting Shadow-DOM overlay rendering
  `MygameOverlay` (toasts, context menu, `ChatWidget`, `FriendsWidget`, `CallView`) so a game gets the
  platform's full social+call UI with zero UI code of its own. Host is click-through
  (`pointer-events:none`); interactive components re-enable it on their own root.
- **`ChatWidget`** — a small launcher button (unread badge) when closed, a full draggable/resizable
  messenger when open: DM+group list, reply/edit/delete/pin via a message context menu, member
  management, an "other player" profile popover (`UserProfileModal`, shared with the friends sidebar and
  mobile — no more than one profile-card implementation in the codebase).
- **`FriendsWidget`/`FriendsSidebar`** — one movable launcher pill (not two separate buttons anymore);
  live search-as-you-type by nick or code with relation-aware actions; the same shared
  `UserProfileModal` on click.
- **`CallView`** — the floating call surface (draggable, connected/ringing states), or fully chromeless
  when `setEmbedded(true)` (a host game renders its own video, the SDK keeps only the audio pipeline
  mounted so `<RoomAudioRenderer/>` never unmounts mid-call).
- Built with `tsup` for external consumption — dual ESM/CJS + a browser-targeted IIFE (`platform:
  'browser'` in `tsup.config.ts`; without it the IIFE leaks `process`/`require('fs')` references that
  throw in an actual browser).

## Example game (`apps/example-game`)

A minimal Vite+React app — living documentation for a third-party game developer, not a real game.
Path-routed at `mygame-quiz.ru/example-game/`. Reference implementation of: SSO handoff redemption
(`?pt=` → `mygame.auth.loginWithToken`, falling back to its own login form if opened directly),
achievement grant + **catalog registration** (registers a small demo catalog on boot so the platform
achievement showcase has a second game to show besides CIVA), playtime, changelog/discussions, and the
chat/friends overlay.

## Admin panel (`apps/admin`)

A standalone React+Vite SPA, path-routed at `mygame-quiz.ru/admin/`. Logs in with the SDK's plain
`login`/`register` — an admin account is an ordinary account; there's no separate credential and no
client-side-only gate. One upfront check (`GET /auth/admin/admins`, 200 vs 403) decides whether to show
the app shell; every individual route re-checks `isAdmin` server-side on top of that.

- **Dashboard.** Live per-service health (pings every service's own public `/health`, client-side).
- **Games.** Per-game changelog CRUD, discussion moderation (soft-delete), a live lobby table that can
  force-stop a running game, per-game **status override** (playable/soon/maintenance, no redeploy
  needed — applied by the hub on next boot), notification-**sound** upload (message/call/achievement,
  stored as a data URL in `platform_settings`).
- **Users.** Paginated/searchable account list + detail view (profile, achievements, playtime); ban,
  clear avatar/wallpaper, grant/revoke an achievement on someone's behalf (support-ticket case).
- **Suggestions.** Filterable list of player-submitted ideas; move each through
  new→accepted/rejected/implemented. Deep-linked from the Telegram new-suggestion alert via a URL hash
  the app reads on load (`/admin/#suggestions`).
- **Settings.** Admin roster (promote by accountId; can't demote the last admin), branding/contact
  key-value settings, notification-sound overrides (same upload UI as under Games, exposed twice since
  it's genuinely a "settings" concern too).

## Hub (`apps/hub`)

React + Vite SPA. `App.tsx` routes on session: no account → `AuthScreen`, else `HubScreen`. Below a
768px viewport, `HubScreen` renders a dedicated `MobileHub` shell instead (bottom tab bar — Игры/
Друзья/Профиль — full-screen game details, its own friends/profile surfaces built on the same stores as
desktop, no logic duplicated) rather than squeezing the desktop layout.

- **`platform/platformStore.ts`** — the account session (read synchronously from `localStorage` at
  store-creation time, so the very first render already knows you're logged in — no `AuthScreen` flash
  on the full-page reload that follows returning from a game) + selected game.
- **`platform/games.ts`** — the front-end game registry; `path` (same-origin, HTTPS, preferred) or
  `externalPort` (its own port — the dev fallback, and the *only* option for a game that hasn't moved to
  path-based routing, like CIVA today) marks how to reach a game. `applyGameStatusOverrides()` mutates
  the registry in place from the admin-controlled `platform_settings` value.
- **Boot performance:** `index.html` ships an instant CSS-only skeleton (topbar/rail/hero/card-grid
  shimmer) that paints before the JS bundle parses — removed once React commits, with an 8s safety
  timeout. Admin-controlled settings and achievement catalogs apply from a `localStorage` cache
  immediately on load, then revalidate over the network. Vite's content-hashed `/assets/*` get a
  year-long immutable `Cache-Control` (the gateway's Caddyfile), so a repeat load skips the network for
  the bundle entirely.
- Social/chat/call/menu/toast come from `@mygame/sdk` stores (single source shared with embedded
  games). `ChatWidget`/`FriendsWidget`/`CallView` are imported straight from `@mygame/sdk` — `HubScreen`
  (and `MobileHub`) render them directly in their own tree; `MygameOverlay` renders the *same*
  components for embedded games via the Shadow-DOM mount. One component each, two mounting paths.

> **The hub never calls `mygame.init()`.** It wires `socialStore`/`chatStore`/`callStore` directly
> (`App.tsx`) instead, so `mygame.gameId` is always `null` there. Anything gated on `this.gameId` (e.g.
> `mygame.achievements.grant`, scoped to "the current game") won't work from hub-side code for that
> reason — the hub calls the lower-level exported functions directly, passing whatever game id is
> relevant explicitly (e.g. achievement/profile calls on the game the viewed page is for). This only
> matters for hub-side code; a real embedded game that calls `init()` doesn't hit this. The hub also
> separately wires the socket-auto-revive listeners `init()` would otherwise provide.

## Contract (`packages/protocol` → `@mygame/protocol`)

The single source of truth for platform wire messages: `auth.ts`, `social.ts`, `chat.ts`,
`achievements.ts` (unlocks + the catalog-registration schemas), `stats.ts`, `community.ts` (changelog/
discussions/suggestions/settings), `admin.ts`, `invite.ts`, `envelope.ts`, `errors.ts`. Per-game
protocols live in each game's own repo and may re-export these primitives. `admin.ts` is the odd one
out — its schemas back routes served by three different services (`auth`, `community`, `orchestrator`),
unified here because every one of those routes shares the same `isAdmin` gate.

## Supporting packages

- **`auth-core`** — HS256 sign/verify (`jose`), `TokenError` with a `reason`. Issuer mismatch is a hard
  reject (`jwtVerify(token, key, {issuer})`) — this is the exact mechanism that makes the `JWT_ISSUER`
  value a platform-wide coordinated-deploy concern, not a per-service knob.
- **`shared-types`** — infrastructure ports (`Clock`, `Logger`, `EventBus`) used everywhere. Used to
  also carry CIVA's own 4X-game domain vocabulary (resources/biomes/buildings/units/tech/diplomacy) from
  when this repo was still a fork of CIVA's own, before the platform/game split — removed 2026-07-16
  after confirming zero platform usages (see `STATUS.md`'s recent-history note).
- **`telegram`** — minimal Bot API client (long-poll `getUpdates`, `sendMessage`). Imported by `auth`
  (the sole poller) and `community`/`chat` (send-only).
- **`ui-kit`** — design tokens (`--c-*` CSS variables via `injectTheme()`).
- **`test-harness`** — in-memory fakes for standalone/contract tests.

## Key data flows

**Login.** Hub `AuthScreen` → `platformStore.login` → `sdk.authClient.login` → `POST /auth/login` →
session saved to `localStorage` (`gamehub.session`) → `App` opens social/chat.

**Friends/presence.** `socialStore.connect()` refreshes the access token, opens the Socket.io
connection, renders whatever `social.friends` the server pushes.

**Find a friend to add.** Typing in the add-friend box debounces into `social.search`; results are
relation-annotated so the UI shows the right action per row without a second call. Selecting a result
(or a friend row anywhere) opens `UserProfileModal`, the one shared profile-card component.

**Launch a game.** `handlePlay` → `recordGameEnter(id)` (best-effort) → `enterGame(id)` (orchestrator
wake, best-effort) → `getHandoff()` → navigate to the game's origin/path with `?pt=<handoff>`. The game
redeems it via `mygame.auth.loginWithToken` (`POST /auth/exchange`) to establish the same identity on
its own origin; `mygame.init()` then starts the playtime heartbeat and resumes any portable call.

**Send a message.** `chatStore.sendMessage` → `chat.send` (ack) → server persists + pushes
`chat.message` to every participant (sender included, for multi-device echo) + a refreshed
`chat.threads`. Edit/delete follow the same shape (`chat.edit`/`chat.delete` → `chat.messageEdited`/
`chat.messageDeleted` pushed to every participant).

**Start or join a call.** Conversation call: `chat.callRing` → the recipient's client shows a ringing UI
→ `chat.callAccept` joins the LiveKit room (media via `callStore.joinConversation`) → `chat.callState`
keeps everyone's live participant roster in sync. Game-room call: `mygame.call.joinGameRoom(game, room)`
joins/creates a LiveKit room named `game:<game>:<room>` directly — no chat signaling involved, since
there's no "conversation" to ring. A host can bridge the two with `bindToRoom`, so a game-side joiner
lands in the same room as their conversation call.

**Unlock + display an achievement.** `mygame.achievements.grant(id)` → `POST /auth/achievements` →
idempotent grant, sound + toast on a genuine new unlock → the hub's profile/game-page reads
`GET /auth/achievements` (unlocks) and cross-references the cached catalog registry (names/icons) to
render them — two independent reads joined client-side, not one combined endpoint, since unlocks are
per-account and catalogs are per-game-global with very different cache lifetimes.

**Submit a suggestion.** Hub/mobile "Связь с автором" → `createSuggestion(body)` → `POST
/community/suggestions` → stored `status:'new'` → community pings the shared Telegram ops recipient with
a deep link into `/admin/#suggestions`. Admin triages via `PATCH /community/admin/suggestions/:id`.

**Find a lobby / report activity.** A game calls `mygame.social.setActivity({game, gameName, room,
joinable})` when its room is open to join — this still drives presence display ("Играет в X") and
join-a-friend's-activity, but the platform no longer offers a *query* over joinable rooms (`getLobbies`
removed — see the `social` section above); a friend must be joined via their live activity/invite, not
browsed via a lobby list.

## Persistence

`@mygame/platform-db` provides the shared Postgres plumbing: `createPool`, `runMigrations` (the
platform schema — `accounts`, `friendships`, `invites`, `conversations`, `conversation_members`,
`messages`, `game_stats`, `achievement_definitions`, `changelog`, `discussion_threads`,
`discussion_posts`, `suggestions`, `platform_settings`, `ops_alert_recipient`), and a `WriteQueue`. Each
service has its own adapter next to its port.

**Write-behind model.** The in-memory store stays authoritative for **reads** (the hot friends/presence/
chat path is synchronous and fast). Every **write** also goes to Postgres through the `WriteQueue` —
ordered, non-blocking, errors logged not thrown. On boot each adapter's `init()` hydrates memory from
the DB. A restart no longer loses data. Trade-off: a crash in the gap between the in-memory write and
the DB write can lose that single write — acceptable for now, `WriteQueue.drain()` exists for
graceful-shutdown flushing.

**Wiring.** Production entries use Postgres when `DATABASE_URL` is set, else in-memory with a loud
warning; `standalone.ts` is always in-memory. The `accounts` table is shared: `auth` is authoritative
for profile fields; `social`/`chat` only refresh `display_name`/mirror avatar+title. `game_stats` and
`achievement_definitions` are auth-only; `changelog`/`discussion_*`/`suggestions`/`platform_settings`
are community-only. Postgres user/db/password are `civa`/`civa`/`civa` — an internal credential name
predating the platform/game split, left unchanged (see `STATUS.md`; unlike the JWT issuer/session key,
renaming a live database credential needs an actual migration, not a drive-by edit).

> **Open gap: the `password_hash` migration has no recovery path for pre-existing accounts.** Login
> moved from passwordless to password-based after `accounts` already had real rows; the migration
> backfills `password_hash` to `''` then makes it `NOT NULL`, and an empty hash can never verify — so
> any account from before this migration is permanently locked out, with no reclaim path implemented.
> See `STATUS.md`'s Known Gaps.
