# @mygame/community

Per-game changelog + discussion forum. A CIVA backend service — isolated module, talks to the outside
only through `@mygame/protocol`. See `docs/ARCHITECTURE.md` for why this is its own service rather
than a route on `auth`.

```sh
corepack pnpm --filter @mygame/community dev:standalone   # run in isolation (in-memory)
corepack pnpm --filter @mygame/community test             # unit + contract tests
corepack pnpm --filter @mygame/community dev              # run with real adapters
```

Env:
- `COMMUNITY_PORT` (default 8085)
- `JWT_SECRET` / `JWT_ISSUER` — must match `auth`'s, so tokens it issues verify here too
- `COMMUNITY_ADMIN_IDS` — comma-separated account ids allowed to publish changelog entries. Empty =
  reads still work, nobody can publish. Discussions need no allowlist.
- `DATABASE_URL` — Postgres-backed when set; in-memory (lost on restart) otherwise
