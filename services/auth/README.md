# @mygame/auth

A GAMEHUB platform service (identity — every game on the platform, not just one). Isolated module —
talks to the outside only through `@mygame/protocol`.

```sh
corepack pnpm --filter @mygame/auth dev:standalone   # run in isolation (fake adapters)
corepack pnpm --filter @mygame/auth test             # unit + contract tests
corepack pnpm --filter @mygame/auth dev              # run with real adapters
```

Port: `AUTH_PORT` (default 8081).
