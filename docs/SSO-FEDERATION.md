# SSO federation — how a game accepts the platform login

The platform (`services/auth`) is the **identity provider**. A player logs in once on the launcher;
each game **federates** that identity into its own user table instead of asking for a second login.
This is the contract every game on the platform implements. CIVA needs nothing extra — it is served
by the platform and already shares the session.

## The mechanism (Steam-style hand-off)

1. The launcher mints a **handoff token** for the player: `POST /auth/handoff { refreshToken }` →
   `{ handoffToken, accountId, displayName }`. It is a short-lived (default **120s**) HS256 JWT,
   authorized by the holder's refresh token (see `packages/auth-core/src/index.ts`'s `signHandoff`
   and `services/auth/src/app.ts`'s `/auth/handoff` route).
2. The launcher opens the game carrying it: `https://host:PORT/?pt=<handoffToken>` (or a QR encoding
   the same URL for the cross-device "companion" case — still roadmap, not built yet; see
   `docs/ROADMAP-PLATFORM.md`'s "Cross-device handoff").
3. A game built on `@mygame/sdk` reads `?pt=` on boot and calls `mygame.auth.loginWithToken(pt)`
   (`packages/sdk/src/client.ts`, backed by `exchangeHandoff` in `packages/sdk/src/authClient.ts`),
   which redeems the token against the **auth service's own** `POST /auth/exchange`, then strips `pt`
   from the URL. `apps/example-game/src/App.tsx`'s `pt` `useEffect` is the reference implementation.
4. `POST /auth/exchange` **verifies** the token's signature, requires `typ === 'handoff'`, and confirms
   the account still exists (`404` if not — see the migration gap below). On success it mints a fresh
   access/refresh pair for that same account and returns a full session:
   `{ accountId, displayName, accessToken, refreshToken }`. There is no per-game "upsert a local user"
   step here — the game just inherits the same platform account and session. The client never
   decodes or trusts the JWT itself; the auth service is the only party that verifies it.

The long-lived access/refresh tokens never leave the launcher; only the 120s handoff token travels
in the URL, so a leak (history, logs) expires almost immediately.

> ⚠️ Auth is password-based, not passwordless. `POST /auth/register { displayName, password }`
> creates a new account (`409` if the name is taken); `POST /auth/login { displayName, password }`
> authenticates an existing one (`401` on a wrong password or unknown name). There is no more
> "reclaim an account by id with no password" flow — every account row has a `passwordHash`
> (`services/auth/src/store.ts`), checked with `scrypt` + a constant-time compare
> (`services/auth/src/app.ts`).

> ⚠️ Known gap, not yet solved: the account store **is** Postgres-backed now (write-behind, hydrated
> on boot — `packages/platform-db`), so `sub` is durable across restarts; the "planned Postgres
> adapter" this doc used to gate durability on has landed. But the migration that added the required
> `password_hash` column (`packages/platform-db/src/index.ts`) backfilled every pre-existing row to an
> **empty string**, and verifying a password against an empty hash always fails. Any account created
> before that migration runs is therefore permanently locked out of its old displayName/identity once
> it deploys — there is no recovery path implemented yet. This needs a decision before deploying to a
> server that already has real accounts on it; don't treat it as solved.

## The platform token

- Algorithm **HS256**, signed with the secret in `JWT_SECRET` (a JWKS/asymmetric upgrade is the later
  path).
- Issuer (`iss`) defaults to `civa` (overridable via `JWT_ISSUER`).
- Claims: `sub` = platform account id (stable identity), `name` = display name, `typ` = token type
  (`access` | `refresh` | `handoff`), plus standard `iat` / `exp`.
- `POST /auth/exchange` only accepts `typ === 'handoff'` — it rejects `access` and `refresh` tokens
  outright (`401 not a handoff token`). `access` tokens authenticate the platform's own HTTP APIs
  directly (`Authorization: Bearer`); `refresh` tokens only mint new access/handoff tokens.

## `POST /auth/exchange` — reached over the network, not reimplemented per game

Unlike the old design, this route lives **once**, on the platform's own `auth` service — a game does
not implement a same-named route itself. Request: `{ handoffToken }` (JSON body, no auth header).
Behavior: verify (HS256, secret `JWT_SECRET`, issuer `civa` by default, not expired, `typ ===
'handoff'`) → look up the account by `claims.sub` (`404` if it no longer exists) → sign a fresh
access/refresh pair → return `{ accountId, displayName, accessToken, refreshToken }`.

A game built on `@mygame/sdk` gets this for free (`mygame.auth.loginWithToken`, step 3 above). A game
with its own separate backend/session model — svoyak, Leaders — still needs a small bridge, but it now
calls this endpoint **over the network** instead of verifying the JWT itself; it never needs
`JWT_SECRET`.

### svoyak (Express + jsonwebtoken) — `server/auth.js`

svoyak already issues its own `{ id, username }` tokens, so this is small. It never sees the
platform's `JWT_SECRET` — it asks the auth service to redeem the token instead, then maps the
returned identity onto svoyak's shape (`accountId → id`, `displayName → username`):

```js
// POST /auth/platform-bridge  { pt }
router.post('/auth/platform-bridge', async (req, res) => {
  const handoffToken = req.body && req.body.pt;
  if (!handoffToken) return res.status(401).json({ error: 'missing token' });

  // Ask the platform's own auth service to verify + redeem it. svoyak never holds JWT_SECRET.
  let accountId, displayName;
  try {
    const r = await fetch(`${PLATFORM_AUTH_URL}/auth/exchange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handoffToken }),
    });
    if (!r.ok) return res.status(403).json({ error: 'invalid platform token' });
    ({ accountId, displayName } = await r.json()); // also carries accessToken/refreshToken, unused here
  } catch {
    return res.status(502).json({ error: 'platform auth unreachable' });
  }

  // Upsert a local user mapped to the platform account id.
  db.get('SELECT * FROM users WHERE platform_id = ?', [accountId], (err, user) => {
    const finish = (u) => {
      const svoyakToken = jwt.sign({ id: u.id, username: u.username }, SVOYAK_JWT_SECRET, { expiresIn: '24h' });
      res.json({ token: svoyakToken, user: { id: u.id, username: u.username, avatar: u.avatar } });
    };
    if (user) return finish(user);
    db.run(
      'INSERT INTO users (username, platform_id, password_hash) VALUES (?, ?, ?)',
      [displayName, accountId, ''],   // platform-federated users have no local svoyak password
      function () { finish({ id: this.lastID, username: displayName, avatar: null }); },
    );
  });
});
```

Requires a one-time `ALTER TABLE users ADD COLUMN platform_id TEXT UNIQUE;` and a `PLATFORM_AUTH_URL`
pointed at the auth service (no shared secret to configure — `SVOYAK_JWT_SECRET` above is svoyak's own
local session secret, unrelated to the platform's). SPA boot: if `?pt=` present, `POST
/auth/platform-bridge`, store the returned svoyak token where the app already keeps it, then
`history.replaceState` to drop the param.

### Leaders (NestJS)

Add a route that calls the platform's own `POST /auth/exchange` (plain HTTP, e.g. via `HttpService`
or `fetch`) with the handoff token, upserts a Leaders user on `platform_id = accountId` from the
response, and returns Leaders' usual auth payload. Additive — do not change the existing local login.
Read the live service on the server first; must not disturb the running game.

## Reaching the platform's auth service

A bridging game only needs the auth service's base URL reachable over the network to call `POST
/auth/exchange` (see `docs/SERVER.md` for where that's configured per deploy) — not `JWT_SECRET`
itself. `JWT_SECRET` stays internal to `services/auth`, shared only with the platform's own
`social`/`chat`/`community` services, which verify access tokens locally via `@mygame/auth-core` for
their own APIs — a separate concern from this handoff.
