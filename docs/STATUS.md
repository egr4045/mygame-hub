# Platform status — what actually works

> Audited 2026-07-16 against branch `refactor/hub-split`. This is the source of truth for "is this
> real or a mock". Rewritten from scratch this pass — the previous version had drifted badly behind
> the code (missing several shipped systems, and still describing "find groups/lobbies" as real after
> it was removed entirely). Update it whenever a mock becomes real or a real feature changes shape.

## Legend

- ✅ **Real** — backed by a working service, Postgres-persisted where it needs to be.
- 🟡 **Partial** — works, but **in-memory only** (lost on restart without `DATABASE_URL`) *or* one
  specific piece of an otherwise-real feature is still a stub.
- ❌ **Mock / not built** — UI only, no backend, or genuinely doesn't exist yet.

## Summary

The platform's identity/social/content spine is real and Postgres-persisted end to end: accounts,
friends, DMs/groups, voice/video calls (self-hosted LiveKit), achievements (unlocks **and** their
display catalogs — no longer hardcoded per game), profiles, changelog/discussions, a triaged player
**suggestions** queue, and a **standalone admin panel** covering all of it. Telegram is wired for both
account linking/login and ops alerting (disk space, new suggestions), routed through a single bot the
`auth` service polls. The hub ships a dedicated mobile shell alongside the desktop launcher, an instant
boot skeleton + caching so returning from a game isn't a blank wait, and unified friend search by nick
or code. What's left unbuilt: VK linking (deferred by request), chat reactions, and a real "invite a
friend to my current game" trigger from inside an actual game session (the receiving side is real; only
the hub's own demo button exercises the sending side today).

## Features

| Feature | Status | Reality |
|---|---|---|
| Account login/register | ✅ | `services/auth`, HS256 JWT access/refresh (`@mygame/auth-core`), scrypt-hashed passwords, timing-safe verify, per-IP rate limiting on register/login. |
| Account persistence | ✅ | Postgres-backed when `DATABASE_URL` is set (`services/auth/src/pgStore.ts`) — accounts, playtime, achievement unlocks, achievement catalogs all survive restart. Falls back to in-memory with a loud warning when unset (and always in `standalone`). |
| SSO handoff into a game | ✅ | `POST /auth/handoff` mints a 120s token; the hub passes it via `?pt=`. The target game's own origin redeems it via `POST /auth/exchange` for a full session — the server verifies signature + `typ==='handoff'` + account still exists; the client never decodes the JWT itself. SDK: `mygame.auth.getHandoff()` / `.loginWithToken()` / `.adoptSession()` (for a game whose *own server* redeems the token and hands the browser a session — see `SSO-FEDERATION.md`). |
| Telegram account linking + login | ✅ | Real bot (`@mygame_quiz_hub_bot`, long-poll, `services/auth/src/telegramLinking.ts` + `packages/telegram`), gated on `TELEGRAM_BOT_TOKEN`. `POST /auth/telegram/link-code` → open bot `/start <code>` → binds `accounts.telegram_id`. `/login` on the bot → one-time code → `POST /auth/social/login` on a new device. Auth is the **sole poller** of this bot token — `services/chat`'s disk-alert monitor and `services/community`'s suggestion-notify both only *send* through the same token, never poll (two pollers on one token 409s). |
| VK account linking | ❌ | Deferred by request. |
| Friends (add/accept/decline/remove/block) | ✅ | Real Socket.io backend (`services/social`), Postgres-persisted. Account id doubles as a short, dictatable friend code. |
| Find friends by nick or code | ✅ | `social.search` — live search as you type, ranked with an exact friend-code match first, then name matches; each result carries your relation to that account (add / pending / already friends / self) and blocked accounts are filtered out. Used by the desktop friends sidebar and the mobile Друзья tab. |
| Presence (online/offline/in-game) | ✅ | Computed from live socket connections; activity (what game, joinable room) is pushed to friends. |
| Friend/own avatar + title visible to others | ✅ | `social`'s `Friend`/`me` payloads mirror `avatarIcon`/`titleAchievement` (read-only) from the shared `accounts` table `auth` owns, refreshed on every socket connect. The redesigned profile card (`UserProfileModal`, one shared component used everywhere a profile opens — friends sidebar, chat, mobile) resolves a friend's title to its real name/icon/description via the achievement catalog registry (see below), not just a generic 🏅. |
| Invite codes + deep links | ✅ | Mint a code (`createInvite`/`inviteFriend`), resolve via public `GET /invite/:code`, push to a friend's socket. `?invite=CODE` on load auto-resolves once logged in and routes into the game (`routeToInvite`). Steam-style bottom-right toast for a pushed invite (Присоединиться/Позже), not just the 🔔 center. |
| Chat: DMs + groups | ✅ | `services/chat` (Socket.io + JWT). A DM is a deterministic 2-member conversation; a group has a mutable member list, an owner, and promotable admins. Persisted history with pagination (`loadOlder`), unread counts, read receipts (dm only), typing indicators (throttled, auto-clears), image uploads (50MB cap, 30-day message retention, durable volume). Rate-limited (send/edit/delete, signaling, uploads). |
| Chat: edit / delete / reply / pin | ✅ | Edit is sender-only and not allowed on an already-deleted message. Delete is a tombstone (own messages always; someone else's only for a group owner/admin) — the row survives so reply-chains and ordering stay stable, rendered as "Сообщение удалено". Reply quotes and scrolls to the original. Group owner/admins can pin one message. |
| Group membership + roles | ✅ | Any member may add others; only the owner/admins may remove someone else (self-removal/leave is always allowed); the owner can promote/demote admins and update the group's name/avatar. A member-list "⋯" context menu drives all of this in `ChatWidget`. |
| Chat reactions | ❌ | Not built. |
| Voice / video calls | ✅ | GAMEHUB's own self-hosted LiveKit (separate instance from Leaders' — see `docs/SERVER.md`). Two call kinds share one media layer (`callStore`): **conversation calls** (ring/accept/decline/hangup over the chat socket, Discord-style live participant presence pushed to every group member) and **portable game-room calls** (`mygame.call.joinGameRoom`, a host can `bindToRoom` their conversation call so game-side joiners land in the same LiveKit room, and `inviteToGame` pushes a "come play" invite over the data channel). Calls survive a page navigation (persisted + resumed via `mygame.call.resume()`, called from `mygame.init()` and on tab-visibility/online/pageshow — see "socket auto-revive" below). Multi-device: LiveKit identity is `accountId#device`, so the same account can join from two devices without evicting itself. |
| Achievements: unlock + list | ✅ | `POST/GET /auth/achievements` on `services/auth`, idempotent grant scoped per `gameId`+`achievementId`, Postgres-persisted. `mygame.achievements.grant/list`; a genuinely new unlock fires a sound + toast automatically. Trust model: the caller's own token authorizes the grant (same posture as the rest of the platform) — a game that cares should grant from its own trusted backend. |
| Achievements: display catalog | ✅ | A game registers its own catalog (name/description/icon/colour per achievement) via `mygame.achievements.registerCatalog()` — idempotent full-replace, `PUT/GET /auth/achievements/catalog(/:gameId)`, Postgres-persisted (`achievement_definitions` table, CIVA's seeded since its own repo isn't here yet). The hub fetches all registered catalogs (cached, stale-while-revalidate) and shows a real per-game showcase (locked+unlocked, hover = description) on that game's own page; the profile's achievements list decorates every unlock with the real name/icon instead of a bare id. `example-game` registers a demo catalog on boot as the reference implementation. |
| Profile avatar / wallpaper / title | ✅ | `PUT/GET /auth/profile/{avatar,wallpaper,title}`, persisted as data URLs on the account row (no object storage — see `ARCHITECTURE.md`). Title must reference an achievement the account actually holds (server-validated) and can now reference *any* game's achievement, not just one hardcoded game. |
| Notification sounds | ✅ | WebAudio-synthesized placeholders for message/call/achievement (obviously synthetic on purpose — real audio files are a copyright follow-up). Admin can override each with an uploaded file (`apps/admin`'s Settings → Sounds, stored as a data URL in `platform_settings`); a master volume slider lives in the hub's notification settings. |
| Notification toasts | ✅ | Steam-style, bottom-right, with sender avatar and action buttons where relevant (invite Join/Later). Fire for: incoming chat message (when that chat isn't the one currently open), incoming call, achievement unlock, pushed game invite. A per-category mute toggle lives in notification settings. |
| Notification center (🔔) | ✅ | Incoming friend requests (click = accept) and pushed game invites (click = join) with a live count badge. |
| Suggestions ("предложить идею") | ✅ | `services/community` owns a triaged suggestions queue (`suggestions` table: new → accepted/rejected/implemented), separate from the discussion forum. Any logged-in account can submit (`createSuggestion`, hub's "Связь с автором" + mobile profile tab); a new submission pings the registered Telegram ops recipient with a deep link straight into the admin panel's Предложения tab (`/admin/#suggestions`). Admin can filter by status and move a suggestion through the pipeline. |
| Game page: changelog | ✅ | `services/community`, Postgres-backed. Reads are public; publishing is admin-gated (`is_admin`, same flag `apps/admin` gates on everywhere). |
| Game page: discussions / forum | ✅ | `discussion_threads`/`discussion_posts`, Postgres-backed. Reads are public; creating a thread/reply needs only a valid session. Soft-delete moderation (admin-gated). |
| Game page: achievements panel | ✅ | Real showcase from the achievement catalog registry (see above) — was a hardcoded "Достижения пока недоступны" placeholder until this pass. |
| Game page: find groups / lobbies | ❌ removed | Was a presence-derived lobby query (`social.getLobbies`); removed entirely by request — a game showed a joinable "lobby" even while the game itself was unreachable (maintenance). Games are expected to build their own matchmaking now; nothing in the platform replaces this. |
| Playtime / "last played" stats | ✅ | `game_stats` on `services/auth`. `last_played_at` stamps on launch; `seconds_played` accrues from an in-game SDK heartbeat (started automatically by `mygame.init()`), server-clamped so a missed beat/crash never over-credits. Under 30s played shows "0 мин", not "ещё не играли". |
| Game library | ✅ | Static registry (`apps/hub/src/platform/games.ts`) mirroring the orchestrator manifest. Admin can flip a game's status (playable/soon/maintenance) at runtime via `platform_settings` — no redeploy needed, applied on the hub's next boot (cached + revalidated, like the achievement catalogs). |
| Game launch / orchestrator | ✅ | `services/orchestrator` runs `docker compose up/stop`, wakes a game on entry, reaps it after idle (default 10 min, polls each game's `/metrics`). Admin can also force-stop a running game, bypassing its idle timer. |
| Game routing: HTTPS same-origin path | ✅ for svoyak, example-game, cards · ❌ for civa | Reached at `mygame-quiz.ru/<game>/` behind the gateway (Caddy strips the prefix), not a bare port — required for `getUserMedia` (mic/cam), which browsers block on an insecure `http://host:port` origin. CIVA is still on the legacy per-port model and is marked `status: 'maintenance'` in the registry rather than shipping a Play button that would hit that bug. |
| Mobile hub | ✅ | A dedicated shell (`apps/hub/src/mobile`) below a 768px breakpoint — bottom tab bar (Игры/Друзья/Профиль), full-screen game details, its own friends/profile surfaces built on the same stores as desktop (no logic duplicated). |
| Boot performance | ✅ | Launching a game is a same-tab navigation, so returning to the hub is a full page reload. `index.html` now paints an instant CSS-only skeleton before the JS bundle parses; the session restores synchronously (no login-screen flash); admin-controlled settings (game statuses, sounds) and achievement catalogs apply from a `localStorage` cache immediately, then revalidate; Vite's hashed assets get a year-long immutable `Cache-Control` so a repeat load skips the network entirely. |
| Socket auto-revive | ✅ | A backgrounded/slept tab kills the websockets; socket.io's own reconnect reuses the stale token and can't recover. `visibilitychange`/`online`/`pageshow` handlers mint a fresh token and reconnect social/chat/resume any call — no manual reload needed. |
| Admin panel (`apps/admin`) | ✅ | Standalone app, path-routed at `/admin/`. Same password login as any player; access gated **server-side** by `is_admin` (403 if not admin, not a client-side check). First admin(s) bootstrapped via `AUTH_BOOTSTRAP_ADMIN_IDS`; everyone after is promoted/demoted from inside the app (guarded against demoting the last admin). Screens: **Dashboard** (live per-service health), **Games** (changelog CRUD, discussion moderation, live-lobby force-stop, per-game status override, notification-sound uploads), **Users** (search/detail, ban, clear avatar/wallpaper, grant/revoke achievements), **Suggestions** (filter + triage player ideas), **Settings** (admin roster, branding/contact key-value settings). |
| Ops: disk-space alerts | ✅ | `services/chat` watches the upload volume's free space (`fs.statfs`, hysteresis so it doesn't flap) and DMs the registered Telegram ops recipient below a configurable threshold. Whoever first DMs the shared bot `admin` becomes the recipient (persisted). |
| Context menus (right-click) | ✅ | Real, most actions wired (open chat, remove/block friend, play, open discussions, member management, achievement title-pick). |

## Known gaps

- **Password migration for pre-existing accounts.** `packages/platform-db`'s migration adds
  `password_hash TEXT`, backfills existing rows to `''`, then sets it `NOT NULL`. An empty hash never
  verifies, so any account that predates this migration is permanently locked out of its old identity
  the moment it deploys, with no recovery path implemented. GAMEHUB has been live with real accounts
  since before this shipped — this is a real, standing gap, not hypothetical. Needs an explicit
  decision (one-time forced reset, or a Telegram-linked-account bypass) if it hasn't already bitten.
- **"Invite a friend to my current game" has no real trigger.** The *receiving* side (a pushed invite,
  or `?invite=CODE`) is fully real. The hub can't send one itself — it stops tracking your session the
  moment you navigate into a game's own origin — so this needs `mygame.social.createInvite`/
  `.inviteFriend` (currently only reachable via the React hook the hub uses internally) called from
  inside an actual game's own lobby/room UI. No game in this repo does that yet.
- **Chat reactions** are out of scope for v1, not stubbed.
- **VK linking** deferred by request; the Telegram flow is the template if it's ever picked up.

## Recent history (this session)

Roughly chronological; see git log on `refactor/hub-split` for the full detail.

1. Chat/calls hardening pass (edit/delete/reply/pagination, rate limiting, upload security, ring
   timeout/race fixes) + full CSS-token pass across the hub.
2. Upload cap raised to 50MB + Telegram disk-space ops alerting + 30-day message retention + docker
   log rotation.
3. Ten UI items from a bug/polish pass: short friend code, avatar placeholders, drag-and-drop upload
   zone, member context menu, call presence, mobile hub layout, multi-device call identity.
4. Admin game-status control, notification sounds, single movable launcher button, Steam-style toasts,
   Telegram linking live in prod, socket auto-revive, achievements-in-profile fix.
5. Friend search by nick/code, one shared `UserProfileModal` used everywhere, mobile scroll fix.
6. Achievement catalog registry (replacing the hardcoded per-game display catalog), suggestions queue
   + Telegram notify, removed "find groups/lobbies" entirely.
7. Svoyak migrated to HTTPS path routing (`/svoyak/`) — was on a bare port, which silently broke
   mic/cam (insecure context).
8. Boot-performance pass: instant skeleton, synchronous session restore, cached settings/catalogs,
   immutable asset caching.
9. Repo-wide cleanup of leftover "civa" naming where it wrongly stood in for the whole platform
   (docs, dead CSS from CIVA's own old game UI, `infra/docker-compose.yml`'s dev-infra labelling) —
   CIVA the game's own naming (its id, its own deploy stack, its design doc) is untouched, that's
   correct. Then, by explicit request accepting the one-time mass logout: **JWT issuer and the SDK's
   session storage key renamed `civa` → `gamehub`** (every service redeployed together — a mixed
   fleet would have broken cross-service token verification, not just client sessions), and
   `@mygame/shared-types` lost ~120 lines of unused CIVA 4X-game domain vocabulary (verified zero
   platform usages before deleting; not moved anywhere, since CIVA's next implementation starts over).
