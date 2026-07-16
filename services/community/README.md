# @mygame/community

Per-game changelog + discussion forum, shared across every game on the platform (not one game's
service). A GAMEHUB platform service — isolated module, talks to the outside only through
`@mygame/protocol`. See `docs/ARCHITECTURE.md` for why this is its own service rather than a route on
`auth`.

```sh
corepack pnpm --filter @mygame/community dev:standalone   # run in isolation (in-memory)
corepack pnpm --filter @mygame/community test             # unit + contract tests
corepack pnpm --filter @mygame/community dev              # run with real adapters
```

Env:
- `COMMUNITY_PORT` (default 8085)
- `JWT_SECRET` / `JWT_ISSUER` — must match `auth`'s, so tokens it issues verify here too
- `DATABASE_URL` — Postgres-backed when set; in-memory (lost on restart) otherwise. Also gates
  changelog publishing: without it, this service can't check the caller's `is_admin` flag (see
  `adminCheck.ts`), so publishing 403s for everyone regardless of role. The flag itself is set on
  `auth` via `AUTH_BOOTSTRAP_ADMIN_IDS`/`apps/admin` — not configured here.
