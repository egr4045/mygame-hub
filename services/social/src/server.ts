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
  /** Live ban check (pg-backed in production; absent = nothing is ever banned, e.g. dev/memory). */
  readonly isAccountBanned?: (accountId: string) => Promise<boolean>;
  /** Resolve a short friend code (or raw accountId) to an accountId. Absent (dev/memory) → the code
   *  is treated as the accountId, preserving the pre-friend-code behaviour. */
  readonly resolveFriendCode?: (code: string) => Promise<string | null>;
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

  // Custom path: in production auth/social/chat/community all share one origin (Caddy path-routes
  // between them), so the default `/socket.io/` would collide with both chat's socket and the game
  // lobby's own socket.io server on that same origin. Each gets its own reserved path instead.
  const io = new IOServer(httpServer, {
    path: '/social.io/',
    cors: { origin: deps.corsOrigin, methods: ['GET', 'POST'] },
  });

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
      .then(async (claims) => {
        if (claims.typ !== 'access') {
          next(new Error('unauthorized'));
          return;
        }
        if (deps.isAccountBanned && (await deps.isAccountBanned(claims.sub))) {
          next(new Error('forbidden'));
          return;
        }
        (socket.data as SocketData).accountId = claims.sub;
        (socket.data as SocketData).displayName = claims.name;
        next();
      })
      .catch(() => next(new Error('unauthorized')));
  });

  /** The friends list as `account` should see it, with presence + activity resolved. Blocked accounts
   *  (either direction) are filtered out entirely — the underlying edge stays intact, so unblocking
   *  needs no re-friending step. */
  const friendView = (account: string): social.Friend[] =>
    deps.store
      .friendsOf(account)
      .filter((edge) => !deps.store.isBlocked(account, edge.accountId))
      .map((edge) => {
        const online = isOnline(edge.accountId);
        const acc = deps.store.getAccount(edge.accountId);
        return {
          accountId: edge.accountId,
          displayName: acc?.displayName ?? shortCode(edge.accountId),
          avatarIcon: acc?.avatarIcon ?? null,
          titleAchievement: acc?.titleAchievement ?? null,
          status: edge.status,
          presence: online ? 'online' : 'offline',
          activity: online ? (activityOf.get(edge.accountId) ?? null) : null,
        };
      });

  /** My own identity as pushed on connect/profile-refresh. */
  const meView = (accountId: string): social.MeEvent => {
    const acc = deps.store.getAccount(accountId);
    return {
      accountId,
      displayName: acc?.displayName ?? shortCode(accountId),
      avatarIcon: acc?.avatarIcon ?? null,
      titleAchievement: acc?.titleAchievement ?? null,
    };
  };


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

    socket.emit(social.S2C.me, meView(accountId));
    emitFriendsTo(accountId);
    if (wasOffline) for (const edge of deps.store.friendsOf(accountId)) emitFriendsTo(edge.accountId);

    // Avatar/title live on the shared `accounts` table, owned by `auth` — nothing pushes a live
    // signal when they change elsewhere, so re-read on every connect (cheap, indexed). Once
    // resolved, re-push so I see my own fresh profile and my friends see it too.
    void deps.store.refreshProfile(accountId).then(() => {
      socket.emit(social.S2C.me, meView(accountId));
      refresh(accountId);
    });

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

    socket.on(social.C2S.request, (raw, ack?: (res: social.RequestAck) => void) => {
      // Async (resolves the short friend code → accountId via the shared DB), so it can't use the
      // sync `guard`. The ack reports «код не найден» so the client can tell the user.
      void (async () => {
        try {
          const { code } = parse(social.requestPayload, raw);
          // With no resolver (dev/memory) the code IS the accountId, matching the old behaviour.
          const target = deps.resolveFriendCode ? await deps.resolveFriendCode(code) : code;
          if (!target) {
            ack?.({ error: 'Код не найден' });
            return;
          }
          if (target === accountId) {
            ack?.({ error: 'Нельзя добавить себя' });
            return;
          }
          // Target has blocked me: pretend it worked rather than reveal the block (anti-probing).
          if (deps.store.isBlocked(target, accountId)) {
            ack?.({ ok: true });
            return;
          }
          deps.store.request(accountId, target);
          refresh(accountId);
          ack?.({ ok: true });
        } catch (err) {
          if (err instanceof ContractError) ack?.({ error: err.message });
          else {
            deps.logger.error('friend request', { err: String(err) });
            ack?.({ error: 'Ошибка' });
          }
        }
      })();
    });
    // Find people to add — by display name OR friend code. The ack carries my relation to each hit so
    // the UI shows the right action (add / pending / already a friend / it's me). Async: hits the
    // shared accounts table. Accounts either side has blocked are omitted (anti-probing, like request).
    socket.on(social.C2S.search, (raw, ack?: (res: social.SearchAck) => void) => {
      void (async () => {
        try {
          const { query } = parse(social.searchPayload, raw);
          const matches = await deps.store.searchAccounts(query, 8);
          const edges = deps.store.friendsOf(accountId);
          const relationOf = (id: string): social.SearchRelation => {
            if (id === accountId) return 'self';
            const edge = edges.find((e) => e.accountId === id);
            return edge ? (edge.status === 'accepted' ? 'friend' : edge.status) : 'none';
          };
          const results = matches
            .filter((m) => !deps.store.isBlocked(accountId, m.accountId))
            .map((m) => ({
              accountId: m.accountId,
              displayName: m.displayName,
              avatarIcon: m.avatarIcon,
              friendCode: m.friendCode,
              titleAchievement: m.titleAchievement,
              relation: relationOf(m.accountId),
            }));
          ack?.({ results });
        } catch (err) {
          if (!(err instanceof ContractError)) deps.logger.error('search', { err: String(err) });
          ack?.({ results: [] });
        }
      })();
    });

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

    // Blocking hides presence/activity between the two accounts both ways and rejects new requests
    // from the blocked side; it never touches the friend edge itself, so unblocking just restores
    // visibility. `refresh` reaches the blocked account too (if they were a friend) via their edge.
    socket.on(social.C2S.block, (raw, ack?: (res: social.BlockAck) => void) =>
      guard(() => {
        const other = parse(social.targetPayload, raw).accountId;
        if (other === accountId) throw new ContractError('validation', 'cannot block yourself');
        deps.store.block(accountId, other);
        refresh(accountId);
        if (typeof ack === 'function') ack({ ok: true });
      }),
    );
    socket.on(social.C2S.unblock, (raw, ack?: (res: social.BlockAck) => void) =>
      guard(() => {
        const other = parse(social.targetPayload, raw).accountId;
        deps.store.unblock(accountId, other);
        refresh(accountId);
        if (typeof ack === 'function') ack({ ok: true });
      }),
    );
    socket.on(social.C2S.getBlocked, (_raw, ack?: (res: social.GetBlockedAck) => void) =>
      guard(() => {
        const blocked = deps.store.blockedByMe(accountId).map((a) => ({ accountId: a.id, displayName: a.displayName }));
        if (typeof ack === 'function') ack({ blocked });
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
