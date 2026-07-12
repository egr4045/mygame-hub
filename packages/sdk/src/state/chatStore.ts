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
import { loadSession, freshAccessToken } from '../authClient.js';
import { useToastStore } from './toastStore.js';
import { useNotificationPrefsStore } from './notificationPrefsStore.js';
import { useCallStore } from './callStore.js';

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
  replyToId?: string | null;
  attachments?: chat.ChatAttachment[];
  /** Set when the sender edited the message — renders the «(изменено)» label. */
  editedAt?: number | null;
  /** Tombstone: text/attachments are blanked server-side; renders as «Сообщение удалено». */
  deletedAt?: number | null;
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
  /** group only: admins appointed by the owner (may delete others' messages, like the owner). */
  admins?: string[];
  /** Whether older history remains before the earliest loaded message (drives infinite scroll-up). */
  hasMore?: boolean;
  loadingOlder?: boolean;
}

/** Purely the *signaling* state — the actual media lives in `callStore` (the portable-call layer),
 *  which owns the LiveKit room and projects participant state for any UI. */
export interface ActiveCall {
  conversationId: string;
  type: chat.CallType;
  /** 'ringing-out' = I started it and I'm waiting; 'ringing-in' = someone is ringing me;
   *  'connecting' = accepted, joining the LiveKit room; 'connected' = media flowing. */
  status: 'ringing-out' | 'ringing-in' | 'connecting' | 'connected';
  /** Who's calling (ringing-in) — for the incoming-call banner. Not meaningful otherwise. */
  fromName?: string;
}

interface ChatState {
  status: ChatConnStatus;
  isOpen: boolean;
  activeChatId: string | null;
  sessions: ChatSession[];
  error: string | null;
  activeCall: ActiveCall | null;
  /** conversationId -> accountId -> timestamp of last typing event */
  typing: Record<string, Record<string, number>>;

  /** Connect using the stored account (refreshes the access token first). Idempotent. */
  connect: () => Promise<void>;
  disconnect: () => void;
  toggleChat: () => void;
  openChat: (chatId: string) => void;
  /** Find-or-create a DM with `userId` and open it. `onReady` (if given) fires once with the
   *  conversation id, whether the DM already existed or was just created — used by `ringUser`. */
  openChatWithUser: (userId: string, userName: string, onReady?: (conversationId: string) => void) => void;
  /** Open (or create) a DM with `accountId` and immediately ring them. */
  ringUser: (accountId: string, displayName: string, type: chat.CallType) => void;
  /** Create a group with `memberIds` (I'm added automatically) and open it. */
  createGroup: (name: string, memberIds: string[]) => void;
  /** group only; any current member may add others. */
  addMembers: (chatId: string, memberIds: string[]) => void;
  /** group only; self-removal (leave) is always allowed, removing someone else requires being the owner. */
  removeMember: (chatId: string, accountId: string) => void;
  /** Convenience: remove myself from a group. */
  leaveGroup: (chatId: string) => void;
  sendMessage: (chatId: string, text: string, opts?: { replyToId?: string; attachments?: chat.ChatAttachment[] }) => void;
  /** Edit my own message (server enforces sender-only / not-deleted). */
  editMessage: (chatId: string, messageId: string, text: string) => void;
  /** Delete a message — mine always; others' only when I'm the group owner/admin (server enforces). */
  deleteMessage: (chatId: string, messageId: string) => void;
  /** Load the previous page of history (infinite scroll-up). No-op while loading / nothing older. */
  loadOlder: (chatId: string) => void;
  /** Throttled to one socket event per ~2s per conversation — safe to call on every keystroke. */
  sendTyping: (chatId: string) => void;
  clearError: () => void;

  /** Start ringing every other participant of `chatId`. Auto-cancels after `RING_TIMEOUT_MS`. */
  ring: (chatId: string, type: chat.CallType) => void;
  /** Join the call currently ringing for `chatId` — media via `callStore.joinConversation`, then
   *  `callAccept` signaling. Mic/cam/screen-share toggles live on `useCallStore` (setMic/setCam/...). */
  acceptCall: (chatId: string) => Promise<void>;
  declineCall: (chatId: string) => void;
  hangup: () => void;
}

let socket: Socket | null = null;
let meId: string | null = null;
let meName: string | null = null;

/** Unanswered outgoing rings auto-cancel after this long (kept below the server's own 60s ring
 *  timeout so the caller's UI resolves first — the server sweep is the authority for stragglers). */
const RING_TIMEOUT_MS = 45_000;
let ringTimer: ReturnType<typeof setTimeout> | null = null;
const clearRingTimer = (): void => {
  if (ringTimer) {
    clearTimeout(ringTimer);
    ringTimer = null;
  }
};

/** «Печатает…» must also *disappear*: the server only relays typing pings, so without a local
 *  expiry the last ping would stick forever (nothing re-renders once the peer goes quiet). */
const TYPING_EXPIRE_MS = 4_000;
const typingTimers = new Map<string, ReturnType<typeof setTimeout>>(); // `${conversationId}:${accountId}`

/** Outbound typing throttle — the input calls sendTyping per keystroke by design. */
const TYPING_SEND_INTERVAL_MS = 2_000;
const lastTypingSent = new Map<string, number>(); // conversationId -> last emit ms

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
  replyToId: m.replyToId ?? null,
  ...(m.attachments?.length ? { attachments: m.attachments } : {}),
  editedAt: m.editedAt ?? null,
  deletedAt: m.deletedAt ?? null,
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
      ...(t.admins !== undefined ? { admins: t.admins } : {}),
      ...(existing?.hasMore !== undefined ? { hasMore: existing.hasMore } : {}),
    };
  });
};

export const useChatStore = create<ChatState>((set, get) => ({
  status: 'idle',
  isOpen: false,
  activeChatId: null,
  sessions: [],
  error: null,
  activeCall: null,
  typing: {},

  connect: async () => {
    if (socket?.connected) return;
    set({ status: 'connecting', error: null });
    const prev = loadSession();
    if (!prev) {
      set({ status: 'error', error: 'not logged in' });
      return;
    }
    let token: string | null;
    try {
      token = await freshAccessToken();
    } catch (err) {
      set({ status: 'error', error: String(err) });
      return;
    }
    if (!token) {
      set({ status: 'error', error: 'session expired' });
      return;
    }
    meId = prev.accountId;
    meName = prev.displayName;

    socket?.close();
    // path must match the server's custom path (services/chat/src/server.ts) — see the matching
    // comment in socialStore.ts.
    socket = io(config.chatUrl, { path: '/chat.io/', auth: { token }, transports: ['websocket'] });

    socket.on('connect', () => {
      set({ status: 'connected', error: null });
      // Backfill after a reconnect: the open conversation may have missed messages while offline
      // (threads pushes only refresh previews/counters, not loaded history).
      const { activeChatId, isOpen } = get();
      if (activeChatId && isOpen) get().openChat(activeChatId);
    });
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
      // I'm looking right at this conversation — mark it read immediately, or the next threads
      // push raises the unread badge on the very chat that's open in front of the user.
      const { isOpen, activeChatId } = get();
      if (
        isOpen &&
        activeChatId === p.message.conversationId &&
        p.message.senderId !== meId &&
        (typeof document === 'undefined' || document.hasFocus())
      ) {
        socket?.emit(chat.C2S.markRead, { conversationId: p.message.conversationId });
      }
    });

    socket.on(chat.S2C.messageEdited, (p: chat.MessageEditedEvent) => {
      set((s) => ({
        sessions: s.sessions.map((sess) =>
          sess.id !== p.message.conversationId
            ? sess
            : {
                ...sess,
                messages: sess.messages.map((m) =>
                  m.id === p.message.id ? { ...m, text: p.message.text, editedAt: p.message.editedAt ?? null } : m,
                ),
              },
        ),
      }));
    });

    socket.on(chat.S2C.messageDeleted, (p: chat.MessageDeletedEvent) => {
      set((s) => ({
        sessions: s.sessions.map((sess) => {
          if (sess.id !== p.conversationId) return sess;
          return {
            ...sess,
            messages: sess.messages.map((m) => {
              if (m.id !== p.messageId) return m;
              const { attachments: _dropped, ...rest } = m;
              return { ...rest, text: '', deletedAt: p.deletedAt };
            }),
          };
        }),
      }));
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

    socket.on(chat.S2C.typing, (p: chat.TypingEvent) => {
      set((s) => {
        const conv = s.typing[p.conversationId] || {};
        return {
          typing: {
            ...s.typing,
            [p.conversationId]: {
              ...conv,
              [p.accountId]: Date.now()
            }
          }
        };
      });
      // Arm/reset the expiry so the indicator actually goes away when the peer stops typing.
      const key = `${p.conversationId}:${p.accountId}`;
      const prev = typingTimers.get(key);
      if (prev) clearTimeout(prev);
      typingTimers.set(
        key,
        setTimeout(() => {
          typingTimers.delete(key);
          set((s) => {
            const conv = s.typing[p.conversationId];
            if (!conv || conv[p.accountId] === undefined) return s;
            const { [p.accountId]: _expired, ...rest } = conv;
            return { typing: { ...s.typing, [p.conversationId]: rest } };
          });
        }, TYPING_EXPIRE_MS),
      );
    });

    // Someone is ringing me — surface it via the global <CallView />. Also focus the widget on that
    // conversation so its chat is one tap away. `'screen'` is a deprecated call type — screen share
    // is now an in-call toggle — so an inbound `'screen'` ring is treated as a video call.
    socket.on(chat.S2C.callRing, (p: chat.CallRingEvent) => {
      const current = get().activeCall;
      // Busy line: already connecting/connected to a *different* call — don't tear it down.
      // Auto-decline the newcomer and surface a missed-call toast instead.
      if (
        current &&
        current.conversationId !== p.conversationId &&
        (current.status === 'connecting' || current.status === 'connected')
      ) {
        socket?.emit(chat.C2S.callDecline, { conversationId: p.conversationId });
        useToastStore.getState().addToast({
          type: 'system',
          title: 'Пропущенный звонок',
          content: `${p.fromName ?? 'Пользователь'} звонил(а), пока вы были в другом звонке`,
          icon: '📞',
        });
        return;
      }
      // Re-ring of the call I'm already in/answering — just refresh who's calling.
      if (current && current.conversationId === p.conversationId && current.status !== 'ringing-in') {
        set({ activeCall: { ...current, fromName: p.fromName } });
        return;
      }
      set({
        activeCall: {
          conversationId: p.conversationId,
          type: p.callType === 'screen' ? 'video' : p.callType,
          status: 'ringing-in',
          fromName: p.fromName,
        },
        isOpen: true,
        activeChatId: p.conversationId,
      });
      if (useNotificationPrefsStore.getState().callToasts) {
        useToastStore.getState().addToast({
          type: 'system',
          title: 'Входящий звонок',
          content: `Звонит ${p.fromName ?? 'пользователь'}...`,
          icon: '📞',
        });
      }
    });

    // Someone joined the call. If that's *me* (the callee's own acceptCall already handles its own
    // transition), ignore; if it's someone else and I'm still just ringing-out, they've picked up —
    // join the LiveKit room myself now.
    socket.on(chat.S2C.callAccepted, (p: chat.CallParticipantEvent) => {
      const call = get().activeCall;
      if (!call || call.conversationId !== p.conversationId || p.accountId === meId) return;
      if (call.status === 'ringing-out') void get().acceptCall(p.conversationId);
    });

    // A 1:1 call has no one left to wait for once the other side declines — hang up for real
    // (emits callHangup so the ephemeral server-side state clears too). A still-ringing group call
    // (someone else already connected) is untouched.
    socket.on(chat.S2C.callDeclined, (p: chat.CallParticipantEvent) => {
      const call = get().activeCall;
      if (call?.conversationId === p.conversationId && call.status === 'ringing-out') get().hangup();
    });

    socket.on(chat.S2C.callEnded, (p: chat.CallEndedEvent) => {
      if (get().activeCall?.conversationId !== p.conversationId) return;
      clearRingTimer();
      useCallStore.getState().leave();
      set({ activeCall: null });
    });
  },

  disconnect: () => {
    socket?.close();
    socket = null;
    meId = null;
    meName = null;
    clearRingTimer();
    useCallStore.getState().leave();
    set({ status: 'idle', sessions: [], activeCall: null });
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
          return { ...sess, messages, hasMore: p.hasMore ?? false, loadingOlder: false };
        }),
      })),
    );
    socket?.emit(chat.C2S.markRead, { conversationId: chatId });
  },

  loadOlder: (chatId) => {
    const sess = get().sessions.find((s) => s.id === chatId);
    if (!sess || sess.loadingOlder || sess.hasMore === false) return;
    const oldest = sess.messages.find((m) => m.id !== 'sys-empty');
    if (!oldest || !socket?.connected) return;
    set((s) => ({ sessions: s.sessions.map((x) => (x.id === chatId ? { ...x, loadingOlder: true } : x)) }));
    socket.emit(
      chat.C2S.getHistory,
      { conversationId: chatId, limit: 100, before: oldest.createdAt },
      (p: chat.HistoryAck) =>
        set((s) => ({
          sessions: s.sessions.map((x) => {
            if (x.id !== chatId) return x;
            const seen = new Set(x.messages.map((m) => m.id));
            const older = p.messages
              .map((m) => toUiMessage(m, x.type, x.otherReadAt ?? null))
              .filter((m) => !seen.has(m.id));
            return { ...x, messages: [...older, ...x.messages], hasMore: p.hasMore ?? false, loadingOlder: false };
          }),
        })),
    );
  },

  openChatWithUser: (userId, userName, onReady) => {
    const existing = get().sessions.find(
      (s) => s.type === 'dm' && s.participants.some((p) => p.accountId === userId),
    );
    if (existing) {
      get().openChat(existing.id);
      onReady?.(existing.id);
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
      onReady?.(conversationId);
    });
  },

  ringUser: (accountId, displayName, type) => {
    get().openChatWithUser(accountId, displayName, (conversationId) => get().ring(conversationId, type));
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

  sendMessage: (chatId, text, opts) => {
    const payload: chat.SendPayload = {
      conversationId: chatId,
      text,
      ...(opts?.replyToId ? { replyToId: opts.replyToId } : {}),
      ...(opts?.attachments?.length ? { attachments: opts.attachments } : {}),
    };
    socket?.emit(chat.C2S.send, payload, (ack: chat.SendAck) => {
      if (ack?.error) set({ error: ack.error });
    });
  },

  editMessage: (chatId, messageId, text) => {
    socket?.emit(chat.C2S.edit, { conversationId: chatId, messageId, text }, (ack: chat.EditAck) => {
      if (ack?.error) set({ error: ack.error });
    });
  },

  deleteMessage: (chatId, messageId) => {
    socket?.emit(chat.C2S.del, { conversationId: chatId, messageId }, (ack: chat.DeleteAck) => {
      if (ack?.error) set({ error: ack.error });
    });
  },

  sendTyping: (chatId) => {
    if (!socket?.connected) return;
    const last = lastTypingSent.get(chatId) ?? 0;
    if (Date.now() - last < TYPING_SEND_INTERVAL_MS) return;
    lastTypingSent.set(chatId, Date.now());
    socket.emit(chat.C2S.typing, { conversationId: chatId });
  },

  clearError: () => set({ error: null }),

  ring: (chatId, type) => {
    if (!socket?.connected) return;
    set({ activeCall: { conversationId: chatId, type, status: 'ringing-out' } });
    socket.emit(chat.C2S.callRing, { conversationId: chatId, callType: type }, (ack: chat.CallAck) => {
      if (!ack?.ok) {
        clearRingTimer();
        set({ activeCall: null, error: ack?.error ?? 'call failed' });
      }
    });
    clearRingTimer();
    ringTimer = setTimeout(() => {
      ringTimer = null;
      const call = get().activeCall;
      if (call?.conversationId !== chatId || call.status !== 'ringing-out') return;
      get().hangup();
      useToastStore.getState().addToast({
        type: 'system',
        title: 'Нет ответа',
        content: 'Никто не ответил на звонок',
        icon: '📞',
      });
    }, RING_TIMEOUT_MS);
  },

  acceptCall: async (chatId) => {
    const call = get().activeCall;
    const type = call?.conversationId === chatId ? call.type : 'audio';
    clearRingTimer();
    set({
      activeCall: {
        conversationId: chatId,
        type,
        status: 'connecting',
        ...(call?.fromName ? { fromName: call.fromName } : {}),
      },
    });
    const label = get().sessions.find((s) => s.id === chatId)?.name;
    const ok = await useCallStore.getState().joinConversation(chatId, {
      mic: true,
      cam: type === 'video',
      type,
      ...(label ? { label } : {}),
    });
    // Race guard: the user may have hung up (or a decline may have landed) while we were connecting —
    // in that case the freshly-joined media must not resurrect the call.
    const now = get().activeCall;
    if (!now || now.conversationId !== chatId || now.status !== 'connecting') {
      useCallStore.getState().leave();
      return;
    }
    if (!ok) {
      set({ activeCall: null, error: useCallStore.getState().error ?? 'failed to join call' });
      return;
    }
    socket?.emit(chat.C2S.callAccept, { conversationId: chatId }, (ack: chat.CallAck) => {
      if (!ack?.ok) get().hangup();
    });
    set({ activeCall: { conversationId: chatId, type, status: 'connected' } });
  },

  declineCall: (chatId) => {
    socket?.emit(chat.C2S.callDecline, { conversationId: chatId });
    clearRingTimer();
    set({ activeCall: null });
  },

  hangup: () => {
    const call = get().activeCall;
    if (call) socket?.emit(chat.C2S.callHangup, { conversationId: call.conversationId });
    clearRingTimer();
    useCallStore.getState().leave();
    set({ activeCall: null });
  },
}));

// Bridge for unexpected media teardown (server drop, reconnect give-up): callStore's own
// Disconnected handler resets it to idle with an error — if signaling still shows a live conv call,
// close that out too so the server clears its ephemeral call state. Intentional exits (hangup,
// callEnded, the acceptCall race guard) go through `leave()`, which resets with `error: null`, so
// they never re-enter here.
useCallStore.subscribe((cs, prev) => {
  if (prev.status === 'idle' || cs.status !== 'idle' || !cs.error) return;
  const call = useChatStore.getState().activeCall;
  if (call && call.status === 'connected') {
    socket?.emit(chat.C2S.callHangup, { conversationId: call.conversationId });
    useChatStore.setState({ activeCall: null, error: cs.error });
  }
});
