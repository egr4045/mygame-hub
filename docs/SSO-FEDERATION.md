# SSO federation — how a game accepts the platform login

The platform (`services/auth`) is the **identity provider**. A player logs in once on the launcher;
each game **federates** that identity into its own user table instead of asking for a second login.
This is the contract every game on the platform implements. CIVA needs nothing extra — it is served
by the platform and already shares the session.

## The mechanism (Steam-style hand-off)

1. The launcher mints a **handoff token** for the player: `POST /auth/handoff { refreshToken }` →
   `{ handoffToken, accountId, displayName }`. It is a short-lived (default **120s**) HS256 JWT.
2. The launcher opens the game carrying it: `https://host:PORT/?pt=<handoffToken>` (or a QR encoding
   the same URL — see P6 companion).
3. The game's SPA reads `?pt=` on boot, calls its **own** `POST /auth/platform` with the token,
   stores the game-native session it gets back, and strips `pt` from the URL.
4. `POST /auth/platform` **verifies** the token, **upserts** a local user keyed by the platform
   account id, and returns the game's normal session payload.

The long-lived access/refresh tokens never leave the launcher; only the 120s handoff token travels
in the URL, so a leak (history, logs) expires almost immediately.

> ⚠️ Current limitation: the platform account store is **in-memory** (`STATUS.md`). The platform
> account id (`sub`) is stable only while the `auth` service stays up — a restart re-issues ids.
> Games federate on `sub`, so durable cross-game identity depends on the planned Postgres adapter.

## The platform token

- Algorithm **HS256**, signed with the secret in `JWT_SECRET` (the same value must be configured on
  every game — that is the shared-secret trust anchor; a JWKS/asymmetric upgrade is the later path).
- Issuer (`iss`) is `civa`.
- Claims: `sub` = platform account id (stable identity), `name` = display name, `typ` = token type
  (`access` | `refresh` | `handoff`), plus standard `iat` / `exp`.
- A game's `/auth/platform` should accept `typ` of **`handoff`** (URL/QR hand-off) and **`access`**
  (direct API calls), and reject `refresh`.

## `POST /auth/platform` — what each game adds

Request: `Authorization: Bearer <platform token>` (or `{ token }` in the body).
Behavior: verify (HS256, secret `JWT_SECRET`, issuer `civa`, not expired, `typ` ∈ {handoff, access})
→ `upsert user where platform_id = claims.sub` (name = `claims.name`) → return the game's own session.

### svoyak (Express + jsonwebtoken) — `server/auth.js`

svoyak already does `jwt.verify(token, JWT_SECRET)` and issues `{ id, username }` tokens, so this is
small. Map platform claims onto svoyak's shape (`sub → id`, `name → username`):

```js
// POST /auth/platform  { token }   (or Authorization: Bearer <token>)
router.post('/auth/platform', (req, res) => {
  const token = (req.body && req.body.token) || (req.headers.authorization || '').split(' ')[1];
  if (!token) return res.status(401).json({ error: 'missing token' });
  let claims;
  try { claims = jwt.verify(token, JWT_SECRET, { issuer: 'civa' }); } // same shared secret
  catch { return res.status(403).json({ error: 'invalid platform token' }); }
  if (!['handoff', 'access'].includes(claims.typ)) return res.status(403).json({ error: 'bad typ' });

  // Upsert a local user mapped to the platform account id.
  db.get('SELECT * FROM users WHERE platform_id = ?', [claims.sub], (err, user) => {
    const finish = (u) => {
      const svoyakToken = jwt.sign({ id: u.id, username: u.username }, JWT_SECRET, { expiresIn: '24h' });
      res.json({ token: svoyakToken, user: { id: u.id, username: u.username, avatar: u.avatar } });
    };
    if (user) return finish(user);
    db.run(
      'INSERT INTO users (username, platform_id, password_hash) VALUES (?, ?, ?)',
      [claims.name, claims.sub, ''],   // platform users have no local password
      function () { finish({ id: this.lastID, username: claims.name, avatar: null }); },
    );
  });
});
```

Requires a one-time `ALTER TABLE users ADD COLUMN platform_id TEXT UNIQUE;` (and configuring the
container's `JWT_SECRET` to the platform value). SPA boot: if `?pt=` present, `POST /auth/platform`,
store the returned svoyak token where the app already keeps it, then `history.replaceState` to drop
the param.

### Leaders (NestJS)

Add a route/strategy that verifies the platform JWT with the shared secret (`@nestjs/jwt` with
`secret: JWT_SECRET`, `issuer: 'civa'`), upserts a Leaders user on `platform_id = sub`, and returns
Leaders' usual auth payload. Additive — do not change the existing local login. Read the live
service on the server first; must not disturb the running game.

## Wiring `JWT_SECRET`

All of platform-auth, svoyak, and Leaders must share the **same** `JWT_SECRET` value (set per
container in deploy; never committed). That single secret is what lets each game trust the platform's
signature. See `docs/SERVER.md` for where deploy env lives.
