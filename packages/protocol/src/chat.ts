import { z } from 'zod';

/**
 * Chat contract (Socket.io) — direct messages between two accounts. Group chat is not modelled yet
 * (see docs/PLAN.md — DMs first). A thread has no id of its own: since it's always exactly two
 * accounts, the *other* account's id identifies the thread from either side's point of view.
 */

export const chatMessage = z.object({
  id: z.string(),
  senderId: z.string(),
  recipientId: z.string(),
  text: z.string(),
  createdAt: z.number(), // epoch ms
  readAt: z.number().nullable(),
});
export type ChatMessage = z.infer<typeof chatMessage>;

/** One DM thread as `accountId` should see it: the other party + a preview + unread count. */
export const chatThread = z.object({
  accountId: z.string(),
  displayName: z.string(),
  lastMessage: chatMessage.nullable(),
  unreadCount: z.number(),
});
export type ChatThread = z.infer<typeof chatThread>;

// --- Client -> Server events -------------------------------------------------
export const C2S = {
  send: 'chat.send',
  markRead: 'chat.markRead', // mark all messages from `withAccountId` as read
  getHistory: 'chat.getHistory',
  getState: 'chat.getState', // re-request the full thread list (reconnect)
} as const;

export const sendPayload = z.object({ toAccountId: z.string().min(1), text: z.string().min(1).max(2000) });
export const markReadPayload = z.object({ withAccountId: z.string().min(1) });
export const getHistoryPayload = z.object({
  withAccountId: z.string().min(1),
  limit: z.number().int().positive().max(200).optional(),
});
export const getStatePayload = z.object({}).strict();

export type SendPayload = z.infer<typeof sendPayload>;
export type MarkReadPayload = z.infer<typeof markReadPayload>;
export type GetHistoryPayload = z.infer<typeof getHistoryPayload>;

/** Ack returned to the sender of `chat.send`. */
export const sendAck = z.object({ message: chatMessage.optional(), error: z.string().optional() });
export type SendAck = z.infer<typeof sendAck>;

/** Ack returned for `chat.getHistory`. */
export const historyAck = z.object({ withAccountId: z.string(), messages: z.array(chatMessage) });
export type HistoryAck = z.infer<typeof historyAck>;

// --- Server -> Client events -------------------------------------------------
export const S2C = {
  threads: 'chat.threads', // full thread list (pushed on connect + whenever it changes)
  message: 'chat.message', // a new message, pushed to both the sender's other sockets and the recipient
  read: 'chat.read', // the other party read our messages up to `upTo`
  error: 'chat.error',
} as const;

export const threadsEvent = z.object({ threads: z.array(chatThread) });
export const messageEvent = z.object({ message: chatMessage });
export const readEvent = z.object({ byAccountId: z.string(), upTo: z.number() });

export type ThreadsEvent = z.infer<typeof threadsEvent>;
export type MessageEvent = z.infer<typeof messageEvent>;
export type ReadEvent = z.infer<typeof readEvent>;
