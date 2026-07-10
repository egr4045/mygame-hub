# @mygame/example-game

A minimal, runnable example of embedding `@mygame/sdk` — copy this folder as the starting point for a
new game on the platform. It's not a real game; every panel just calls one SDK method and shows the
result, so you can see the whole surface working before you build anything on top of it.

## Run it

From the repo root, with the platform services running (`pnpm dev:back` or the individual
`pnpm dev:auth` / `dev:social` / `dev:chat` / `dev:community`):

```sh
pnpm --filter @mygame/example-game dev   # http://localhost:5190
```

It's also registered in the hub's game library (`example-game`), so the normal "ИГРАТЬ" flow from the
hub works too — that's the realistic path (SSO handoff), not opening `localhost:5190` directly. The hub
mints a short-lived handoff token (`?pt=<token>`); this example redeems it with `mygame.auth.loginWithToken(pt)`,
which calls the auth service's `POST /auth/exchange` — the server verifies the token's signature and
type itself and hands back a full session, so the client never decodes or trusts the token locally.

## What it shows

| Panel | Calls |
|---|---|
| Achievements | `mygame.achievements.grant(id)` — idempotent; a genuinely new unlock fires a toast automatically |
| Activity & presence | `mygame.social.setActivity({ game, gameName, room, joinable })` — toggling this on makes the hub's "Найти группы" tab list your room |
| Chat & friends | Nothing to call to get the overlay — `mygame.init()` mounts it. `mygame.chat.open()` toggles the launcher's window |
| Playtime | `mygame.stats.getStats()` — the heartbeat crediting it started automatically inside `init()` |
| Changelog | `mygame.community.getChangelog()` |
| Discussions | `mygame.community.getThreads()` |

## The parts worth copying into a real game

**Bootstrapping (`src/App.tsx`).** A game reached via the hub's launch flow gets a handoff token
(`?pt=<jwt>`), not a normal login form. The pattern here:

1. On mount, check for `?pt=`. If present, call `mygame.auth.loginWithToken(pt)` — this redeems the
   token against the auth service (`POST /auth/exchange`) for a session on *this* origin, on the same
   platform account, without ever needing a password. Strip the token from the URL immediately so it
   never lingers in browser history.
2. Otherwise, fall back to whatever's already logged in on this origin (`mygame.auth.getAccount()`),
   or show a plain login form (`mygame.auth.login(displayName, password)` /
   `mygame.auth.register(displayName, password)`) for local testing without going through the hub.
3. Once there's an account, call `mygame.init(gameId, opts)` **once**. In dev this needs no `opts` —
   the SDK's own defaults already point at each platform service's local port; a deployed build passes
   `{ hubUrl }` (here, via `VITE_HUB_URL`) so one build works against any hub.

**Watch the ordering.** If you seed React state from `mygame.auth.getAccount()` synchronously on
mount, and *also* have an effect that calls `mygame.init()` as soon as that state is truthy, a stale
session left over from a previous visit can win a race against the handoff login that's supposed to
replace it (see `hasPendingHandoff()` in `App.tsx` for the fix — don't trust a stale local session
while a handoff is still unconsumed).

**A real game with its own backend** can redeem the handoff token server-side the same way this example
does client-side — via auth's `POST /auth/exchange` — instead of calling it from the browser; see
`docs/SSO-FEDERATION.md`. Either way, the token's signature, `typ: 'handoff'`, and the account's
continued existence are verified by the auth service itself, never trusted locally. This example has no
backend of its own, so it exchanges the token straight from the browser, as shown in `src/App.tsx`.

## Building your own game from this

1. Copy this directory to `apps/<your-game>`, rename it in `package.json`, and pick a new dev port in
   `vite.config.ts`.
2. Change `GAME_ID` in `App.tsx` to your game's id.
3. Add an entry to `apps/hub/src/platform/games.ts`'s `GAMES` array (`externalPort` = your dev port).
4. Replace the demo panels with your actual game. Keep the bootstrapping block — every game needs it.
5. For the full API surface and the reasoning behind it, see `docs/ARCHITECTURE.md`'s "SDK" section.
