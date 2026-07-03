# Platform status — what actually works

> Audited 2026-06-29 against the code on branch `refactor/hub-split`. This is the source of truth for
> "is this real or a mock". Update it whenever a mock becomes real.

## Legend

- ✅ **Real** — backed by a working service.
- 🟡 **Partial** — works, but **in-memory only** (lost on restart) *or* the frontend is ready and the
  backend is a stub.
- ❌ **Mock** — UI only, no backend at all (hardcoded data / `alert()` / local state).

## Summary

The **social skeleton** of the platform (identity + friends + launcher) is real and working. Almost
all the *content surface* around it (Steam-style store pages, messenger, achievements, profile) is
designed UI on hardcoded data. **Nothing is persisted** — every store is in-memory, including in the
"production" service entries.

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
| Invite codes | ✅ | Real: mint a code, resolve via `GET /invite/:code`, push an invite to a friend's socket. Postgres-backed when `DATABASE_URL` is set (`pgInvites.ts`), 1h TTL; in-memory fallback otherwise. |
| Invite **links** (deep-link join) | ❌ | Codes exist; the `?invite=CODE` / `?join=` deep-link auto-join flow is not implemented end-to-end (see `ROADMAP-PLATFORM.md`). |
| Chat: DMs + groups | ✅ | Real backend: `services/chat` (Socket.io + JWT, mirrors `social`). Unified `Conversation` model (dm = 2-member conversation, group = named + fixed member list). Send/receive, persisted history, unread counts, read receipts (dm only). Postgres-backed when `DATABASE_URL` is set, in-memory fallback otherwise. |
| Chat widget ships with `@mygame/sdk` | ✅ | The chat UI (`ChatWidget`) lives in `packages/sdk/src/components/`, not the hub — it's rendered by the SDK's self-mounting overlay (`mountOverlay()` → `MygameOverlay`), so **any game embedding the SDK gets a working chat window + launcher button automatically**, no UI code required. The hub renders the same component directly (not through the overlay). `mygame.chat.*` also exposes a full imperative API (`createGroup`, `send`, `getThreads`, `getUnreadCount`, `subscribe`) for a game that wants to build its own UI on the data instead. |
| Group membership management | ❌ | v1 scope: create a group with a fixed member list only. No add/remove/leave-member yet (see `docs/PLAN.md`). |
| Chat reactions / edit / delete / typing indicators | ❌ | Dropped from the real backend for v1 scope. Message context-menu actions (reply/edit/delete) are still `alert(...)`. |
| Voice / video calls | ❌ | UI only (`ChatWidget.tsx`, marked `CALL VIEW MOCK`). No LiveKit/WebRTC wired. |
| Achievements | ❌ | Hardcoded `ACHIEVEMENTS` array (`ProfileView.tsx`). The account store has an `achievements` field + `addAchievement`, but it's never called or exposed via API. "5 из 50", showcase, titles are fake. |
| Profile avatar / wallpaper / title | 🟡 | Changed locally (`URL.createObjectURL` + `useState`); **not uploaded, not persisted** — gone on reload. |
| Notifications (toasts) | 🟡 | Toast mechanism is real, but triggered by **demo buttons**. The notification center (🔔) is mock ("Нет новых уведомлений"). |
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
- **Only the chat widget ships with the SDK so far.** The friends list/presence UI
  (`FriendsWidget`/`FriendsSidebar`) is still hub-only (`apps/hub/src/components`,
  `apps/hub/src/platform`) — an embedded game gets friends **data** via `mygame.social.*` but not a
  ready-made widget. Extracting it into `packages/sdk` (mirroring what was just done for chat) is a
  natural next step if the goal is "any game gets the full platform UI for free."

## Mock → real, progress

1. ✅ **Persistence (Postgres adapters)** — done (`auth` + `social` + `chat`, gated on `DATABASE_URL`).
2. ✅ **Telegram linking + login** — done (real bot, gated on `TELEGRAM_BOT_TOKEN`).
3. ✅ **Chat backend + SDK widget (DMs + groups)** — done (`services/chat`, Postgres-backed;
   `ChatWidget` ships in `@mygame/sdk`'s overlay). Group membership management (add/remove/leave) and
   reactions/typing indicators still pending.
4. ⏳ **Achievements API** — expose the store that already exists; emit from games via the SDK. *Next.*
5. **Profile (avatar/title) persistence + upload.**
6. **Invite deep-links + notification center.**
7. **Extract the friends widget into the SDK** — same treatment chat just got.
8. **VK linking** (deferred by request).
9. **Deploy reconciliation** — `deploy/civa` predates the `social`/persistence/`chat` work: it still
   filters on the old `@civa/auth` package name (now `@mygame/auth`), has no `social`/`chat`/Postgres
   containers, and the gateway has no route for either socket service (would collide with the game
   lobby's `/socket.io/*`). Not yet blocking local dev; blocking before a real server deploy. (Flagged
   as a follow-up task.)
