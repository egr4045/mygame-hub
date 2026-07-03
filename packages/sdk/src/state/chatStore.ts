/**
 * Chat store — direct messages, backed by the `chat` service (mirrors `socialStore`'s shape: connect
 * with the stored account, render whatever the server pushes). DMs only for now (see docs/PLAN.md —
 * group chat is a later step); a thread has no id of its own, so a session's `id` is simply the other
 * account's id. Login lives in `platformStore`/`authClient`; here we take the stored account, refresh
 * its token and connect.
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
  text: string;
  timestamp: string;
  status?: 'sent' | 'read';
  /** Not implemented server-side yet — always undefined for real messages. */
  reactions?: Record<string, number>;
}

export interface ChatSession {
  id: string;
  /** Always 'dm' for now — group chat is a later step (docs/PLAN.md). */
  type: 'dm' | 'group';
  name: string;
  participants: string[];
  messages: ChatMessage[];
  avatar?: string;
  unreadCount?: number;
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
  openChatWithUser: (userId: string, userName: string) => void;
  /** `_senderId` is accepted for call-site compatibility but ignored — the server derives it from the JWT. */
  sendMessage: (chatId: string, text: string, _senderId?: string) => void;
}

let socket: Socket | null = null;
let meId: string | null = null;

const formatTime = (ms: number): string => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const toUiMessage = (m: chat.ChatMessage): ChatMessage => ({
  id: m.id,
  senderId: m.senderId,
  text: m.text,
  timestamp: formatTime(m.createdAt),
  ...(m.senderId === meId ? { status: (m.readAt ? ('read' as const) : ('sent' as const)) } : {}),
});

/** Merge a pushed thread list into existing sessions, keeping any already-loaded message history. */
const mergeThreads = (sessions: ChatSession[], threads: chat.ChatThread[]): ChatSession[] => {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  for (const t of threads) {
    const existing = byId.get(t.accountId);
    byId.set(t.accountId, {
      id: t.accountId,
      type: 'dm',
      name: t.displayName,
      participants: meId ? [meId, t.accountId] : [t.accountId],
      ...(existing?.avatar !== undefined ? { avatar: existing.avatar } : {}),
      messages: existing?.messages ?? (t.lastMessage ? [toUiMessage(t.lastMessage)] : []),
      unreadCount: t.unreadCount,
    });
  }
  return [...byId.values()];
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
    } catch (err) {
      set({ status: 'error', error: String(err) });
      return;
    }

    socket?.close();
    socket = io(config.chatUrl, { auth: { token }, transports: ['websocket'] });

    socket.on('connect', () => set({ status: 'connected', error: null }));
    socket.on('disconnect', () => set({ status: 'connecting' }));
    socket.on('connect_error', (err: Error) => set({ status: 'error', error: err.message }));

    socket.on(chat.S2C.threads, (p: chat.ThreadsEvent) =>
      set((s) => ({ sessions: mergeThreads(s.sessions, p.threads) })),
    );

    socket.on(chat.S2C.message, (p: chat.MessageEvent) => {
      const otherId = p.message.senderId === meId ? p.message.recipientId : p.message.senderId;
      const uiMsg = toUiMessage(p.message);
      set((s) => {
        const idx = s.sessions.findIndex((sess) => sess.id === otherId);
        if (idx === -1) {
          const fresh: ChatSession = {
            id: otherId,
            type: 'dm',
            name: otherId.slice(0, 8),
            participants: meId ? [meId, otherId] : [otherId],
            messages: [uiMsg],
          };
          return { sessions: [...s.sessions, fresh] };
        }
        const sess = s.sessions[idx]!;
        if (sess.messages.some((m) => m.id === uiMsg.id)) return s; // already applied (e.g. own echo)
        const sessions = [...s.sessions];
        sessions[idx] = { ...sess, messages: [...sess.messages, uiMsg] };
        return { sessions };
      });
    });

    socket.on(chat.S2C.read, (p: chat.ReadEvent) =>
      set((s) => ({
        sessions: s.sessions.map((sess) =>
          sess.id === p.byAccountId
            ? { ...sess, messages: sess.messages.map((m) => (m.senderId === meId ? { ...m, status: 'read' } : m)) }
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
    set({ status: 'idle', sessions: [] });
  },

  toggleChat: () => set((s) => ({ isOpen: !s.isOpen })),

  openChat: (chatId) => {
    set({ isOpen: true, activeChatId: chatId });
    socket?.emit(chat.C2S.getHistory, { withAccountId: chatId, limit: 100 }, (p: chat.HistoryAck) =>
      set((s) => ({
        sessions: s.sessions.map((sess) => (sess.id === chatId ? { ...sess, messages: p.messages.map(toUiMessage) } : sess)),
      })),
    );
    socket?.emit(chat.C2S.markRead, { withAccountId: chatId });
  },

  openChatWithUser: (userId, userName) => {
    if (get().sessions.some((s) => s.id === userId)) {
      get().openChat(userId);
      return;
    }
    const placeholder: ChatSession = {
      id: userId,
      type: 'dm',
      name: userName,
      participants: meId ? [meId, userId] : [userId],
      messages: [{ id: 'sys1', senderId: 'system', text: 'История сообщений пуста', timestamp: '' }],
    };
    set((s) => ({ sessions: [...s.sessions, placeholder], isOpen: true, activeChatId: userId }));
  },

  sendMessage: (chatId, text) => {
    socket?.emit(chat.C2S.send, { toAccountId: chatId, text }, (ack: chat.SendAck) => {
      if (ack?.error) set({ error: ack.error });
    });
  },
}));
