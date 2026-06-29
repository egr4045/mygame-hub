# Conventions

Cross-cutting rules every platform package and service follows. Most are enforced in code under
`@mygame/protocol` and `@mygame/shared-types`.

## Contract versioning

- `CONTRACT_VERSION` (in `@mygame/protocol`, `envelope.ts`) is the single version for all wire
  messages. Currently `0.1.0`.
- Bump the **major** on any breaking schema change. A transport that checks the envelope `v` rejects a
  mismatched major, so clients fail loudly instead of corrupting state.

## WebSocket envelope

A reusable envelope (`envelopeSchema` / `makeEnvelope`) wraps WS messages:

```
{ v, type, seq, ts, traceId?, payload }
```

- `type` — routes the message.
- `seq` — per-connection monotonic counter; detects gaps/dupes, enables idempotent commands.
- `ts` — sender clock, informational only.
- `traceId` — correlates a command with its ack/result and threads through logs.
- `payload` — validated by the message's own zod schema.

> Note: the current `social` service uses Socket.io named events (`social.*`) rather than the envelope
> directly; the envelope is the convention for game protocols and future enveloped transports.

## Messages

Define typed messages with `defineMessage(type, zodSchema)` in `@mygame/protocol`. Never hand-write a
wire type without a matching schema — the schema is both the validation and the type source of truth.
Platform message families live in `auth.ts`, `social.ts`, `invite.ts`.

## Errors

Map every failure to a canonical `ErrorCode` (`@mygame/protocol/errors.ts`): `unauthorized`,
`forbidden`, `not_found`, `validation`, `conflict`, `rate_limited`, `illegal_action`, `internal`.
Throw `ContractError` internally; serialise with `.toProtocol()` at the boundary (the `social` server
does this in its `guard()` wrapper).

## Ports & adapters

Depend on `Clock`, `Logger` (`@mygame/shared-types/ports.ts`) and the per-service storage ports
(`AccountStore`, `SocialStore`, `InviteStore`), never on concrete infrastructure. Real adapters live
in the service; in-memory fakes live in the service and/or `@mygame/test-harness`. The `index.ts`
entry wires real adapters; `standalone.ts` wires in-memory ones.

> Reality check: real adapters today are only the in-memory ones (and Docker/HTTP for the
> orchestrator). Postgres adapters are the next step — see `STATUS.md` / `PLAN.md`.

## Logging

- Use the `Logger` port; avoid `console.*` directly in logic.
- Real adapter: a JSON console logger (`createConsoleLogger`). Bind a child logger to `{ svc }` (and
  `{ traceId }` once enveloped transports thread it).

## Secrets

- Never commit secrets. `JWT_SECRET` (shared with games for SSO), `TELEGRAM_BOT_TOKEN`, DB creds, etc.
  come from the environment / deploy `.env`. Code reads them via `config.ts` with safe dev defaults
  only for local work (e.g. `dev-only-change-me`).

## Naming

- Packages: `@mygame/<kebab>`. Internal libs export TypeScript source (`exports: ./src/index.ts`).
- Services: `services/<kebab>`, scaffolded by `corepack pnpm gen:service`.
- Branded ids (`AccountId`, `SessionId`, …) from `@mygame/shared-types` — prefer them over raw
  strings at boundaries.

## Determinism (game-side)

`@mygame/sim-core`-style determinism (pure `(state, commands, ctx) → { state, events }`, injected
clock + seeded RNG) is a **game** convention, not a platform one. It lives in each game's repo; the
platform services here are ordinary I/O services.
