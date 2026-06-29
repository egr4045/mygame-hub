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
| Telegram account linking | ❌ | Buttons are `alert('Мок привязки Telegram')` (`ProfileView.tsx`). `services/auth/src/botGateway.ts` generates codes but is **wired to nothing** (no HTTP route, no webhook), and codes are never stored. |
| VK account linking | ❌ | Mock + `handleVkMessage` returns "coming soon". (Intentionally deferred.) |
| Friends list (add/accept/decline/remove) | ✅ | Real Socket.io backend (`services/social`). Account id doubles as friend code. |
| Presence (online/offline/in-game) | ✅ | Computed from live socket connections; activity is pushed to friends. |
| Friends persistence | ✅ | Postgres-backed when `DATABASE_URL` is set (`services/social/src/pgStore.ts`): the friendship graph survives restart. Falls back to in-memory (warning) when unset / in `standalone`. |
| Invite codes | ✅ | Real: mint a code, resolve via `GET /invite/:code`, push an invite to a friend's socket. Postgres-backed when `DATABASE_URL` is set (`pgInvites.ts`), 1h TTL; in-memory fallback otherwise. |
| Invite **links** (deep-link join) | ❌ | Codes exist; the `?invite=CODE` / `?join=` deep-link auto-join flow is not implemented end-to-end (see `ROADMAP-PLATFORM.md`). |
| Chat / messenger | ❌ | Fully mock. `sdk/src/state/chatStore.ts` ships `MOCK_SESSIONS`; messages live only in browser state. No chat service, no sockets for chat. |
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

## Mock → real, progress

1. ✅ **Persistence (Postgres adapters)** — done (`auth` + `social`, gated on `DATABASE_URL`).
2. ⏳ **Telegram linking** — real bot + linking codes (token via `TELEGRAM_BOT_TOKEN`). *Next.*
3. **Chat backend** — a real messaging service (DMs first, then groups).
4. **Achievements API** — expose the store that already exists; emit from games via the SDK.
5. **Profile (avatar/title) persistence + upload.**
6. **Invite deep-links + notification center.**
7. **VK linking** (deferred by request).
