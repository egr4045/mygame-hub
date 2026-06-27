# Conventions

Cross-cutting rules every package and service follows. Most are enforced in code under
`packages/protocol` and `packages/shared-types`.

## Contract versioning

- `CONTRACT_VERSION` (in `@mygame/protocol`) is the single version for all wire messages.
- Bump the **major** on any breaking change to a message schema. The gateway rejects a client
  whose major differs, so mismatches fail loudly instead of corrupting state.

## WebSocket envelope

Every WS message, both directions, is wrapped by `envelopeSchema`:

```
{ v, type, seq, ts, traceId?, payload }
```

- `type` — routes the message (e.g. `lobby.join`, `engine.stateDelta`).
- `seq` — per-connection monotonic counter; detects gaps/dupes and enables idempotent commands.
- `ts` — sender clock, informational only. The **server tick clock is authoritative**.
- `traceId` — correlates a command with its ack/result and threads through logs.
- `payload` — validated by the message's own zod schema (`defineMessage`).

## Messages

Define every message with `defineMessage(type, zodSchema)` in `@mygame/protocol`. Never hand-write
a wire type without a matching schema — the schema is the validation and the type source of truth.

## Errors

Map every failure to a canonical `ErrorCode` (`@mygame/protocol`): `unauthorized`, `forbidden`,
`not_found`, `validation`, `conflict`, `rate_limited`, `illegal_action`, `internal`. Throw
`ContractError` internally; serialise with `.toProtocol()` at the boundary.

## Logging & trace-id

- Use the `Logger` port (`@mygame/shared-types`); never call `console.*` directly in logic.
- Real adapter: JSON console logger (pino in Phase 10). Test adapter: capturing logger.
- Always create a child logger bound to `{ svc, traceId }` at the start of handling a command.

## Ports & adapters

Depend on `Clock`, `Logger`, `EventBus` (and storage ports added per service) — never on concrete
infrastructure. Real adapters live in the service; fakes live in `@mygame/test-harness`.

## Determinism

`@mygame/sim-core` is pure: `(state, commands, ctx) -> { state, events }`. No `Date.now`, no
`Math.random` — time comes from an injected `Clock`, randomness from the seeded `Rng`. This is what
makes reconnect snapshots and command-journal replay exact.

## Naming

- Packages: `@mygame/<kebab>`. Internal libs export TypeScript source (`exports: ./src/index.ts`).
- Services: `services/<kebab>`, scaffolded by `corepack pnpm gen:service`.
- Branded ids (`PlayerId`, `SessionId`, …) from `@mygame/shared-types` — don't pass raw strings.
