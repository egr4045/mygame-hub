/**
 * Chat store — direct messages and groups, backed by the `chat` service (mirrors `socialStore`'s
 * shape: connect with the stored account, render whatever the server pushes). A session's `id` is
 * the conversation id (real, server-minted — DMs are found-or-created via `openDm`, groups via
 * `createGroup`). Login lives in `platformStore`/`authClient`; here we take the stored account,
 * refresh its token and connect.
 */
import { create } from 'zustand';
import { io, type Socket } from 'socket.io-client';
import { Room } from 'livekit-client';
import { chat, type ProtocolError } from '@mygame/protocol';
import { config } from '../config.js';
import { loadSession, freshAccessToken } from '../authClient.js';
import { useToastStore } from './toastStore.js';
import { useNotificationPrefsStore } from './notificationPrefsStore.js';

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

/** Purely the *signaling* state — the actual media lives on the `Room` instance (`getCallRoom()`),
 *  not duplicated into Zustand; `ChatWidget` attaches to the room's own track/participant events. */
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
  /** `_senderId` is accepted for call-site compatibility but ignored — the server derives it from the JWT. */
  sendMessage: (chatId: string, text: string, _senderId?: string) => void;
  sendTyping: (chatId: string) => void;

  /** Start ringing every other participant of `chatId`. */
  ring: (chatId: string, type: chat.CallType) => void;
  /** Join the call currently ringing for `chatId` (mints a LiveKit token, connects, publishes tracks). */
  acceptCall: (chatId: string) => Promise<void>;
  declineCall: (chatId: string) => void;
  hangup: () => void;
  toggleMic: () => Promise<void>;
  toggleCam: () => Promise<void>;
}

let socket: Socket | null = null;
let meId: string | null = null;
let meName: string | null = null;

/** The live LiveKit room for the current call, if connected — not store state (see `ActiveCall`'s
 *  doc comment): `ChatWidget` reads this once `activeCall.status === 'connected'` and attaches its
 *  own listeners for track/participant events, rather than duplicating that model into Zustand. */
let callRoom: Room | null = null;
export const getCallRoom = (): Room | null => callRoom;

/** Mint a LiveKit token for `conversationId` from the chat service's HTTP surface (not a socket
 *  event — the token is a plain string handed straight to `Room.connect`). Null on any failure. */
const fetchCallToken = async (conversationId: string): Promise<chat.CallTokenResponse | null> => {
  const token = await freshAccessToken();
  if (!token) return null;
  try {
    const res = await fetch(`${config.chatUrl}/chat/call/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ conversationId }),
    });
    if (!res.ok) return null;
    return (await res.json()) as chat.CallTokenResponse;
  } catch {
    return null;
  }
};

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
    });

    // Someone is ringing me — surface it: open the widget on that exact conversation so the
    // incoming-call view (rendered inline per-conversation, not a separate global banner) is
    // immediately visible. If I'm already in/ringing a call, this simply overwrites it (juggling
    // concurrent calls is out of scope for v1).
    socket.on(chat.S2C.callRing, (p: chat.CallRingEvent) => {
      set({
        activeCall: { conversationId: p.conversationId, type: p.callType, status: 'ringing-in', fromName: p.fromName },
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
      callRoom?.disconnect();
      callRoom = null;
      set({ activeCall: null });
    });
  },

  disconnect: () => {
    socket?.close();
    socket = null;
    meId = null;
    meName = null;
    callRoom?.disconnect();
    callRoom = null;
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
          return { ...sess, messages };
        }),
      })),
    );
    socket?.emit(chat.C2S.markRead, { conversationId: chatId });
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

  sendMessage: (chatId, text) => {
    socket?.emit(chat.C2S.send, { conversationId: chatId, text }, (ack: chat.SendAck) => {
      if (ack?.error) set({ error: ack.error });
    });
  },

  sendTyping: (chatId) => {
    if (!socket?.connected) return;
    socket.emit(chat.C2S.typing, { conversationId: chatId });
  },

  ring: (chatId, type) => {
    if (!socket?.connected) return;
    set({ activeCall: { conversationId: chatId, type, status: 'ringing-out' } });
    socket.emit(chat.C2S.callRing, { conversationId: chatId, callType: type }, (ack: chat.CallAck) => {
      if (!ack?.ok) set({ activeCall: null, error: ack?.error ?? 'call failed' });
    });
  },

  acceptCall: async (chatId) => {
    const call = get().activeCall;
    const type = call?.conversationId === chatId ? call.type : 'audio';
    set({ activeCall: { conversationId: chatId, type, status: 'connecting' } });
    const token = await fetchCallToken(chatId);
    if (!token) {
      set({ activeCall: null, error: 'failed to join call' });
      return;
    }
    const room = new Room();
    try {
      await room.connect(token.url, token.token);
      await room.localParticipant.setMicrophoneEnabled(true);
      if (type === 'video') await room.localParticipant.setCameraEnabled(true);
    } catch (err) {
      room.disconnect();
      set({ activeCall: null, error: String(err) });
      return;
    }
    callRoom = room;
    socket?.emit(chat.C2S.callAccept, { conversationId: chatId }, (ack: chat.CallAck) => {
      if (!ack?.ok) get().hangup();
    });
    set({ activeCall: { conversationId: chatId, type, status: 'connected' } });
  },

  declineCall: (chatId) => {
    socket?.emit(chat.C2S.callDecline, { conversationId: chatId });
    set({ activeCall: null });
  },

  hangup: () => {
    const call = get().activeCall;
    if (call) socket?.emit(chat.C2S.callHangup, { conversationId: call.conversationId });
    callRoom?.disconnect();
    callRoom = null;
    set({ activeCall: null });
  },

  toggleMic: async () => {
    if (!callRoom) return;
    const enabled = callRoom.localParticipant.isMicrophoneEnabled;
    await callRoom.localParticipant.setMicrophoneEnabled(!enabled);
  },

  toggleCam: async () => {
    if (!callRoom) return;
    const enabled = callRoom.localParticipant.isCameraEnabled;
    await callRoom.localParticipant.setCameraEnabled(!enabled);
  },
}));
