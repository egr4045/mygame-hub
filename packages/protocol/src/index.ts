/**
 * @mygame/protocol — the platform-wide wire protocol: the single source of truth for every
 * message that crosses a *platform* service boundary (auth, invite, social). Services and the
 * client import schemas from here and from nowhere else. This is the isolation contract.
 *
 * Per-game protocols (e.g. a game's lobby/engine messages) live in that game's own repo; they may
 * re-export these platform primitives (envelope, errors, auth) and add their own message files.
 */
import { z } from 'zod';

export * from './envelope.js';
export * from './errors.js';
export * from './auth.js';
export * from './invite.js';
export * from './achievements.js';
export * as social from './social.js';
export * as chat from './chat.js';

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
