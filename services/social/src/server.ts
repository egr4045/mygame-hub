/**
 * Social transport: a Socket.io server that authenticates each socket with the platform JWT, binds
 * it to the player's **account**, and layers live presence + activity over the persistent
 * friendship graph (./store). Whenever something changes (a request, an accept, a presence flip, an
 * activity update), it pushes the affected accounts a fresh full friends list. The account id
 * doubles as the friend code: you add someone by their code.
 */
import { createServer, type Server as HttpServer } from 'node:http';
import { Server as IOServer, type Socket } from 'socket.io';
import { ContractError, social, type Invite } from '@mygame/protocol';
import type { AuthCore } from '@mygame/auth-core';
import type { Logger } from '@mygame/shared-types';
import type { ZodType } from 'zod';
import type { SocialStore } from './store.js';
import type { InviteRecord, InviteStore } from './invites.js';

interface SocketData {
  accountId: string;
  displayName: string;
}

export interface SocialDeps {
  readonly auth: AuthCore;
  readonly store: SocialStore;
  readonly invites: InviteStore;
  readonly logger: Logger;
  readonly corsOrigin: string;
}

/** Strip the internal `expiresAt` to the wire shape the client consumes. */
const toWireInvite = (r: InviteRecord): Invite => ({
  code: r.code,
  game: r.game,
  gameName: r.gameName,
  room: r.room,
  role: r.role,
  inviter: r.inviter,
  inviterName: r.inviterName,
});

export interface SocialServer {
  httpServer: HttpServer;
  io: IOServer;
}

const parse = <T>(schema: ZodType<T>, raw: unknown): T => {
  const r = schema.safeParse(raw ?? {});
  if (!r.success) throw new ContractError('validation', 'invalid payload');
  return r.data;
};

const shortCode = (id: string): string => id.slice(0, 8);

export const createSocialServer = (deps: SocialDeps): SocialServer => {
  const httpServer = createServer((req, res) => {
    const cors = { 'content-type': 'application/json', 'access-control-allow-origin': '*' };
    if (req.url === '/health' || req.url === '/ready') {
      res.writeHead(200, cors);
      res.end(JSON.stringify({ status: 'ok', service: 'social' }));
      return;
    }
    // Resolve a join code (public — the code itself is the capability). Used by the launcher when
    // someone opens `?invite=CODE` or types a code, before any socket exists.
    const m = req.url?.match(/^\/invite\/([^/?]+)/);
    if (m) {
      const record = deps.invites.resolve(decodeURIComponent(m[1]!));
      if (!record) {
        res.writeHead(404, cors);
        res.end(JSON.stringify({ error: 'invite not found or expired' }));
        return;
      }
      res.writeHead(200, cors);
      res.end(JSON.stringify({ invite: toWireInvite(record) }));
      return;
    }
    res.writeHead(404, cors);
    res.end(JSON.stringify({ error: 'not_found' }));
  });

  const io = new IOServer(httpServer, { cors: { origin: deps.corsOrigin, methods: ['GET', 'POST'] } });

  // Live state (presence + activity). The friendship graph is durable in the store; these are not.
  const socketsOf = new Map<string, Set<string>>(); // accountId -> connected socket ids
  const activityOf = new Map<string, social.Activity>(); // accountId -> what they're playing

  const isOnline = (accountId: string): boolean => (socketsOf.get(accountId)?.size ?? 0) > 0;

  // --- Auth: bind each socket to an account via its platform access token ---
  io.use((socket, next) => {
    const token = (socket.handshake.auth as { token?: string }).token;
    if (!token) {
      next(new Error('unauthorized'));
      return;
    }
    void deps.auth
      .verify(token)
      .then((claims) => {
        if (claims.typ !== 'access') {
          next(new Error('unauthorized'));
          return;
        }
        (socket.data as SocketData).accountId = claims.sub;
        (socket.data as SocketData).displayName = claims.name;
        next();
      })
      .catch(() => next(new Error('unauthorized')));
  });

  /** The friends list as `account` should see it, with presence + activity resolved. */
  const friendView = (account: string): social.Friend[] =>
    deps.store.friendsOf(account).map((edge) => {
      const online = isOnline(edge.accountId);
      return {
        accountId: edge.accountId,
        displayName: deps.store.getAccount(edge.accountId)?.displayName ?? shortCode(edge.accountId),
        status: edge.status,
        presence: online ? 'online' : 'offline',
        activity: online ? (activityOf.get(edge.accountId) ?? null) : null,
      };
    });

  const emitFriendsTo = (account: string): void => {
    const sockets = socketsOf.get(account);
    if (!sockets || sockets.size === 0) return;
    const payload = { friends: friendView(account) };
    for (const id of sockets) io.to(id).emit(social.S2C.friends, payload);
  };

  /** Refresh `account` and everyone it has an edge with — a change in one ripples to its friends. */
  const refresh = (account: string): void => {
    emitFriendsTo(account);
    for (const edge of deps.store.friendsOf(account)) emitFriendsTo(edge.accountId);
  };

  io.on('connection', (socket) => {
    const { accountId, displayName } = socket.data as SocketData;
    deps.store.upsertAccount(accountId, displayName);

    const wasOffline = !isOnline(accountId);
    const set = socketsOf.get(accountId) ?? new Set<string>();
    set.add(socket.id);
    socketsOf.set(accountId, set);
    deps.logger.info('connect', { accountId, socket: socket.id });

    socket.emit(social.S2C.me, { accountId, displayName });
    emitFriendsTo(accountId);
    if (wasOffline) for (const edge of deps.store.friendsOf(accountId)) emitFriendsTo(edge.accountId);

    const guard = (fn: () => void): void => {
      try {
        fn();
      } catch (err) {
        if (err instanceof ContractError) socket.emit(social.S2C.error, err.toProtocol());
        else {
          deps.logger.error('handler', { err: String(err) });
          socket.emit(social.S2C.error, { code: 'internal', message: 'internal error' });
        }
      }
    };

    socket.on(social.C2S.request, (raw) =>
      guard(() => {
        const { code } = parse(social.requestPayload, raw);
        if (code === accountId) throw new ContractError('validation', 'cannot friend yourself');
        deps.store.request(accountId, code);
        refresh(accountId);
      }),
    );
    socket.on(social.C2S.accept, (raw) =>
      guard(() => {
        deps.store.accept(accountId, parse(social.targetPayload, raw).accountId);
        refresh(accountId);
      }),
    );
    socket.on(social.C2S.decline, (raw) =>
      guard(() => {
        const other = parse(social.targetPayload, raw).accountId;
        deps.store.decline(accountId, other);
        emitFriendsTo(accountId);
        emitFriendsTo(other);
      }),
    );
    socket.on(social.C2S.remove, (raw) =>
      guard(() => {
        const other = parse(social.targetPayload, raw).accountId;
        deps.store.remove(accountId, other);
        emitFriendsTo(accountId);
        emitFriendsTo(other);
      }),
    );
    socket.on(social.C2S.setActivity, (raw) =>
      guard(() => {
        const { activity } = parse(social.setActivityPayload, raw);
        if (activity) activityOf.set(accountId, activity);
        else activityOf.delete(accountId);
        refresh(accountId);
      }),
    );
    socket.on(social.C2S.getState, () => guard(() => emitFriendsTo(accountId)));

    // Mint a join code for the given room; ack returns it so the creator can copy a link/code.
    socket.on(social.C2S.createInvite, (raw, ack?: (res: social.CreateInviteAck) => void) =>
      guard(() => {
        const t = parse(social.createInvitePayload, raw);
        const rec = deps.invites.create({ ...t, inviter: accountId, inviterName: displayName });
        if (typeof ack === 'function') ack({ code: rec.code });
      }),
    );

    // Mint a code and push the invite straight to a friend's presence channel (Steam-style).
    socket.on(social.C2S.inviteFriend, (raw) =>
      guard(() => {
        const { accountId: friendId, ...t } = parse(social.inviteFriendPayload, raw);
        const isFriend = deps.store.friendsOf(accountId).some((f) => f.accountId === friendId && f.status === 'accepted');
        if (!isFriend) throw new ContractError('forbidden', 'not your friend');
        const rec = deps.invites.create({ ...t, inviter: accountId, inviterName: displayName });
        const sockets = socketsOf.get(friendId);
        if (sockets) for (const id of sockets) io.to(id).emit(social.S2C.invite, { invite: toWireInvite(rec) });
      }),
    );

    socket.on('disconnect', () => {
      const sockets = socketsOf.get(accountId);
      sockets?.delete(socket.id);
      if (sockets && sockets.size === 0) {
        socketsOf.delete(accountId);
        activityOf.delete(accountId);
        // Now offline — let friends see it.
        for (const edge of deps.store.friendsOf(accountId)) emitFriendsTo(edge.accountId);
      }
    });
  });

  return { httpServer, io };
};
