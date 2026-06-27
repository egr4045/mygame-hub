/**
 * @mygame/protocol — the single source of truth for every message that crosses a service
 * boundary. Services and the client import schemas from here and from nowhere else; no
 * service imports another service's internal modules. This is the isolation contract.
 *
 * As each module is built it adds its own message file (e.g. `lobby.ts`, `engine.ts`) and
 * registers it here. Phase 0 ships the cross-cutting primitives: the envelope and errors.
 */
import { z } from 'zod';

export * from './envelope.js';
export * from './errors.js';
export * from './auth.js';
export * from './invite.js';
export * as lobby from './lobby.js';
export * as social from './social.js';

/**
 * A single typed message: a `type` discriminator string plus a zod schema for its payload.
 * Using `defineMessage` everywhere keeps wire types and runtime validation in lock-step.
 */
export interface MessageDef<TType extends string, TPayload> {
  readonly type: TType;
  readonly schema: z.ZodType<TPayload>;
}

export const defineMessage = <TType extends string, TPayload>(
  type: TType,
  schema: z.ZodType<TPayload>,
): MessageDef<TType, TPayload> => ({ type, schema });

/** Infer the payload type carried by a MessageDef. */
export type PayloadOf<M> = M extends MessageDef<string, infer P> ? P : never;

// ---------------------------------------------------------------------------
// Reconnect primitive (section 2.2): the client asks for a full snapshot and
// re-renders instantly, no loading screen. Each module contributes its slice of
// the snapshot; the concrete shape is assembled as modules land.
// ---------------------------------------------------------------------------

export const getStateRequest = defineMessage('getState', z.object({}).strict());
