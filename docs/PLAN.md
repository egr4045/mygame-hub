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
  UI. Group membership changes (add/remove/leave) shipped in Phase 10; reactions, typing indicators
  and message edit/delete are still deliberately deferred (see `STATUS.md`).
- **Phase 6 — Achievements API.** `auth` grants (idempotent, per `gameId`+`achievementId`) and lists
  an account's achievements (`AccountAchievement[]`, no schema change needed — the account store
  already had an unused `achievements` field). `mygame.achievements.grant/list` in the SDK; a
  genuinely new unlock fires a toast automatically. The **display catalog** (name/icon/description)
  is deliberately *not* server-side — the platform can't know what a game's achievement means or
  looks like, only that it's unlocked; each game (the hub's `ProfileView` included) keeps its own
  small catalog for presentation. Trust model matches the rest of the platform: the caller's own
  token authorizes the grant, no server-side proof of "actually earned".
- **Phase 7 — Friends widget into the SDK.** `FriendsWidget`/`FriendsSidebar` moved from the hub into
  `packages/sdk/src/components/`, rendered by `MygameOverlay` — same treatment chat got. The one
  hub-specific dependency (`usePlatformStore().selectedGame`, gating the already-mock "invite to
  current game" menu item) was dropped rather than plumbed through, since the action was `alert(...)`
  either way. Found `SteamOverlay.tsx` (a Shift+Tab overlay) imports `FriendsSidebar` but is itself
  dead — never rendered by `HubScreen`; left as-is (only repointed its import) since removing/wiring
  it wasn't this pass's job.
- **Phase 8 — Profile persistence + uploads.** Avatar/wallpaper stored as data URLs directly on the
  account row (no object storage service exists — see `ARCHITECTURE.md` for the size-cap tradeoff and
  the migration path if that changes later); title achievement server-validated against the account's
  own unlocked achievements. Routes: `PUT/GET /auth/profile/*`. `mygame.profile.*` in the SDK. First
  real use of `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` in this schema (`accounts` already had real
  rows, unlike the earlier `messages` redesign) — the template for evolving a table with data worth
  keeping. `readJson` gained a streaming `maxBytes` guard (413 before full buffering) since these two
  routes take meaningfully larger bodies than the rest of the API.
- **Phase 9 — Invite deep-links + notification center.** `App.tsx` reads `?invite=CODE` on load and
  auto-joins once logged in (`resolveInvite` → `routeToInvite`: wake the game, mint a handoff token,
  navigate) — the same `routeToInvite` a pushed invite already used. The 🔔 center now renders real
  incoming friend requests (click = accept) and pushed game invites (click = join) with a live count
  badge, replacing the static "no notifications" mock. Added a demo button to actually mint a shareable
  invite link (`createInvite`), since the *receiving* side had nothing to test against otherwise.
  **Sending** an invite from inside an actual game session is still not wired — see "Next".
- **Phase 10 — Group membership management.** `services/chat`'s `Conversation` gained `ownerId` (the
  creator); the store gained `addMembers`/`removeMember`/`ownerOf`. Authorization is enforced
  server-side in `server.ts`, not just the UI: any current participant may add others; only the owner
  may remove someone *else*; anyone may always remove themselves (leave), including the owner (leaving
  doesn't transfer ownership — a documented v1 limitation, see the code comment in `server.ts`). Wire
  change: `ChatThread.participantIds: string[]` → `participants: ChatParticipant[]` (id + display name,
  needed so the UI can render an add-member picker without a separate lookup) plus `ownerId`. SDK:
  `mygame.chat.addMembers/removeMember/leaveGroup`; `ChatWidget` gained a "➕" add-member picker
  (reuses the create-group friend-picker, filtered to friends not already in the group) and a "🚪"
  leave-group button in the header. Also fixed a latent bug this exposed: the SDK's `mergeThreads`
  used to only ever add/update sessions from a thread push, never drop one — so leaving/being kicked
  from a group would leave a permanent "zombie" thread in the sidebar. Now rebuilt strictly from each
  push's (authoritative, complete) list. Kicking a *specific* member has no dedicated UI yet — only
  leave + add got a button this pass; the backend/API already supports it.
- **Phase 11 — Surface avatar/title to friends.** `social`'s `Friend`/`me` payloads gained
  `avatarIcon`/`titleAchievement`, mirrored (read-only — `social` never writes them) from the shared
  `accounts` table `auth` owns. New `SocialStore.updateProfile`/`refreshProfile`: the in-memory
  adapter's `refreshProfile` is a no-op (nothing to pull from), the Postgres adapter's does a live
  `SELECT ... WHERE id = $1` on every socket connect and merges the result in — there's no live signal
  when a profile changes elsewhere, so this re-read is the only freshness mechanism (same
  reconnect-driven staleness profile `displayName` already had). `FriendsSidebar` renders the avatar
  image directly (self-contained data URL, no lookup needed) and a generic 🏅 indicator for an
  equipped title (deliberately *not* resolved to a name/icon — that needs a per-game display catalog,
  which the SDK doesn't and shouldn't own, matching the achievements-display precedent from Phase 6).
  Also retired a genuinely dead field found along the way: the SDK's `me.avatarUrl` was declared but
  never populated (flagged in an earlier pass) — replaced outright by the real `avatarIcon`, and
  `HubScreen.tsx`'s topbar (which already had working `<img>` JSX waiting on that exact field) now
  shows a real avatar.

## Next (mock → real)

Ordered by leverage. Each item is built in isolation, then integrated. Testing is manual for now.

1. **Wire a real "invite friend to my game" action.** The hub can't do this itself — it stops
   tracking your session once you navigate into a game's own origin. Needs `mygame.social.*` to grow
   `createInvite`/`inviteFriend` (currently only on the React `useSocialStore` hook the hub uses
   directly), and the actual game (CIVA, outside this repo) to call them from its lobby/room UI.
   **On hold** — out of scope while work stays to hub+SDK only; the game itself is off-limits for now.
2. **VK account linking.** Mirror the Telegram flow (deferred by request).
3. **Auth hardening.** Decide passwordless vs. password/OTP; real registration; rate limiting; rotate
   `JWT_SECRET` handling.
4. ✅ **Deploy reconciliation, renamed to GAMEHUB.** `deploy/civa` → `deploy/gamehub`: fixed the
   stale `@civa/*` package filter names, added `social`/`chat`/`community`/Postgres containers, and
   gave `social`/`chat` distinct Socket.io paths (`/social.io/`, `/chat.io/`) so neither collides with
   a game lobby's default `/socket.io/`. See `deploy/DEPLOY.md`. There is no GAMEHUB subdomain —
   `mygame-quiz.ru` (root) already forwards to it via Leaders' Caddy.
4a. **Path-based game routing (`mygame-quiz.ru/civa`, not a subdomain).** Proposed direction, not yet
   started: each game currently gets its own *origin* — `externalPort` in `apps/hub/src/platform/
   games.ts`, and the hub's `handlePlay`/`routeToRoom` (`apps/hub/src/platform/inviteRouting.ts`)
   navigate to `http://host:PORT/?pt=...`. Moving to `mygame-quiz.ru/<game>` instead needs: (a) a Caddy
   `handle_path /<game>/*` route per game in `deploy/gamehub/Caddyfile` (or a reverse_proxy the
   orchestrator updates dynamically), (b) each game's own SPA build configured with that path as its
   base (asset URLs, router basename), and (c) `games.ts`/`inviteRouting.ts` switched from
   port-based to path-based addressing. Since exactly one on-demand game runs at a time per the
   current orchestrator model, this shouldn't reintroduce the Socket.io-path-collision problem the
   GAMEHUB rename just fixed — worth confirming when this is picked up.
5. **Decide the fate of `SteamOverlay.tsx`.** Wire it into `HubScreen` (it's a real, working
   Shift+Tab overlay) or delete it — currently dead code (imported, never rendered).
6. **Kick a specific group member from the UI.** The store/API (`removeMember`, owner-only for others)
   already supports it; `ChatWidget` only exposes leave + add so far — add a per-member "remove" action
   (e.g. in a member list / context menu) gated on `ownerId === me`.
7. **Resolve a friend's title to a name/icon.** Right now `FriendsSidebar` only shows a generic 🏅 when
   `titleAchievement` is set (see Phase 11) — showing the actual name needs a per-game display catalog
   the friend-list rendering can call into, without the SDK itself owning game-specific data.

## Verification

- Per service: `corepack pnpm --filter @mygame/<svc> dev:standalone` + `... test`; `/health` responds.
- Hub: `corepack pnpm --filter @mygame/hub dev` → walk every screen.
- Realtime: run `auth` + `social`, connect two clients, exercise add/accept/presence/invite.
- Launch: run `orchestrator` with Docker, `POST /orchestrator/games/:id/enter`, confirm the game's
  containers come up and reap on idle.
