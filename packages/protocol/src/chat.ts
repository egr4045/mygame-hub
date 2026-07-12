import { z } from 'zod';

/**
 * Chat contract (Socket.io) — direct messages *and* group conversations, unified as a single
 * `Conversation` concept (a DM is just a 2-member conversation with `type: 'dm'`). A DM's
 * conversation is found-or-created via `openDm` (deterministic per account pair — calling it twice
 * for the same two accounts returns the same conversation); a group is created explicitly with a name
 * and an initial member list, and its membership can change afterward (`addMembers`/`removeMember`).
 */

export const conversationType = z.enum(['dm', 'group']);
export type ConversationType = z.infer<typeof conversationType>;

/** Attachments must point at this service's own media store (`POST /chat/upload` returns such a
 *  URL) — relative, so the client resolves it against its configured chat origin. Rejecting foreign
 *  URLs closes the stored-link/XSS vector of persisting arbitrary strings. */
export const chatAttachment = z.object({
  id: z.string().max(64),
  url: z.string().max(512).regex(/^\/chat\/media\/[A-Za-z0-9._-]+$/),
  type: z.string().max(64),
  name: z.string().max(128),
});
export type ChatAttachment = z.infer<typeof chatAttachment>;

export const chatMessage = z.object({
  id: z.string(),
  conversationId: z.string(),
  senderId: z.string(),
  senderName: z.string(),
  text: z.string(),
  createdAt: z.number(), // epoch ms
  replyToId: z.string().nullable().optional(),
  mentions: z.array(z.string()).optional(),
  attachments: z.array(chatAttachment).optional(),
  /** Set when the sender edited the message (epoch ms). */
  editedAt: z.number().nullable().optional(),
  /** Tombstone: set when the message was deleted — `text`/`attachments` are blanked server-side,
   *  the row survives so reply chains and ordering stay stable. */
  deletedAt: z.number().nullable().optional(),
});
export type ChatMessage = z.infer<typeof chatMessage>;

export const chatParticipant = z.object({ accountId: z.string(), displayName: z.string() });
export type ChatParticipant = z.infer<typeof chatParticipant>;

/** One conversation as `accountId` should see it: resolved display name + a preview + unread count. */
export const chatThread = z.object({
  conversationId: z.string(),
  type: conversationType,
  /** The other participant's display name (dm) or the group's name. */
  name: z.string(),
  participants: z.array(chatParticipant),
  lastMessage: chatMessage.nullable(),
  unreadCount: z.number(),
  /** dm only: the other participant's last-read timestamp, so the client can render read receipts
   *  (`createdAt <= otherReadAt` = read) without a per-message read flag. Null for groups. */
  otherReadAt: z.number().nullable(),
  /** group only: the creator, who alone may remove *other* members. Null for dm. */
  ownerId: z.string().nullable(),
  /** group only: admins appointed by the owner. */
  admins: z.array(z.string()).optional(),
  /** group only: custom avatar URL. */
  avatarUrl: z.string().nullable().optional(),
  /** group only: pinned message. */
  pinnedMessageId: z.string().nullable().optional(),
});
export type ChatThread = z.infer<typeof chatThread>;

// --- Client -> Server events -------------------------------------------------
export const C2S = {
  openDm: 'chat.openDm', // find-or-create the DM conversation with another account
  createGroup: 'chat.createGroup',
  addMembers: 'chat.addMembers', // group only; any current member may add others
  removeMember: 'chat.removeMember', // group only; self (leave) always allowed, others only by the owner
  setGroupRole: 'chat.setGroupRole', // group only; owner can promote/demote admins
  updateGroupProfile: 'chat.updateGroupProfile', // group only; admins/owner can change name/avatar
  pinMessage: 'chat.pinMessage', // group only; admins/owner can pin a message
  send: 'chat.send',
  edit: 'chat.edit', // sender-only; not on deleted messages
  del: 'chat.delete', // own always; others' only by the group owner/admins (tombstone, not hard delete)
  markRead: 'chat.markRead',
  getHistory: 'chat.getHistory',
  getState: 'chat.getState', // re-request the full thread list (reconnect)
  // Voice/video call signaling — purely live/ephemeral (see server.ts), no persistence. The actual
  // media flows over LiveKit once a client has a token from `POST /chat/call/token`.
  callRing: 'chat.callRing', // start ringing every other participant of a conversation
  callAccept: 'chat.callAccept', // join the call already ringing for this conversation
  callDecline: 'chat.callDecline', // decline without joining
  callHangup: 'chat.callHangup', // leave an active/ringing call
  typing: 'chat.typing',
} as const;

export const openDmPayload = z.object({ withAccountId: z.string().min(1) });
export const createGroupPayload = z.object({
  // Optional — an empty name makes the server/thread view derive one from the member names.
  name: z.string().max(64),
  /** Other members to include; the creator is added automatically. */
  memberIds: z.array(z.string().min(1)).min(1),
});
export const addMembersPayload = z.object({
  conversationId: z.string().min(1),
  memberIds: z.array(z.string().min(1)).min(1),
});
/** `accountId` is the member to remove — pass your own id to leave. */
export const removeMemberPayload = z.object({
  conversationId: z.string().min(1),
  accountId: z.string().min(1),
});
export const setGroupRolePayload = z.object({
  conversationId: z.string().min(1),
  accountId: z.string().min(1),
  role: z.enum(['admin', 'member']),
});
export const updateGroupProfilePayload = z.object({
  conversationId: z.string().min(1),
  name: z.string().min(1).max(64).optional(),
  avatarUrl: z.string().nullable().optional(),
});
export const pinMessagePayload = z.object({
  conversationId: z.string().min(1),
  messageId: z.string().nullable(), // null to unpin
});
export const sendPayload = z
  .object({
    conversationId: z.string().min(1),
    text: z.string().max(2000), // may be empty only when attachments are present
    replyToId: z.string().optional(),
    mentions: z.array(z.string()).optional(),
    attachments: z.array(chatAttachment).max(5).optional(),
  })
  .refine((p) => p.text.trim().length > 0 || (p.attachments?.length ?? 0) > 0, {
    message: 'empty message',
  });
export const editPayload = z.object({
  conversationId: z.string().min(1),
  messageId: z.string().min(1),
  text: z.string().min(1).max(2000),
});
export const deletePayload = z.object({
  conversationId: z.string().min(1),
  messageId: z.string().min(1),
});
export const markReadPayload = z.object({ conversationId: z.string().min(1) });
export const getHistoryPayload = z.object({
  conversationId: z.string().min(1),
  limit: z.number().int().positive().max(200).optional(),
  /** Exclusive upper bound on `createdAt` — pass the oldest loaded message's `createdAt` to page
   *  further back. Omit for the newest page. */
  before: z.number().optional(),
});
export const getStatePayload = z.object({}).strict();

/** `'screen'` is DEPRECATED: screen sharing is now an in-call toggle (a published ScreenShare
 *  track), not a distinct call type. Clients no longer originate `'screen'` rings and treat any
 *  inbound one as `'video'`. The value is kept in the enum so the server (which persists `call.type`)
 *  and older clients don't break; drop it once no client can emit it. */
export const callType = z.enum(['audio', 'video', 'screen']);
export const callRingPayload = z.object({ conversationId: z.string().min(1), callType });
/** Shared by accept/decline/hangup — all three only ever need to know which call. */
export const callActionPayload = z.object({ conversationId: z.string().min(1) });
export const callTokenRequest = z.object({ conversationId: z.string().min(1) });
/** `POST /chat/call/room-token` — mint a LiveKit token for a *game-room* call (portable calls).
 *  The room code is the capability: any authenticated account that knows it may join, matching the
 *  game's own "know the code, you're in" trust posture. */
export const roomCallTokenRequest = z.object({
  game: z.string().min(1).max(64),
  room: z.string().min(1).max(64),
});
/** `POST /chat/call/bind` — alias a game room onto the caller's current *conversation* call, so
 *  players who join the game-room call land in the very same LiveKit room and nobody's media ever
 *  migrates or reconnects. Requires being a participant of that conversation. */
export const bindCallRequest = z.object({
  conversationId: z.string().min(1),
  game: z.string().min(1).max(64),
  room: z.string().min(1).max(64),
});
export const bindCallResponse = z.object({ ok: z.boolean() });
export const typingPayload = z.object({ conversationId: z.string().min(1) });

export const typingAck = z.object({ ok: z.boolean().optional(), error: z.string().optional() });

export type CallType = z.infer<typeof callType>;
export type OpenDmPayload = z.infer<typeof openDmPayload>;
export type CreateGroupPayload = z.infer<typeof createGroupPayload>;
export type AddMembersPayload = z.infer<typeof addMembersPayload>;
export type RemoveMemberPayload = z.infer<typeof removeMemberPayload>;
export type SetGroupRolePayload = z.infer<typeof setGroupRolePayload>;
export type UpdateGroupProfilePayload = z.infer<typeof updateGroupProfilePayload>;
export type PinMessagePayload = z.infer<typeof pinMessagePayload>;
export type SendPayload = z.infer<typeof sendPayload>;
export type EditPayload = z.infer<typeof editPayload>;
export type DeletePayload = z.infer<typeof deletePayload>;
export type MarkReadPayload = z.infer<typeof markReadPayload>;
export type GetHistoryPayload = z.infer<typeof getHistoryPayload>;
export type CallRingPayload = z.infer<typeof callRingPayload>;
export type CallActionPayload = z.infer<typeof callActionPayload>;
export type CallTokenRequest = z.infer<typeof callTokenRequest>;
export type RoomCallTokenRequest = z.infer<typeof roomCallTokenRequest>;
export type BindCallRequest = z.infer<typeof bindCallRequest>;
export type BindCallResponse = z.infer<typeof bindCallResponse>;
export type TypingPayload = z.infer<typeof typingPayload>;
export type TypingAck = z.infer<typeof typingAck>;

/** Acks returned to the caller of the corresponding C2S event. */
export const openDmAck = z.object({ conversationId: z.string().optional(), error: z.string().optional() });
export const createGroupAck = z.object({ conversationId: z.string().optional(), error: z.string().optional() });
export const addMembersAck = z.object({ conversationId: z.string().optional(), error: z.string().optional() });
export const removeMemberAck = z.object({ ok: z.boolean().optional(), error: z.string().optional() });
export const setGroupRoleAck = z.object({ ok: z.boolean().optional(), error: z.string().optional() });
export const updateGroupProfileAck = z.object({ ok: z.boolean().optional(), error: z.string().optional() });
export const pinMessageAck = z.object({ ok: z.boolean().optional(), error: z.string().optional() });
export const sendAck = z.object({ message: chatMessage.optional(), error: z.string().optional() });
export const editAck = z.object({ message: chatMessage.optional(), error: z.string().optional() });
export const deleteAck = z.object({ ok: z.boolean().optional(), error: z.string().optional() });
export const historyAck = z.object({
  conversationId: z.string(),
  messages: z.array(chatMessage),
  /** True when older messages remain before the first one returned (page further with `before`). */
  hasMore: z.boolean().optional(),
});
export const callAck = z.object({ ok: z.boolean(), error: z.string().optional() });
/** Response body of `POST /chat/call/token` (plain HTTP, not a socket ack — see server.ts). */
export const callTokenResponse = z.object({ token: z.string(), url: z.string() });

export type OpenDmAck = z.infer<typeof openDmAck>;
export type CreateGroupAck = z.infer<typeof createGroupAck>;
export type AddMembersAck = z.infer<typeof addMembersAck>;
export type RemoveMemberAck = z.infer<typeof removeMemberAck>;
export type SetGroupRoleAck = z.infer<typeof setGroupRoleAck>;
export type UpdateGroupProfileAck = z.infer<typeof updateGroupProfileAck>;
export type PinMessageAck = z.infer<typeof pinMessageAck>;
export type SendAck = z.infer<typeof sendAck>;
export type EditAck = z.infer<typeof editAck>;
export type DeleteAck = z.infer<typeof deleteAck>;
export type HistoryAck = z.infer<typeof historyAck>;
export type CallAck = z.infer<typeof callAck>;
export type CallTokenResponse = z.infer<typeof callTokenResponse>;

// --- Server -> Client events -------------------------------------------------
export const S2C = {
  threads: 'chat.threads', // full thread list (pushed on connect + whenever it changes)
  message: 'chat.message', // a new message, pushed to every participant of the conversation
  messageEdited: 'chat.messageEdited', // full updated message, pushed to every participant
  messageDeleted: 'chat.messageDeleted', // tombstone notice, pushed to every participant
  read: 'chat.read', // someone read up to `upTo` in a conversation
  error: 'chat.error',
  callRing: 'chat.callRing', // pushed to every other participant when someone starts ringing
  callAccepted: 'chat.callAccepted', // pushed to everyone already in the call when accountId joins
  callDeclined: 'chat.callDeclined', // pushed to the ringer(s) when accountId declines
  callEnded: 'chat.callEnded', // pushed to everyone once the call has no participants left
  typing: 'chat.typing', // pushed to every other participant when someone is typing
} as const;

export const threadsEvent = z.object({ threads: z.array(chatThread) });
export const messageEvent = z.object({ message: chatMessage });
export const messageEditedEvent = z.object({ message: chatMessage });
export const messageDeletedEvent = z.object({
  conversationId: z.string(),
  messageId: z.string(),
  deletedAt: z.number(),
});
export const readEvent = z.object({ conversationId: z.string(), byAccountId: z.string(), upTo: z.number() });
export const callRingEvent = z.object({
  conversationId: z.string(),
  fromAccountId: z.string(),
  fromName: z.string(),
  callType,
});
export const callParticipantEvent = z.object({ conversationId: z.string(), accountId: z.string() });
/** `reason: 'timeout'` = the server's ring sweep gave up on an unanswered ring (no one to blame,
 *  the caller shows "no answer" and the still-ringing callees just clear their banner). */
export const callEndedEvent = z.object({
  conversationId: z.string(),
  reason: z.enum(['ended', 'timeout']).optional(),
});
/** Pushed once per `typing` call — the client debounces/expires these locally (see chatStore.ts),
 *  the server doesn't track or throttle typing state itself. */
export const typingEvent = z.object({ conversationId: z.string(), accountId: z.string() });

export type ThreadsEvent = z.infer<typeof threadsEvent>;
export type MessageEvent = z.infer<typeof messageEvent>;
export type MessageEditedEvent = z.infer<typeof messageEditedEvent>;
export type MessageDeletedEvent = z.infer<typeof messageDeletedEvent>;
export type ReadEvent = z.infer<typeof readEvent>;
export type CallRingEvent = z.infer<typeof callRingEvent>;
export type CallParticipantEvent = z.infer<typeof callParticipantEvent>;
export type CallEndedEvent = z.infer<typeof callEndedEvent>;
export type TypingEvent = z.infer<typeof typingEvent>;
