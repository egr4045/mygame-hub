# Platform status — what actually works

> Audited 2026-06-29 against the code on branch `refactor/hub-split`. This is the source of truth for
> "is this real or a mock". Update it whenever a mock becomes real.

## Legend

- ✅ **Real** — backed by a working service.
- 🟡 **Partial** — works, but **in-memory only** (lost on restart) *or* the frontend is ready and the
  backend is a stub.
- ❌ **Mock** — UI only, no backend at all (hardcoded data / `alert()` / local state).

## Summary

The **social skeleton** of the platform (identity + friends + launcher + chat + achievements +
profile) is real, working, and Postgres-persisted. What's left mostly-mock is the Steam-style *store
content* around it (changelog, forum, lobby browser, playtime stats) and a few unimplemented pieces
(voice/video calls, VK linking).

## Features

| Feature | Status | Reality |
|---|---|---|
| Account login | 🟡 | Real backend (`services/auth`, real HS256 JWT access/refresh). But login is **passwordless**: the password field on the auth screen is **ignored** (`AuthScreen.tsx` passes only the name). "Регистрация" is the same call as login. |
| Account persistence | ✅ | Postgres-backed when `DATABASE_URL` is set (`services/auth/src/pgStore.ts`): accounts survive restart, ids stay stable (durable SSO identity). Falls back to in-memory with a loud warning when unset (and in `standalone`). |
| SSO handoff into a game | ✅ | `POST /auth/handoff` mints a short-lived (120s) token; the hub passes it via `?pt=` (`HubScreen.tsx`). Games exchange it at their own `POST /auth/platform`. See `SSO-FEDERATION.md`. |
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
| Voice / video calls | ❌ | UI only (`ChatWidget.tsx`, marked `CALL VIEW MOCK`). No LiveKit/WebRTC wired. |
| Achievements | 🟡 | Real API: `POST/GET /auth/achievements` on `services/auth` (idempotent grant, scoped per `gameId`+`achievementId`, persisted via the account store). `mygame.achievements.grant/list` in the SDK; a genuinely new unlock fires a toast automatically. **But** the display catalog (name/description/icon per achievement) is still a hardcoded local array in `ProfileView.tsx` — the platform only knows *that* an id is unlocked, not how to describe it (inherently a per-game concern; see `ARCHITECTURE.md`). |
| Profile avatar / wallpaper / title | ✅ | Real: `PUT/GET /auth/profile/{avatar,wallpaper,title}` on `services/auth`, persisted on the account row as data URLs (no object storage exists — see `ARCHITECTURE.md` for the size cap and why). Title must reference an achievement the account actually has unlocked (server validates). `mygame.profile.*` in the SDK. Survives reload/restart (Postgres-backed like the rest of the account). |
| Notifications (toasts) | 🟡 | Toast mechanism is real. `mygame.achievements.grant()` fires one automatically on a genuinely new unlock (real, for any SDK consumer) — but the hub's own achievement/message demo buttons trigger it manually rather than from a real chat/achievement event reaching the hub. |
| Notification center (🔔) | ✅ | Real: shows incoming friend requests (click = accept) and pushed game invites (click = join, via `routeToInvite`) with a live count badge. Falls back to "Нет новых уведомлений" when both are empty. "Настройки уведомлений" is still `alert(...)`. |
| Game library | ✅ | Real static registry (`apps/hub/src/platform/games.ts`), mirrors the orchestrator manifest. |
| Game launch / orchestrator | ✅ | `services/orchestrator` really runs `docker compose up/stop`, wakes a game on entry, reaps it on idle (reaper polls each game's `/metrics`). Hub calls `POST /orchestrator/games/:id/enter`. |
| Game page: changelog | ❌ | Hardcoded ("Патч 1.0.3", dates). |
| Game page: find groups / lobbies | ❌ | Hardcoded; "Join" buttons do nothing. |
| Game page: discussions / forum | ❌ | Full mock (preset threads); posting has no backend. |
| Playtime / "last played" stats | ❌ | Hardcoded ("12 часов", "Сегодня"). |
| Profile status (online / DND) | ❌ | `alert('Статус изменен')`. |
| "Copy my ID" (top bar) | ❌ | Copies the literal string `'ID: 12345'` (`HubScreen.tsx`). The friends sidebar "copy code" *is* real (copies your accountId). |
| Context menus (right-click) | 🟡 | Menus are real; some actions work (open chat, remove friend), most are `alert(...)` (invite, block, call, share). |
| "Связь с автором" | 🟡 | Real external Telegram link. "Предложить идею" has no backend. Donation = "Временно недоступно". |
| "Protect your account" modal | ❌ | Link buttons just close the modal. |

## Cross-cutting gaps

- **Persistence — done.** `auth` and `social` now have Postgres adapters (`@mygame/platform-db` +
  per-service `pgStore`/`pgInvites`) wired into their production entries, gated on `DATABASE_URL`.
  Memory stays the read working set; writes mirror to Postgres (write-behind); boot hydrates from the
  DB. Set `DATABASE_URL=postgres://civa:civa@localhost:5432/civa` (matches `infra/docker-compose.yml`)
  to turn it on. Redis is still unused. Note: write-behind logs (not throws) on a failed DB write.
- **Branding is inconsistent.** The UI says **CIVA** (nav bar) and **NEXUS** (login screen, bot
  copy). Pick one platform name.
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
11. **Deploy reconciliation** — `deploy/civa` predates the `social`/persistence/`chat` work: it still
    filters on the old `@civa/auth` package name (now `@mygame/auth`), has no `social`/`chat`/Postgres
    containers, and the gateway has no route for either socket service (would collide with the game
    lobby's `/socket.io/*`). Not yet blocking local dev; blocking before a real server deploy. (Flagged
    as a follow-up task.)
