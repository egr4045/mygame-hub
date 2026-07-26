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
  request: 'social.request', // send a friend request by short friend code (or raw accountId); ack {ok|error}
  search: 'social.search', // find accounts by display name OR friend code (ack returns matches + my relation)
  accept: 'social.accept',
  decline: 'social.decline', // decline an incoming request / cancel an outgoing one
  remove: 'social.remove',
  setActivity: 'social.setActivity', // report what I'm playing (null to clear)
  getState: 'social.getState',
  createInvite: 'social.createInvite', // mint a join code for a room (ack returns { code })
  inviteFriend: 'social.inviteFriend', // mint a code and push it to a friend's presence channel
  block: 'social.block', // hide presence/activity from `accountId` both ways, reject their requests
  unblock: 'social.unblock', // restore visibility — does not re-friend, the edge was never touched
  getBlocked: 'social.getBlocked', // accounts *I* have blocked (ack) — for an unblock list
  markNotificationsRead: 'social.markNotificationsRead', // mark notification keys read (ack {ok})
} as const;

/** Notification read-state. Only the *keys* travel: the notification center builds its rows from the
 *  sources that already own them (friend edges, the chat call-log, achievements, invites) and mints a
 *  stable key per row, so read-state is shared across devices without duplicating any content.
 *  Server-side read state is the whole point — an unread badge that a second device already cleared
 *  is exactly the bug this replaces. */
export const markNotificationsReadPayload = z.object({ keys: z.array(z.string().min(1).max(200)).max(200) });
export const markNotificationsReadAck = z.object({ ok: z.boolean() });
export type MarkNotificationsReadPayload = z.infer<typeof markNotificationsReadPayload>;
export type MarkNotificationsReadAck = z.infer<typeof markNotificationsReadAck>;

export const requestPayload = z.object({ code: z.string().min(1).max(64) });
export const requestAck = z.object({ ok: z.boolean().optional(), error: z.string().optional() });
export type RequestAck = z.infer<typeof requestAck>;

/** Find people to friend by typing a name OR a friend code — the server ranks exact code matches
 *  first, then name matches. `relation` lets the UI show the right action (add / pending / already a
 *  friend) and recognise yourself. Avatar + code come back so you can spot the right person visually. */
export const searchPayload = z.object({ query: z.string().min(1).max(64) });
export const searchRelation = z.enum(['self', 'friend', 'incoming', 'outgoing', 'none']);
export type SearchRelation = z.infer<typeof searchRelation>;
export const searchResult = z.object({
  accountId: z.string(),
  displayName: z.string(),
  avatarIcon: z.string().nullable(),
  friendCode: z.string().nullable(),
  titleAchievement: titleAchievementRef,
  relation: searchRelation,
});
export type SearchResult = z.infer<typeof searchResult>;
export const searchAck = z.object({ results: z.array(searchResult) });
export type SearchPayload = z.infer<typeof searchPayload>;
export type SearchAck = z.infer<typeof searchAck>;
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

export const blockAck = z.object({ ok: z.boolean() });
export const blockedAccount = z.object({ accountId: z.string(), displayName: z.string() });
export const getBlockedAck = z.object({ blocked: z.array(blockedAccount) });

export type RequestPayload = z.infer<typeof requestPayload>;
export type TargetPayload = z.infer<typeof targetPayload>;
export type SetActivityPayload = z.infer<typeof setActivityPayload>;
export type InviteTarget = z.infer<typeof inviteTarget>;
export type InviteFriendPayload = z.infer<typeof inviteFriendPayload>;
export type CreateInviteAck = z.infer<typeof createInviteAck>;
export type BlockAck = z.infer<typeof blockAck>;
export type BlockedAccount = z.infer<typeof blockedAccount>;
export type GetBlockedAck = z.infer<typeof getBlockedAck>;

// --- Server -> Client events -------------------------------------------------
export const S2C = {
  friends: 'social.friends', // full friends list (presence + activity)
  me: 'social.me', // your identity — accountId doubles as your friend code
  invite: 'social.invite', // a friend invited you somewhere (pushed)
  notificationsRead: 'social.notificationsRead', // keys this account has read (full set, pushed on connect + after a mark)
  error: 'social.error',
} as const;

/** The complete set of read keys for this account — pushed on connect and re-pushed after a mark, so
 *  a second device's «прочитано» lands here too. */
export const notificationsReadEvent = z.object({ keys: z.array(z.string()) });
export type NotificationsReadEvent = z.infer<typeof notificationsReadEvent>;

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
