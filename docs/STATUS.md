# Platform status — what actually works

> Audited 2026-07-11 against the code on branch `refactor/hub-split`. This is the source of truth for
> "is this real or a mock". Update it whenever a mock becomes real.

## Legend

- ✅ **Real** — backed by a working service.
- 🟡 **Partial** — works, but **in-memory only** (lost on restart) *or* the frontend is ready and the
  backend is a stub.
- ❌ **Mock** — UI only, no backend at all (hardcoded data / `alert()` / local state).

## Summary

The **social skeleton** of the platform (identity + friends + launcher + chat + achievements +
profile) is real, working, and Postgres-persisted. The Steam-style *store content* around it
(changelog, forum, lobby browser, playtime stats) is now real too — the hub's frontend mocks were
replaced with a new `services/community` (changelog + discussions), a `game_stats` slice on `auth`
(playtime, driven by an in-game SDK heartbeat), and a presence-derived lobby query on `social`. A
runnable starter (`apps/example-game`) exercises the whole SDK surface end-to-end. A standalone
`apps/admin` panel (path-routed at `/admin/`, gated server-side by an `is_admin` account flag) now
covers game/user/settings management. Voice/video calls
now run on GAMEHUB's own self-hosted LiveKit. What's left is a couple of genuinely unimplemented
pieces (VK linking, chat reactions) and lower-priority UI polish (profile status, "Связь с автором"
idea box).

## Features

| Feature | Status | Reality |
|---|---|---|
| Account login | 🟢 | Real backend (`services/auth`, real HS256 JWT access/refresh). Login requires a password. "Регистрация" and "Авторизация" are fully implemented. |
| Account persistence | ✅ | Postgres-backed when `DATABASE_URL` is set (`services/auth/src/pgStore.ts`): accounts survive restart, ids stay stable (durable SSO identity). Falls back to in-memory with a loud warning when unset (and in `standalone`). |
| Admin panel (`apps/admin`) | ✅ | Real, already-deployed standalone app, path-routed at `/admin/` on the same origin (same pattern as `example-game`'s `/example-game/` — see `deploy/gamehub/docker-compose.yml` + `Caddyfile`). Login is the same password register/login flow every player uses; access is gated **server-side** by the account's `is_admin` boolean (`services/auth`'s `requireAdmin` → 403 if logged in but not an admin), not a client-side check. The first admin(s) are bootstrapped via `AUTH_BOOTSTRAP_ADMIN_IDS` (comma-separated accountIds, checked once at boot, idempotent — replaces the old single-purpose `COMMUNITY_ADMIN_IDS`, fully removed); every admin after that is promoted/demoted from inside the app itself (`PUT /auth/admin/accounts/:id/role`, with a server-side guard against demoting the last remaining admin). Ships: game management (changelog CRUD, discussion moderation, achievement grant/revoke, orchestrator force-stop of a running game), user management (search/list/detail, clear avatar/wallpaper, grant/revoke achievements), and general settings (admin roster promote/demote, a live per-service health dashboard, branding/contact key-value settings). |
| SSO handoff into a game | ✅ | `POST /auth/handoff` mints a short-lived (120s) token; the hub passes it via `?pt=` (`HubScreen.tsx`). The game's own origin redeems it via auth's own `POST /auth/exchange` (there is no separate `/auth/platform` route — every game exchanges against the same auth service) for a full session; the server verifies the token signature, `typ === "handoff"`, and that the account still exists (404 if not) — the client never decodes/trusts the JWT itself. SDK surface: `authClient.exchangeHandoff` / `mygame.auth.loginWithToken` (see `apps/example-game/src/App.tsx`'s `pt=` handling for the reference implementation). See `SSO-FEDERATION.md`. |
| Telegram account linking | ✅ | Real bot (`services/auth/src/telegram.ts` long-poll + `telegramLinking.ts`), gated on `TELEGRAM_BOT_TOKEN`. Hub profile → `POST /auth/telegram/link-code` → open bot `/start <code>` → binds `accounts.telegram_id` (persisted). Status via `GET /auth/telegram/status`. |
| Login from another device (Telegram) | ✅ | Send `/login` to the bot → one-time code → enter it on the auth screen (`POST /auth/social/login`) → full session for the linked account. |
| VK account linking | ❌ | Deferred by request. Button shows "(скоро)". |
| Friends list (add/accept/decline/remove) | ✅ | Real Socket.io backend (`services/social`). Account id doubles as friend code. |
| Presence (online/offline/in-game) | ✅ | Computed from live socket connections; activity is pushed to friends. |
| Friends persistence | ✅ | Postgres-backed when `DATABASE_URL` is set (`services/social/src/pgStore.ts`): the friendship graph survives restart. Falls back to in-memory (warning) when unset / in `standalone`. |
| Friend avatar / title visible to others | ✅ | Real: `social`'s `Friend`/`me` payloads carry `avatarIcon`/`titleAchievement`, mirrored (read-only) from the shared `accounts` table `auth` owns. Refreshed on every socket connect (`refreshProfile`, gated on `DATABASE_URL` — a no-op in pure in-memory mode, so avatar/title stay `null` there). `FriendsSidebar` renders the avatar image directly and a generic 🏅 indicator when a friend has a title equipped (no name/icon — that needs a per-game display catalog the SDK deliberately doesn't own). Propagation is reconnect-driven, not live-pushed: an already-connected friend sees your new avatar once *you* reconnect, same staleness profile as a display-name change today. |
| Invite codes | ✅ | Real: mint a code, resolve via `GET /invite/:code`, push an invite to a friend's socket. Postgres-backed when `DATABASE_URL` is set (`pgInvites.ts`), 1h TTL; in-memory fallback otherwise. |
| Invite **links** (deep-link join) | ✅ | `App.tsx` reads `?invite=CODE` on load, resolves it (`resolveInvite`), and — once logged in — auto-wakes the game, mints a handoff token, and navigates (`routeToInvite`). Works whether the code came from a link someone shared or a push notification. **Creating** a shareable link/pushing one to a friend has no dedicated UI yet — `createInvite`/`inviteFriend` are only exercised via a demo button and the (still-mock) "invite to game" friend-menu item; see `ARCHITECTURE.md`. |
| Chat: DMs + groups | ✅ | Real backend: `services/chat` (Socket.io + JWT, mirrors `social`). Unified `Conversation` model (dm = 2-member conversation, group = named, membership changeable post-creation — see the row below). Send/receive, persisted history, unread counts, read receipts (dm only). Postgres-backed when `DATABASE_URL` is set, in-memory fallback otherwise. |
| Chat widget ships with `@mygame/sdk` | ✅ | The chat UI (`ChatWidget`) lives in `packages/sdk/src/components/`, not the hub — it's rendered by the SDK's self-mounting overlay (`mountOverlay()` → `MygameOverlay`), so **any game embedding the SDK gets a working chat window + launcher button automatically**, no UI code required. The hub renders the same component directly (not through the overlay). `mygame.chat.*` also exposes a full imperative API (`createGroup`, `addMembers`, `removeMember`, `leaveGroup`, `send`, `getThreads`, `getUnreadCount`, `subscribe`) for a game that wants to build its own UI on the data instead. |
| Friends widget ships with `@mygame/sdk` | ✅ | `FriendsWidget`/`FriendsSidebar` moved from the hub into `packages/sdk/src/components/` and render from `MygameOverlay` too — same treatment as chat. "Invite to current game" lost its (already-mock, hub-only) disabled-state gating in the move — see `ARCHITECTURE.md`. |
| Group membership management | ✅ | Real: any current member may add others (`ChatWidget`'s "➕" reuses the create-group friend-picker, scoped to friends not already in the group); any member may remove themselves (leave, "🚪" in the group header); only the group's owner (creator, `ownerId`) may remove someone else — enforced server-side in `services/chat/src/server.ts`, not just in the UI. Kicking a *specific* member has no dedicated button yet (the backend/`mygame.chat.removeMember` API supports it) — only leave + add got UI this pass. |
| Chat reactions / edit / delete / typing indicators | ❌ | Dropped from the real backend for v1 scope. Message context-menu actions (reply/edit/delete) are still `alert(...)`. |
| Voice / video calls | ✅ | Real: GAMEHUB's own self-hosted LiveKit (separate from Leaders' own instance — see `docs/SERVER.md`). Signaling (`chat.callRing/callAccept/callDecline/callHangup`) is ephemeral, live-only (not persisted, mirrors how presence/activity work) — `services/chat/src/server.ts` tracks it in memory only. `POST /chat/call/token` (plain HTTP, bearer JWT) mints a room-scoped LiveKit access token once the caller is confirmed to be a participant of that conversation; the SDK (`chatStore.ts`) connects via `livekit-client`, publishes mic/cam, and `ChatWidget.tsx` attaches real `<video>`/`<audio>` elements from LiveKit's own track events (no more `CALL VIEW MOCK`). Supports audio, video, and group calls (multiple participants in one LiveKit room per conversation). |
| Achievements | 🟡 | Real API: `POST/GET /auth/achievements` on `services/auth` (idempotent grant, scoped per `gameId`+`achievementId`, persisted via the account store). `mygame.achievements.grant/list` in the SDK; a genuinely new unlock fires a toast automatically. **But** the display catalog (name/description/icon per achievement) is still a hardcoded local array in `ProfileView.tsx` — the platform only knows *that* an id is unlocked, not how to describe it (inherently a per-game concern; see `ARCHITECTURE.md`). |
| Profile avatar / wallpaper / title | ✅ | Real: `PUT/GET /auth/profile/{avatar,wallpaper,title}` on `services/auth`, persisted on the account row as data URLs (no object storage exists — see `ARCHITECTURE.md` for the size cap and why). Title must reference an achievement the account actually has unlocked (server validates). `mygame.profile.*` in the SDK. Survives reload/restart (Postgres-backed like the rest of the account). |
| Notifications (toasts) | 🟡 | Toast mechanism is real. `mygame.achievements.grant()` fires one automatically on a genuinely new unlock (real, for any SDK consumer) — but the hub's own achievement/message demo buttons trigger it manually rather than from a real chat/achievement event reaching the hub. |
| Notification center (🔔) | ✅ | Real: shows incoming friend requests (click = accept) and pushed game invites (click = join, via `routeToInvite`) with a live count badge. Falls back to "Нет новых уведомлений" when both are empty. "Настройки уведомлений" is still `alert(...)`. |
| Game library | ✅ | Real static registry (`apps/hub/src/platform/games.ts`), mirrors the orchestrator manifest. |
| Game launch / orchestrator | ✅ | `services/orchestrator` really runs `docker compose up/stop`, wakes a game on entry, reaps it on idle (reaper polls each game's `/metrics`). Hub calls `POST /orchestrator/games/:id/enter`. |
| SDK starter template | ✅ | `apps/example-game` — a minimal Vite+React app exercising the full SDK surface (handoff login, achievements, activity/lobbies, chat/friends overlay, playtime, changelog/discussions). Doubles as living documentation and registered in the hub's game library (`example-game`, port 5190). |
| Game page: changelog | ✅ | Real: `services/community` (`GET/POST /community/changelog/:gameId`), Postgres-backed when `DATABASE_URL` is set. Reads are public; publishing requires the caller's account to have the platform's `is_admin` flag (curated patch notes, not user content — see `ARCHITECTURE.md`; the flag is the same one `apps/admin` gates on, not a community-specific allowlist). `mygame.community.getChangelog`. |
| Game page: find groups / lobbies | ✅ | Real, derived live from presence: `social.getLobbies` (socket ack) groups online accounts whose `activity.joinable` is set, by room, for the requested game — no persistence. Honestly sparse until a game actually calls `setActivity({ joinable: true })` (the example game does). "+ Создать лобби" sets your own activity and enters the room. |
| Game page: discussions / forum | ✅ | Real forum on `services/community` (`discussion_threads`/`discussion_posts`, Postgres-backed). Reads are public; creating a thread/reply needs only a valid session (same trust model as chat/achievements — no moderation yet). `mygame.community.getThreads/getThread/createThread/createPost`. |
| Playtime / "last played" stats | ✅ | Real: `game_stats` on `services/auth`. `last_played_at` is stamped on launch (`recordGameEnter`); `seconds_played` accrues from an **in-game** SDK heartbeat (`mygame.stats` — started automatically by `mygame.init()`) since the hub can't time a session once it navigates to the game's own origin. The server clamps each heartbeat's credited delta so a missed beat/closed tab never over-credits — see `ARCHITECTURE.md`. |
| Profile status (online / DND) | — | Removed rather than left mocked: the fake "🟢 В сети / 🌙 Не беспокоить" menu items are gone (`HubScreen.tsx`). Presence is real but binary (online/offline, from `social`); a genuine status feature (DND, etc.) is unbuilt, not stubbed. |
| "Copy my ID" (top bar) | ✅ | Copies the real accountId (`HubScreen.tsx`, same value as the friends sidebar's "copy code"). |
| Context menus (right-click) | 🟡 | Menus are real; most actions now work (open chat, remove friend, play, open discussions). A few remain `alert(...)`/disabled placeholders (invite, block, call, share, favorites). |
| "Связь с автором" | 🟡 | Real external Telegram link. "Предложить идею" has no backend. Donation = "Временно недоступно". |
| "Protect your account" modal | 🟡 | Telegram button now starts the real linking flow (same as the profile page); VK is an explicit disabled "скоро", not a fake close. |

## Cross-cutting gaps

- **Persistence — done.** `auth` and `social` now have Postgres adapters (`@mygame/platform-db` +
  per-service `pgStore`/`pgInvites`) wired into their production entries, gated on `DATABASE_URL`.
  Memory stays the read working set; writes mirror to Postgres (write-behind); boot hydrates from the
  DB. Set `DATABASE_URL=postgres://civa:civa@localhost:5432/civa` (matches `infra/docker-compose.yml`)
  to turn it on. Redis is still unused. Note: write-behind logs (not throws) on a failed DB write.
- **Branding is inconsistent.** The UI says **CIVA** (nav bar) and **NEXUS** (login screen, bot
  copy). Pick one platform name.
- **Password migration for pre-existing accounts is an open gap, not solved.** `packages/platform-db`'s
  migration adds `password_hash TEXT`, backfills existing rows to an empty string, then sets it
  `NOT NULL`. An account with an empty hash can never pass `verifyPassword` again (it always fails
  against an empty hash) — so any account that existed before this migration lands is permanently
  locked out of its old displayName/identity the moment this deploys, with no recovery path
  implemented. This needs an explicit decision (e.g. a one-time forced password reset, or a
  Telegram-linked-account bypass) before shipping to a server that already has real accounts on it
  — GAMEHUB is already live on `mygame-quiz.ru` (see `docs/SERVER.md`), so this is not hypothetical.
- **`@mygame/shared-types` carries CIVA game-domain types** (resources, biomes, buildings, units,
  tech, diplomacy) the platform doesn't use. They're forward-looking/leftover from the game design.
- **Chat and friends now ship as SDK widgets; achievements/profile don't have one yet** (achievements
  arguably don't need one — see `ARCHITECTURE.md`; a profile/showcase page might, if built).
- **`SteamOverlay.tsx`** (a Shift+Tab-toggle in-game-style overlay showing a floating friends panel)
  is imported by `HubScreen.tsx` but never actually rendered (`<SteamOverlay />` doesn't appear in its
  JSX) — dead/unwired, found while moving `FriendsSidebar`. Left as-is (repointed its import, changed
  nothing else) since it's a real, functioning feature, just not one this pass was scoped to finish or
  remove.

## Mock → real, progress

1. ✅ **Persistence (Postgres adapters)** — done (`auth` + `social` + `chat`, gated on `DATABASE_URL`).
2. ✅ **Telegram linking + login** — done (real bot, gated on `TELEGRAM_BOT_TOKEN`).
3. ✅ **Chat backend + SDK widget (DMs + groups)** — done (`services/chat`, Postgres-backed;
   `ChatWidget` ships in `@mygame/sdk`'s overlay). Reactions/typing indicators still out of v1 scope.
4. ✅ **Group membership management (add/remove/leave)** — done. Any current member may add others;
   only the group's owner (creator) may remove someone else; anyone may always remove themselves
   (leave) — enforced in `services/chat/src/server.ts`, not just the UI. Wire change:
   `ChatThread.participantIds: string[]` became `participants: ChatParticipant[]` (id + display name),
   and gained `ownerId`. SDK: `mygame.chat.addMembers/removeMember/leaveGroup`; `ChatWidget` gained an
   add-member picker and a leave-group button. Kicking a *specific* member has no dedicated button yet
   (only leave + add got UI this pass) — see the Features table row above.
5. ✅ **Achievements API** — done (`auth` grants/lists per-game achievements, `mygame.achievements.*`
   in the SDK). Display catalog (name/icon/description) stays a per-game/client concern by design —
   see `ARCHITECTURE.md`.
6. ✅ **Friends widget in the SDK** — done (`FriendsWidget`/`FriendsSidebar` moved into
   `packages/sdk`, rendered by `MygameOverlay`).
7. ✅ **Profile persistence + upload** — done (avatar/wallpaper as data URLs, title achievement
   server-validated, `mygame.profile.*` in the SDK).
8. ✅ **Invite deep-links + notification center** — done (`?invite=CODE` auto-join, real 🔔 center for
   friend requests + game invites). *Creating/sending* an invite from a real in-game moment has no UI
   yet — see the next item.
9. ⏳ **Wire a real "invite friend to my game" action.** The hub can't do this itself (it doesn't
   track which room you're in once you've navigated into a game's own origin) — this needs the SDK's
   imperative `mygame.social.*` to grow `createInvite`/`inviteFriend`, and the actual game (CIVA, not
   in this repo) to call them from its own lobby/room UI. On hold while work stays scoped to hub+SDK
   only (the game itself is out of bounds for now).
10. **VK linking** (deferred by request).
11. ✅ **Deploy reconciliation + rename to GAMEHUB** — done. `deploy/civa` → `deploy/gamehub`
    (`@civa/auth` → `@mygame/auth` fixed; `social`/`chat`/`community` + a dedicated Postgres container
    added to `docker-compose.yml`; the gateway `Caddyfile` gained routes for all three —
    `social`/`chat` moved their Socket.io servers to custom paths, `/social.io/`/`/chat.io/`, so they
    don't collide with the game lobby's default `/socket.io/` on the shared origin). Images renamed
    `gamehub-*`, network `gamehub-net`. JWT issuer (`civa`) and the SDK's `localStorage` keys
    (`civa.session`) are deliberately unchanged — see `deploy/DEPLOY.md`.
12. ✅ **Hub frontend mock cleanup** — done. Real Copy-ID, a working Telegram link button in the
    "protect your account" modal, `ProfileWidget` shows real avatar/achievements, `LibrarySidebar`'s
    context menu wires Play for real, and the leftover demo-button block + fake status/settings
    `alert()`s are gone.
13. ✅ **Playtime + last-played stats** — done. New `game_stats` table on `auth`; `mygame.stats`
    (`recordEnter`, `getStats`, `startHeartbeat`/`stopHeartbeat` — the last two run automatically from
    `mygame.init()`). See `ARCHITECTURE.md` for the heartbeat-clamp design (the hub can't time a
    session once it navigates away to the game's own origin).
14. ✅ **Changelog + discussions (new `services/community`)** — done. Own service (port 8085, `COMMUNITY_PORT`)
    rather than folded into `auth`, to keep unbounded user-generated content out of the
    security-critical identity process. Changelog writes are gated to the platform's `is_admin` flag
    (an account-level flag, not a community-specific allowlist — see `ARCHITECTURE.md`); discussion
    threads/posts use the same open trust model as chat/achievements.
15. ✅ **Find groups / lobbies** — done. `social.getLobbies` (socket ack) derives joinable rooms from
    existing presence (`activityOf`/`socketsOf`) — no new persistence. Sparse until a game reports
    joinable activity.
16. ✅ **Starter example game** — done. `apps/example-game` exercises the whole SDK surface
    (handoff login, achievements, activity, chat/friends, playtime, community) as both a smoke test
    and living documentation for third-party game developers.
17. ✅ **Voice/video calls (LiveKit)** — done. GAMEHUB's own self-hosted LiveKit (`deploy/gamehub`),
    separate from Leaders' own instance on this shared server. Ring/accept/decline/hangup signaling
    over the existing chat socket; a plain HTTP route mints the LiveKit room token. Audio, video, and
    group calls all work through the same signaling path.
