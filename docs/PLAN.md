# Platform — implementation plan

> This is the plan for the **platform** in this repo (launcher + social + auth + orchestrator + SDK).
> The CIVA *game's* implementation plan (hex map, sim-core, economy, UN/TTS) is a separate product —
> its design lives in `docs/DESIGN.md` and it ships as an on-demand stack the orchestrator launches.

For the audited current state, see `docs/STATUS.md`. For how the pieces fit, see `docs/ARCHITECTURE.md`.

## Principles (the isolation contract)

1. **Boundary = schema.** All cross-service interaction is zod schemas in `@mygame/protocol`. No
   cross-service imports of internal logic.
2. **Ports & adapters.** Services depend on abstractions (`Clock`, `Logger`, storage ports), so real
   (Postgres/system clock) and test (in-memory) adapters are interchangeable.
3. **Standalone mode.** Each service runs in isolation (`standalone.ts`) against in-memory adapters.
4. **One game = one entry.** Adding a game is a manifest entry in the orchestrator + a registry entry
   in the hub + its own `deploy/<game>` compose — no platform code changes.

## Done

- **Phase 0 — Monorepo foundation.** pnpm + Turborepo + TS, package skeletons, service generator,
  conventions, infra compose (Postgres/Redis present but not yet wired).
- **Phase 1 — Hub UI.** The full Steam-style launcher: auth screen, library + game details, profile,
  friends overlay, chat/messenger UI, toasts, context menus. Most content is still on mock data
  (`STATUS.md`).
- **Phase 2 — Platform realtime + SDK.**
  - `auth` service: passwordless login, JWT access/refresh, SSO handoff tokens.
  - `social` service: Socket.io friends + presence + invites.
  - `orchestrator` service: Docker wake/reap per game.
  - `@mygame/sdk`: framework-agnostic client, runtime config, self-mounting Shadow-DOM overlay,
    bundled with `tsup` for external games.
  - `@mygame/protocol`: platform-only contract (auth/social/invite/envelope/errors).
- **Phase 3 — Persistence.** `@mygame/platform-db` (pool + migrations + write-behind queue) and
  Postgres adapters for accounts (`auth`) and the friend graph + invites (`social`), wired into the
  production entries and gated on `DATABASE_URL`. Memory stays the read working set; writes mirror to
  Postgres; boot hydrates from the DB. In-memory fallback (with a warning) when `DATABASE_URL` is
  unset, and always in `standalone`.
- **Phase 4 — Telegram linking & login.** Real bot (`auth`, long polling, gated on
  `TELEGRAM_BOT_TOKEN`): link an account via the hub profile (`/start <code>`), and log in on a new
  device via a `/login` code. The `telegram_id` mapping persists through the account store.
- **Phase 5 — Chat backend + groups, SDK widget.** `services/chat` (Socket.io, mirrors `social`):
  unified `Conversation` model (dm = 2-member, group = named + fixed member list found via
  `openDm`/`createGroup`), persisted history, unread counts, dm read receipts; Postgres-backed via the
  same `@mygame/platform-db` adapters, gated on `DATABASE_URL`. `ChatWidget` moved from the hub into
  `packages/sdk/src/components/` and is rendered by the SDK's `MygameOverlay` — any game embedding the
  SDK gets a working chat window automatically. `mygame.chat.*` also grew a full imperative API
  (`createGroup`, `send`, `getThreads`, `getUnreadCount`, `subscribe`) for games that want their own
  UI. Group membership changes (add/remove/leave), reactions, typing indicators and message edit/
  delete are deliberately deferred (see `STATUS.md`).
- **Phase 6 — Achievements API.** `auth` grants (idempotent, per `gameId`+`achievementId`) and lists
  an account's achievements (`AccountAchievement[]`, no schema change needed — the account store
  already had an unused `achievements` field). `mygame.achievements.grant/list` in the SDK; a
  genuinely new unlock fires a toast automatically. The **display catalog** (name/icon/description)
  is deliberately *not* server-side — the platform can't know what a game's achievement means or
  looks like, only that it's unlocked; each game (the hub's `ProfileView` included) keeps its own
  small catalog for presentation. Trust model matches the rest of the platform: the caller's own
  token authorizes the grant, no server-side proof of "actually earned".

## Next (mock → real)

Ordered by leverage. Each item is built in isolation, then integrated. Testing is manual for now.

1. **Extract the friends widget into the SDK.** Same treatment `ChatWidget` just got — move
   `FriendsWidget`/`FriendsSidebar` into `packages/sdk` and render them from `MygameOverlay`, so an
   embedded game gets the friends list UI too, not just the data (`mygame.social.*`).
2. **Profile persistence + uploads.** Avatar/wallpaper/title stored server-side (object storage or
   DB), surfaced across games via the social `me` payload.
3. **Invite deep-links + notification center.** Finish the `?invite=`/`?join=` auto-join flow
   (`ROADMAP-PLATFORM.md`); make the 🔔 center show real invites/requests.
4. **Group membership management.** Add/remove/leave for existing groups (v1 only supports create with
   a fixed member list).
5. **VK account linking.** Mirror the Telegram flow (deferred by request).
6. **Auth hardening.** Decide passwordless vs. password/OTP; real registration; rate limiting; rotate
   `JWT_SECRET` handling.
7. **Deploy reconciliation.** `deploy/civa` predates `social`/persistence/`chat`: fix the stale
   `@civa/*` package filter names, add `social`/`chat`/Postgres containers, and give each socket
   service a distinct gateway path (or Socket.io path option) so it doesn't collide with a game
   lobby's `/socket.io/*`. Not blocking local dev; blocking before a real server deploy.

## Verification

- Per service: `corepack pnpm --filter @mygame/<svc> dev:standalone` + `... test`; `/health` responds.
- Hub: `corepack pnpm --filter @mygame/hub dev` → walk every screen.
- Realtime: run `auth` + `social`, connect two clients, exercise add/accept/presence/invite.
- Launch: run `orchestrator` with Docker, `POST /orchestrator/games/:id/enter`, confirm the game's
  containers come up and reap on idle.
