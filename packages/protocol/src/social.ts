import { z } from 'zod';
import { errorSchema } from './errors.js';
import { invite, inviteRole } from './invite.js';
import { titleAchievementRef } from './auth.js';

/**
 * Social contract (Socket.io) — the game-agnostic platform layer: friends + presence. A player is
 * identified by their platform account (from the JWT), so this is shared across every game. The
 * server pushes the *full* friends list (each friend's presence + current activity) whenever
 * anything changes — simple and correct at this scale. Invites / join-codes are their own module.
 */

export const presence = z.enum(['online', 'offline']);
export type Presence = z.infer<typeof presence>;

/** What a friend is currently doing — drives Steam-style "playing X · Join". Null when idle. */
export const activity = z
  .object({
    game: z.string(), // game id, e.g. 'civa'
    gameName: z.string(), // human label
    room: z.string().nullable(), // room/session id if in one (enables Join/Spectate)
    joinable: z.boolean(), // is the room open to friends right now
  })
  .nullable();
export type Activity = z.infer<typeof activity>;

export const friendStatus = z.enum(['accepted', 'incoming', 'outgoing']);
export type FriendStatus = z.infer<typeof friendStatus>;

export const friend = z.object({
  accountId: z.string(),
  displayName: z.string(),
  /** Mirrored from the shared `accounts` table (auth is authoritative) — see ARCHITECTURE.md. */
  avatarIcon: z.string().nullable(),
  titleAchievement: titleAchievementRef,
  status: friendStatus,
  presence,
  activity,
});
export type Friend = z.infer<typeof friend>;

// --- Client -> Server events -------------------------------------------------
export const C2S = {
  request: 'social.request', // send a friend request by code (= target accountId)
  accept: 'social.accept',
  decline: 'social.decline', // decline an incoming request / cancel an outgoing one
  remove: 'social.remove',
  setActivity: 'social.setActivity', // report what I'm playing (null to clear)
  getState: 'social.getState',
  createInvite: 'social.createInvite', // mint a join code for a room (ack returns { code })
  inviteFriend: 'social.inviteFriend', // mint a code and push it to a friend's presence channel
  getLobbies: 'social.getLobbies', // list joinable rooms for a game, derived from live presence (ack)
  block: 'social.block', // hide presence/activity from `accountId` both ways, reject their requests
  unblock: 'social.unblock', // restore visibility — does not re-friend, the edge was never touched
  getBlocked: 'social.getBlocked', // accounts *I* have blocked (ack) — for an unblock list
} as const;

export const requestPayload = z.object({ code: z.string().min(1).max(64) });
export const targetPayload = z.object({ accountId: z.string().min(1) });
export const setActivityPayload = z.object({ activity });
export const getStatePayload = z.object({}).strict();

/** What to invite into — a room in a game, with a role. */
export const inviteTarget = z.object({
  game: z.string(),
  gameName: z.string(),
  room: z.string(),
  role: inviteRole,
});
export const createInvitePayload = inviteTarget;
export const inviteFriendPayload = inviteTarget.extend({ accountId: z.string().min(1) });
/** Ack returned to the creator of an invite. */
export const createInviteAck = z.object({ code: z.string() });

export const getLobbiesPayload = z.object({ game: z.string().min(1) });

/**
 * A joinable room for a game, derived live from who's currently online with `activity.joinable`
 * set — not persisted (see server.ts's `activityOf`/`socketsOf`). Sparse until games actually call
 * `setActivity({ joinable: true, room })`.
 */
export const lobby = z.object({
  room: z.string(),
  hostAccountId: z.string(),
  hostName: z.string(),
  joinable: z.boolean(),
  memberCount: z.number(),
});
export const getLobbiesAck = z.object({ lobbies: z.array(lobby) });

export const blockAck = z.object({ ok: z.boolean() });
export const blockedAccount = z.object({ accountId: z.string(), displayName: z.string() });
export const getBlockedAck = z.object({ blocked: z.array(blockedAccount) });

export type RequestPayload = z.infer<typeof requestPayload>;
export type TargetPayload = z.infer<typeof targetPayload>;
export type SetActivityPayload = z.infer<typeof setActivityPayload>;
export type InviteTarget = z.infer<typeof inviteTarget>;
export type InviteFriendPayload = z.infer<typeof inviteFriendPayload>;
export type CreateInviteAck = z.infer<typeof createInviteAck>;
export type GetLobbiesPayload = z.infer<typeof getLobbiesPayload>;
export type Lobby = z.infer<typeof lobby>;
export type GetLobbiesAck = z.infer<typeof getLobbiesAck>;
export type BlockAck = z.infer<typeof blockAck>;
export type BlockedAccount = z.infer<typeof blockedAccount>;
export type GetBlockedAck = z.infer<typeof getBlockedAck>;

// --- Server -> Client events -------------------------------------------------
export const S2C = {
  friends: 'social.friends', // full friends list (presence + activity)
  me: 'social.me', // your identity — accountId doubles as your friend code
  invite: 'social.invite', // a friend invited you somewhere (pushed)
  error: 'social.error',
} as const;

export const friendsEvent = z.object({ friends: z.array(friend) });
export const meEvent = z.object({
  accountId: z.string(),
  displayName: z.string(),
  avatarIcon: z.string().nullable(),
  titleAchievement: titleAchievementRef,
});
export const inviteEvent = z.object({ invite });
export const errorEvent = errorSchema;

export type FriendsEvent = z.infer<typeof friendsEvent>;
export type MeEvent = z.infer<typeof meEvent>;
export type InviteEvent = z.infer<typeof inviteEvent>;
