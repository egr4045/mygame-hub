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
import { loadSession, login } from '../authClient.js';

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

  /** Connect using the stored account (refreshes the access token first). Idempotent. */
  connect: () => Promise<void>;
  disconnect: () => void;
  addByCode: (code: string) => void;
  accept: (accountId: string) => void;
  decline: (accountId: string) => void;
  removeFriend: (accountId: string) => void;
  setActivity: (activity: social.Activity) => void;
  /** Mint a join code for a room; resolves to the code (or null on failure). */
  createInvite: (target: social.InviteTarget) => Promise<string | null>;
  /** Push an invite into a friend's presence channel. */
  inviteFriend: (accountId: string, target: social.InviteTarget) => void;
  dismissInvite: (code: string) => void;
  /** Currently-joinable rooms for `game`, derived from live presence. Empty on failure/timeout. */
  getLobbies: (game: string) => Promise<social.Lobby[]>;
}

export const useSocialStore = create<SocialUIState>((set) => ({
  status: 'idle',
  me: null,
  friends: [],
  invites: [],
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
    } catch (err) {
      set({ status: 'error', error: String(err) });
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
    set({ status: 'idle', friends: [], invites: [] });
  },

  addByCode: (code) => emit(social.C2S.request, { code: code.trim() }),
  accept: (accountId) => emit(social.C2S.accept, { accountId }),
  decline: (accountId) => emit(social.C2S.decline, { accountId }),
  removeFriend: (accountId) => emit(social.C2S.remove, { accountId }),
  setActivity: (activity) => emit(social.C2S.setActivity, { activity }),

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

  getLobbies: (game) =>
    new Promise<social.Lobby[]>((resolve) => {
      if (!socket?.connected) {
        resolve([]);
        return;
      }
      socket.emit(social.C2S.getLobbies, { game }, (ack: social.GetLobbiesAck) => resolve(ack?.lobbies ?? []));
      window.setTimeout(() => resolve([]), 5000); // don't hang the UI if the ack is lost
    }),
}));
