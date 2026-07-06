/**
 * Chat store — direct messages and groups, backed by the `chat` service (mirrors `socialStore`'s
 * shape: connect with the stored account, render whatever the server pushes). A session's `id` is
 * the conversation id (real, server-minted — DMs are found-or-created via `openDm`, groups via
 * `createGroup`). Login lives in `platformStore`/`authClient`; here we take the stored account,
 * refresh its token and connect.
 */
import { create } from 'zustand';
import { io, type Socket } from 'socket.io-client';
import { chat, type ProtocolError } from '@mygame/protocol';
import { config } from '../config.js';
import { loadSession, login } from '../authClient.js';

export type ChatConnStatus = 'idle' | 'connecting' | 'connected' | 'error';

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: string;
  createdAt: number;
  /** Only ever set for dm messages *I* sent — groups don't show per-message read receipts (v1). */
  status?: 'sent' | 'read';
  /** Not implemented server-side yet — always undefined for real messages. */
  reactions?: Record<string, number>;
}

export interface ChatSession {
  id: string;
  type: 'dm' | 'group';
  name: string;
  participants: chat.ChatParticipant[];
  messages: ChatMessage[];
  avatar?: string;
  unreadCount?: number;
  /** Internal: dm only, drives read-receipt recomputation on every thread push. */
  otherReadAt?: number | null;
  /** group only: the creator, who alone may remove *other* members. Null for dm. */
  ownerId?: string | null;
}

interface ChatState {
  status: ChatConnStatus;
  isOpen: boolean;
  activeChatId: string | null;
  sessions: ChatSession[];
  error: string | null;

  /** Connect using the stored account (refreshes the access token first). Idempotent. */
  connect: () => Promise<void>;
  disconnect: () => void;
  toggleChat: () => void;
  openChat: (chatId: string) => void;
  /** Find-or-create a DM with `userId` and open it. */
  openChatWithUser: (userId: string, userName: string) => void;
  /** Create a group with `memberIds` (I'm added automatically) and open it. */
  createGroup: (name: string, memberIds: string[]) => void;
  /** group only; any current member may add others. */
  addMembers: (chatId: string, memberIds: string[]) => void;
  /** group only; self-removal (leave) is always allowed, removing someone else requires being the owner. */
  removeMember: (chatId: string, accountId: string) => void;
  /** Convenience: remove myself from a group. */
  leaveGroup: (chatId: string) => void;
  /** `_senderId` is accepted for call-site compatibility but ignored — the server derives it from the JWT. */
  sendMessage: (chatId: string, text: string, _senderId?: string) => void;
}

let socket: Socket | null = null;
let meId: string | null = null;
let meName: string | null = null;

const formatTime = (ms: number): string => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const EMPTY_HISTORY_PLACEHOLDER: ChatMessage[] = [
  { id: 'sys-empty', senderId: 'system', senderName: 'system', text: 'История сообщений пуста', timestamp: '', createdAt: 0 },
];

/** `otherReadAt` only ever applies to dm — groups never render per-message read receipts (v1). */
const toUiMessage = (m: chat.ChatMessage, type: 'dm' | 'group', otherReadAt: number | null): ChatMessage => ({
  id: m.id,
  senderId: m.senderId,
  senderName: m.senderName,
  text: m.text,
  timestamp: formatTime(m.createdAt),
  createdAt: m.createdAt,
  ...(type === 'dm' && m.senderId === meId
    ? { status: otherReadAt !== null && m.createdAt <= otherReadAt ? ('read' as const) : ('sent' as const) }
    : {}),
});

/** Re-derive every dm message's read status against the latest known `otherReadAt`. Exact (uses the
 *  message's own raw `createdAt`), so this is safe to call on every thread/read push, in any order. */
const applyOtherReadAt = (messages: ChatMessage[], otherReadAt: number | null): ChatMessage[] =>
  messages.map((m) =>
    m.senderId === meId && m.id !== 'sys-empty'
      ? { ...m, status: otherReadAt !== null && m.createdAt <= otherReadAt ? 'read' : 'sent' }
      : m,
  );

/** Merge a pushed thread list into existing sessions, re-deriving dm read status from `otherReadAt`.
 *  The push is the *complete* current list for this account (server "push the full view" model), so
 *  any local session whose id is absent from `threads` is one I've left/been removed from — dropped,
 *  not carried over — while everything still present keeps its locally-loaded messages/avatar. */
const mergeThreads = (sessions: ChatSession[], threads: chat.ChatThread[]): ChatSession[] => {
  const existingById = new Map(sessions.map((s) => [s.id, s]));
  return threads.map((t) => {
    const existing = existingById.get(t.conversationId);
    const hasLoaded = existing?.messages && existing.messages.length > 0 && existing.messages[0]!.id !== 'sys-empty';
    const messages = hasLoaded
      ? t.type === 'dm'
        ? applyOtherReadAt(existing!.messages, t.otherReadAt)
        : existing!.messages
      : t.lastMessage
        ? [toUiMessage(t.lastMessage, t.type, t.otherReadAt)]
        : [];
    return {
      id: t.conversationId,
      type: t.type,
      name: t.name,
      participants: t.participants,
      ...(existing?.avatar !== undefined ? { avatar: existing.avatar } : {}),
      messages,
      unreadCount: t.unreadCount,
      otherReadAt: t.otherReadAt,
      ownerId: t.ownerId,
    };
  });
};

export const useChatStore = create<ChatState>((set, get) => ({
  status: 'idle',
  isOpen: false,
  activeChatId: null,
  sessions: [],
  error: null,

  connect: async () => {
    if (socket?.connected) return;
    set({ status: 'connecting', error: null });
    const prev = loadSession();
    if (!prev) {
      set({ status: 'error', error: 'not logged in' });
      return;
    }
    let token: string;
    try {
      const session = await login(prev.displayName, prev.accountId);
      token = session.accessToken;
      meId = session.accountId;
      meName = session.displayName;
    } catch (err) {
      set({ status: 'error', error: String(err) });
      return;
    }

    socket?.close();
    // path must match the server's custom path (services/chat/src/server.ts) — see the matching
    // comment in socialStore.ts.
    socket = io(config.chatUrl, { path: '/chat.io/', auth: { token }, transports: ['websocket'] });

    socket.on('connect', () => set({ status: 'connected', error: null }));
    socket.on('disconnect', () => set({ status: 'connecting' }));
    socket.on('connect_error', (err: Error) => set({ status: 'error', error: err.message }));

    socket.on(chat.S2C.threads, (p: chat.ThreadsEvent) =>
      set((s) => ({ sessions: mergeThreads(s.sessions, p.threads) })),
    );

    socket.on(chat.S2C.message, (p: chat.MessageEvent) => {
      set((s) => {
        const idx = s.sessions.findIndex((sess) => sess.id === p.message.conversationId);
        if (idx === -1) {
          // Rare race: the message arrived before the thread it belongs to. The threads push that
          // always follows corrects name/type/otherReadAt.
          const fresh: ChatSession = {
            id: p.message.conversationId,
            type: 'dm',
            name: p.message.senderName,
            participants: [
              ...(meId ? [{ accountId: meId, displayName: meName ?? meId }] : []),
              { accountId: p.message.senderId, displayName: p.message.senderName },
            ],
            messages: [toUiMessage(p.message, 'dm', null)],
          };
          return { sessions: [...s.sessions, fresh] };
        }
        const sess = s.sessions[idx]!;
        if (sess.messages.some((m) => m.id === p.message.id)) return s; // already applied (e.g. own echo)
        const uiMsg = toUiMessage(p.message, sess.type, sess.otherReadAt ?? null);
        const withoutPlaceholder = sess.messages.filter((m) => m.id !== 'sys-empty');
        const sessions = [...s.sessions];
        sessions[idx] = { ...sess, messages: [...withoutPlaceholder, uiMsg] };
        return { sessions };
      });
    });

    socket.on(chat.S2C.read, (p: chat.ReadEvent) =>
      set((s) => ({
        sessions: s.sessions.map((sess) =>
          sess.id === p.conversationId
            ? { ...sess, otherReadAt: p.upTo, messages: applyOtherReadAt(sess.messages, p.upTo) }
            : sess,
        ),
      })),
    );

    socket.on(chat.S2C.error, (e: ProtocolError) => set({ error: e.message }));
  },

  disconnect: () => {
    socket?.close();
    socket = null;
    meId = null;
    meName = null;
    set({ status: 'idle', sessions: [] });
  },

  toggleChat: () => set((s) => ({ isOpen: !s.isOpen })),

  openChat: (chatId) => {
    set({ isOpen: true, activeChatId: chatId });
    socket?.emit(chat.C2S.getHistory, { conversationId: chatId, limit: 100 }, (p: chat.HistoryAck) =>
      set((s) => ({
        sessions: s.sessions.map((sess) => {
          if (sess.id !== chatId) return sess;
          const otherReadAt = sess.otherReadAt ?? null;
          const messages =
            p.messages.length > 0 ? p.messages.map((m) => toUiMessage(m, sess.type, otherReadAt)) : EMPTY_HISTORY_PLACEHOLDER;
          return { ...sess, messages };
        }),
      })),
    );
    socket?.emit(chat.C2S.markRead, { conversationId: chatId });
  },

  openChatWithUser: (userId, userName) => {
    const existing = get().sessions.find(
      (s) => s.type === 'dm' && s.participants.some((p) => p.accountId === userId),
    );
    if (existing) {
      get().openChat(existing.id);
      return;
    }
    if (!socket?.connected) return;
    set({ isOpen: true });
    socket.emit(chat.C2S.openDm, { withAccountId: userId }, (ack: chat.OpenDmAck) => {
      if (!ack?.conversationId) {
        set({ error: ack?.error ?? 'failed to open chat' });
        return;
      }
      const conversationId = ack.conversationId;
      set((s) => {
        if (s.sessions.some((sess) => sess.id === conversationId)) return s;
        const placeholder: ChatSession = {
          id: conversationId,
          type: 'dm',
          name: userName,
          participants: [
            ...(meId ? [{ accountId: meId, displayName: meName ?? meId }] : []),
            { accountId: userId, displayName: userName },
          ],
          messages: EMPTY_HISTORY_PLACEHOLDER,
        };
        return { sessions: [...s.sessions, placeholder] };
      });
      get().openChat(conversationId);
    });
  },

  createGroup: (name, memberIds) => {
    if (!socket?.connected || !name.trim() || memberIds.length === 0) return;
    socket.emit(chat.C2S.createGroup, { name: name.trim(), memberIds }, (ack: chat.CreateGroupAck) => {
      if (!ack?.conversationId) {
        set({ error: ack?.error ?? 'failed to create group' });
        return;
      }
      get().openChat(ack.conversationId);
    });
  },

  addMembers: (chatId, memberIds) => {
    if (!socket?.connected || memberIds.length === 0) return;
    socket.emit(chat.C2S.addMembers, { conversationId: chatId, memberIds }, (ack: chat.AddMembersAck) => {
      if (ack?.error) set({ error: ack.error });
    });
  },

  removeMember: (chatId, accountId) => {
    if (!socket?.connected) return;
    socket.emit(chat.C2S.removeMember, { conversationId: chatId, accountId }, (ack: chat.RemoveMemberAck) => {
      if (ack?.error) set({ error: ack.error });
    });
  },

  leaveGroup: (chatId) => {
    if (!meId) return;
    get().removeMember(chatId, meId);
  },

  sendMessage: (chatId, text) => {
    socket?.emit(chat.C2S.send, { conversationId: chatId, text }, (ack: chat.SendAck) => {
      if (ack?.error) set({ error: ack.error });
    });
  },
}));
