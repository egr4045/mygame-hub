# @mygame/auth

A CIVA backend service. Isolated module — talks to the outside only through `@mygame/protocol`.

```sh
corepack pnpm --filter @mygame/auth dev:standalone   # run in isolation (fake adapters)
corepack pnpm --filter @mygame/auth test             # unit + contract tests
corepack pnpm --filter @mygame/auth dev              # run with real adapters
```

Port: `AUTH_PORT` (default 8080).
