/**
 * Social store — the platform-wide friends + presence layer (game-agnostic, Steam-style). Owns the
 * Socket.io connection to the social service and mirrors the server-pushed friends list. Login lives
 * in `platformStore`; here we take the stored account, refresh its token and connect. Your account
 * id doubles as your friend code: others add you by it. The server is authoritative — actions emit
 * and we render whatever `social.friends` comes back.
 */
import { create } from 'zustand';
import { io, type Socket } from 'socket.io-client';
import { social, type Invite, type ProtocolError } from '@mygame/protocol';
import { config } from '../config.js';
import { loadSession, freshAccessToken } from '../authClient.js';

export type SocialStatus = 'idle' | 'connecting' | 'connected' | 'error';

let socket: Socket | null = null;
const emit = (type: string, payload?: unknown): void => {
  socket?.emit(type, payload ?? {});
};

interface SocialUIState {
  status: SocialStatus;
  me: social.MeEvent | null;
  friends: social.Friend[];
  /** Invites pushed to me by friends ("X invited you to CIVA"). */
  invites: Invite[];
  error: string | null;
  /** The activity I last reported via `setActivity`, tracked client-side (the server never echoes it
   *  back) so "invite a friend to my game" has something to send without the caller re-threading it. */
  myActivity: social.Activity | null;

  /** Connect using the stored account (refreshes the access token first). Idempotent. */
  connect: () => Promise<void>;
  disconnect: () => void;
  /** Send a friend request by short friend code (or raw accountId). Resolves with the server's ack
   *  so the caller can show «Код не найден» etc. */
  addByCode: (code: string) => Promise<social.RequestAck>;
  /** Live search for people to add, by display name or friend code (exact code ranked first). Each
   *  result carries my relation to that account so the UI shows add / pending / friend. Empty on
   *  failure or if not connected. */
  search: (query: string) => Promise<social.SearchResult[]>;
  accept: (accountId: string) => void;
  decline: (accountId: string) => void;
  removeFriend: (accountId: string) => void;
  setActivity: (activity: social.Activity) => void;
  /** Mint a join code for a room; resolves to the code (or null on failure). */
  createInvite: (target: social.InviteTarget) => Promise<string | null>;
  /** Push an invite into a friend's presence channel. */
  inviteFriend: (accountId: string, target: social.InviteTarget) => void;
  dismissInvite: (code: string) => void;
  /** Hides presence/activity from `accountId` both ways and rejects new requests from them — doesn't
   *  touch the friendship, so `unblock` alone restores visibility. */
  block: (accountId: string) => Promise<boolean>;
  unblock: (accountId: string) => Promise<boolean>;
  /** Accounts I've blocked (for an unblock list). Empty on failure/timeout. */
  getBlocked: () => Promise<social.BlockedAccount[]>;
}

export const useSocialStore = create<SocialUIState>((set) => ({
  status: 'idle',
  me: null,
  friends: [],
  invites: [],
  error: null,
  myActivity: null,

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

    socket?.close();
    // path must match the server's custom path (services/social/src/server.ts) — needed so social's
    // socket doesn't collide with chat's or the game lobby's default `/socket.io/` on a shared origin.
    socket = io(config.socialUrl, { path: '/social.io/', auth: { token }, transports: ['websocket'] });

    socket.on('connect', () => set({ status: 'connected', error: null }));
    socket.on('disconnect', () => set({ status: 'connecting' }));
    socket.on('connect_error', (err: Error) => set({ status: 'error', error: err.message }));

    socket.on(social.S2C.me, (p: social.MeEvent) => set({ me: p }));
    socket.on(social.S2C.friends, (p: social.FriendsEvent) => set({ friends: p.friends }));
    socket.on(social.S2C.invite, (p: social.InviteEvent) =>
      set((s) => ({ invites: [p.invite, ...s.invites.filter((i) => i.code !== p.invite.code)] })),
    );
    socket.on(social.S2C.error, (e: ProtocolError) => {
      set({ error: e.message });
      window.setTimeout(() => set((s) => (s.error === e.message ? { error: null } : {})), 3500);
    });
  },

  disconnect: () => {
    socket?.close();
    socket = null;
    set({ status: 'idle', friends: [], invites: [], myActivity: null });
  },

  addByCode: (code) =>
    new Promise<social.RequestAck>((resolve) => {
      if (!socket?.connected) {
        resolve({ error: 'Нет соединения' });
        return;
      }
      // Send as-typed — the server normalises (UPPER for the friend code, exact for a raw accountId).
      socket.emit(social.C2S.request, { code: code.trim() }, (ack: social.RequestAck) => resolve(ack ?? { ok: true }));
    }),
  search: (query) =>
    new Promise<social.SearchResult[]>((resolve) => {
      if (!socket?.connected) {
        resolve([]);
        return;
      }
      socket.emit(social.C2S.search, { query }, (ack: social.SearchAck) => resolve(ack?.results ?? []));
      window.setTimeout(() => resolve([]), 5000); // don't hang the UI if the ack is lost
    }),
  accept: (accountId) => emit(social.C2S.accept, { accountId }),
  decline: (accountId) => emit(social.C2S.decline, { accountId }),
  removeFriend: (accountId) => emit(social.C2S.remove, { accountId }),
  setActivity: (activity) => {
    emit(social.C2S.setActivity, { activity });
    set({ myActivity: activity });
  },

  createInvite: (target) =>
    new Promise<string | null>((resolve) => {
      if (!socket?.connected) {
        resolve(null);
        return;
      }
      socket.emit(social.C2S.createInvite, target, (ack: social.CreateInviteAck) => resolve(ack?.code ?? null));
      window.setTimeout(() => resolve(null), 5000); // don't hang the UI if the ack is lost
    }),
  inviteFriend: (accountId, target) => emit(social.C2S.inviteFriend, { accountId, ...target }),
  dismissInvite: (code) => set((s) => ({ invites: s.invites.filter((i) => i.code !== code) })),

  block: (accountId) =>
    new Promise<boolean>((resolve) => {
      if (!socket?.connected) {
        resolve(false);
        return;
      }
      socket.emit(social.C2S.block, { accountId }, (ack: social.BlockAck) => resolve(ack?.ok ?? false));
      window.setTimeout(() => resolve(false), 5000);
    }),
  unblock: (accountId) =>
    new Promise<boolean>((resolve) => {
      if (!socket?.connected) {
        resolve(false);
        return;
      }
      socket.emit(social.C2S.unblock, { accountId }, (ack: social.BlockAck) => resolve(ack?.ok ?? false));
      window.setTimeout(() => resolve(false), 5000);
    }),
  getBlocked: () =>
    new Promise<social.BlockedAccount[]>((resolve) => {
      if (!socket?.connected) {
        resolve([]);
        return;
      }
      socket.emit(social.C2S.getBlocked, {}, (ack: social.GetBlockedAck) => resolve(ack?.blocked ?? []));
      window.setTimeout(() => resolve([]), 5000);
    }),
}));
