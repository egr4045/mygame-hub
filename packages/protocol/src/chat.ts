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

export const chatMessage = z.object({
  id: z.string(),
  conversationId: z.string(),
  senderId: z.string(),
  senderName: z.string(),
  text: z.string(),
  createdAt: z.number(), // epoch ms
  replyToId: z.string().nullable().optional(),
  mentions: z.array(z.string()).optional(),
  attachments: z.array(z.object({
    id: z.string(),
    url: z.string(),
    type: z.string(),
    name: z.string()
  })).optional(),
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
  name: z.string().min(1).max(64),
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
export const sendPayload = z.object({
  conversationId: z.string().min(1),
  text: z.string().max(2000), // Can be empty if there are attachments
  replyToId: z.string().optional(),
  mentions: z.array(z.string()).optional(),
  attachments: z.array(z.object({
    id: z.string(),
    url: z.string(),
    type: z.string(),
    name: z.string()
  })).optional()
});
export const markReadPayload = z.object({ conversationId: z.string().min(1) });
export const getHistoryPayload = z.object({
  conversationId: z.string().min(1),
  limit: z.number().int().positive().max(200).optional(),
});
export const getStatePayload = z.object({}).strict();

export const callType = z.enum(['audio', 'video', 'screen']);
export const callRingPayload = z.object({ conversationId: z.string().min(1), callType });
/** Shared by accept/decline/hangup — all three only ever need to know which call. */
export const callActionPayload = z.object({ conversationId: z.string().min(1) });
export const callTokenRequest = z.object({ conversationId: z.string().min(1) });
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
export type MarkReadPayload = z.infer<typeof markReadPayload>;
export type GetHistoryPayload = z.infer<typeof getHistoryPayload>;
export type CallRingPayload = z.infer<typeof callRingPayload>;
export type CallActionPayload = z.infer<typeof callActionPayload>;
export type CallTokenRequest = z.infer<typeof callTokenRequest>;
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
export const historyAck = z.object({ conversationId: z.string(), messages: z.array(chatMessage) });
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
export type HistoryAck = z.infer<typeof historyAck>;
export type CallAck = z.infer<typeof callAck>;
export type CallTokenResponse = z.infer<typeof callTokenResponse>;

// --- Server -> Client events -------------------------------------------------
export const S2C = {
  threads: 'chat.threads', // full thread list (pushed on connect + whenever it changes)
  message: 'chat.message', // a new message, pushed to every participant of the conversation
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
export const readEvent = z.object({ conversationId: z.string(), byAccountId: z.string(), upTo: z.number() });
export const callRingEvent = z.object({
  conversationId: z.string(),
  fromAccountId: z.string(),
  fromName: z.string(),
  callType,
});
export const callParticipantEvent = z.object({ conversationId: z.string(), accountId: z.string() });
export const callEndedEvent = z.object({ conversationId: z.string() });
/** Pushed once per `typing` call — the client debounces/expires these locally (see chatStore.ts),
 *  the server doesn't track or throttle typing state itself. */
export const typingEvent = z.object({ conversationId: z.string(), accountId: z.string() });

export type ThreadsEvent = z.infer<typeof threadsEvent>;
export type MessageEvent = z.infer<typeof messageEvent>;
export type ReadEvent = z.infer<typeof readEvent>;
export type CallRingEvent = z.infer<typeof callRingEvent>;
export type CallParticipantEvent = z.infer<typeof callParticipantEvent>;
export type CallEndedEvent = z.infer<typeof callEndedEvent>;
export type TypingEvent = z.infer<typeof typingEvent>;
