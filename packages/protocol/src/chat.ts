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
});
export type ChatThread = z.infer<typeof chatThread>;

// --- Client -> Server events -------------------------------------------------
export const C2S = {
  openDm: 'chat.openDm', // find-or-create the DM conversation with another account
  createGroup: 'chat.createGroup',
  addMembers: 'chat.addMembers', // group only; any current member may add others
  removeMember: 'chat.removeMember', // group only; self (leave) always allowed, others only by the owner
  send: 'chat.send',
  markRead: 'chat.markRead',
  getHistory: 'chat.getHistory',
  getState: 'chat.getState', // re-request the full thread list (reconnect)
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
export const sendPayload = z.object({ conversationId: z.string().min(1), text: z.string().min(1).max(2000) });
export const markReadPayload = z.object({ conversationId: z.string().min(1) });
export const getHistoryPayload = z.object({
  conversationId: z.string().min(1),
  limit: z.number().int().positive().max(200).optional(),
});
export const getStatePayload = z.object({}).strict();

export type OpenDmPayload = z.infer<typeof openDmPayload>;
export type CreateGroupPayload = z.infer<typeof createGroupPayload>;
export type AddMembersPayload = z.infer<typeof addMembersPayload>;
export type RemoveMemberPayload = z.infer<typeof removeMemberPayload>;
export type SendPayload = z.infer<typeof sendPayload>;
export type MarkReadPayload = z.infer<typeof markReadPayload>;
export type GetHistoryPayload = z.infer<typeof getHistoryPayload>;

/** Acks returned to the caller of the corresponding C2S event. */
export const openDmAck = z.object({ conversationId: z.string().optional(), error: z.string().optional() });
export const createGroupAck = z.object({ conversationId: z.string().optional(), error: z.string().optional() });
export const addMembersAck = z.object({ conversationId: z.string().optional(), error: z.string().optional() });
export const removeMemberAck = z.object({ ok: z.boolean().optional(), error: z.string().optional() });
export const sendAck = z.object({ message: chatMessage.optional(), error: z.string().optional() });
export const historyAck = z.object({ conversationId: z.string(), messages: z.array(chatMessage) });

export type OpenDmAck = z.infer<typeof openDmAck>;
export type CreateGroupAck = z.infer<typeof createGroupAck>;
export type AddMembersAck = z.infer<typeof addMembersAck>;
export type RemoveMemberAck = z.infer<typeof removeMemberAck>;
export type SendAck = z.infer<typeof sendAck>;
export type HistoryAck = z.infer<typeof historyAck>;

// --- Server -> Client events -------------------------------------------------
export const S2C = {
  threads: 'chat.threads', // full thread list (pushed on connect + whenever it changes)
  message: 'chat.message', // a new message, pushed to every participant of the conversation
  read: 'chat.read', // someone read up to `upTo` in a conversation
  error: 'chat.error',
} as const;

export const threadsEvent = z.object({ threads: z.array(chatThread) });
export const messageEvent = z.object({ message: chatMessage });
export const readEvent = z.object({ conversationId: z.string(), byAccountId: z.string(), upTo: z.number() });

export type ThreadsEvent = z.infer<typeof threadsEvent>;
export type MessageEvent = z.infer<typeof messageEvent>;
export type ReadEvent = z.infer<typeof readEvent>;
