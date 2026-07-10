/**
 * Chat transport: a Socket.io server that authenticates each socket with the platform JWT and binds
 * it to the player's **account** (mirrors `services/social/src/server.ts`). Handles both DMs and
 * groups through the unified `Conversation` concept. On any change to a conversation, every
 * participant's thread list is refreshed (same "push the full view" model social uses); a new message
 * is also pushed immediately so an open chat window updates without waiting for the next push.
 */
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import { Server as IOServer, type Socket } from 'socket.io';
import { AccessToken } from 'livekit-server-sdk';
import { ContractError, chat } from '@mygame/protocol';
import type { AuthCore } from '@mygame/auth-core';
import type { Logger } from '@mygame/shared-types';
import type { ZodType } from 'zod';
import type { ChatStore } from './store.js';

interface SocketData {
  accountId: string;
  displayName: string;
}

export interface ChatDeps {
  readonly auth: AuthCore;
  readonly store: ChatStore;
  readonly logger: Logger;
  readonly corsOrigin: string;
  readonly livekit: { url: string; apiKey: string; apiSecret: string };
}

/** A call is purely live state — never persisted (see the module doc comment above). */
interface ActiveCall {
  type: chat.CallType;
  participantIds: Set<string>;
}

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization',
};

const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json', ...CORS_HEADERS });
  res.end(JSON.stringify(body));
};

const readJsonBody = async (req: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
};

const bearer = (req: IncomingMessage): string | null => {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice('Bearer '.length) : null;
};

export interface ChatServer {
  httpServer: HttpServer;
  io: IOServer;
}

const parse = <T>(schema: ZodType<T>, raw: unknown): T => {
  const r = schema.safeParse(raw ?? {});
  if (!r.success) throw new ContractError('validation', 'invalid payload');
  return r.data;
};

export const createChatServer = (deps: ChatDeps): ChatServer => {
  // Ephemeral call state (see the ActiveCall doc comment) — declared here so both the HTTP token
  // route and the socket signaling handlers below can check "is the caller actually in this call".
  const activeCalls = new Map<string, ActiveCall>(); // conversationId -> call

  const handleHttp = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }
    if (req.url === '/health' || req.url === '/ready') {
      sendJson(res, 200, { status: 'ok', service: 'chat' });
      return;
    }

    // Mint a LiveKit room-scoped access token for an ongoing/ringing call. HTTP (not a socket event)
    // because the client needs it as a plain string to hand to livekit-client's Room.connect.
    if (req.method === 'POST' && req.url === '/chat/call/token') {
      const token = bearer(req);
      if (!token) {
        sendJson(res, 401, { code: 'unauthorized', message: 'missing access token' });
        return;
      }
      let accountId: string;
      let displayName: string;
      try {
        const claims = await deps.auth.verify(token);
        if (claims.typ !== 'access') throw new Error('not an access token');
        accountId = claims.sub;
        displayName = claims.name;
      } catch {
        sendJson(res, 401, { code: 'unauthorized', message: 'invalid access token' });
        return;
      }
      const parsed = chat.callTokenRequest.safeParse(await readJsonBody(req));
      if (!parsed.success) {
        sendJson(res, 400, { code: 'validation', message: 'invalid request' });
        return;
      }
      if (!deps.store.isParticipant(parsed.data.conversationId, accountId)) {
        sendJson(res, 403, { code: 'forbidden', message: 'not a participant of this conversation' });
        return;
      }
      const at = new AccessToken(deps.livekit.apiKey, deps.livekit.apiSecret, { identity: accountId, name: displayName });
      at.addGrant({ roomJoin: true, room: parsed.data.conversationId, canPublish: true, canSubscribe: true });
      const jwt = await at.toJwt();
      const body: chat.CallTokenResponse = { token: jwt, url: deps.livekit.url };
      sendJson(res, 200, body);
      return;
    }

    sendJson(res, 404, { error: 'not_found' });
  };

  const httpServer = createServer((req, res) => {
    void handleHttp(req, res).catch((err) => {
      if (res.headersSent) return;
      deps.logger.error('http', { err: String(err) });
      sendJson(res, 500, { code: 'internal', message: 'internal error' });
    });
  });

  // Custom path — see the matching comment in services/social/src/server.ts: on a shared production
  // origin, the default `/socket.io/` would collide with social's socket and the game lobby's.
  const io = new IOServer(httpServer, {
    path: '/chat.io/',
    cors: { origin: deps.corsOrigin, methods: ['GET', 'POST'] },
  });

  const socketsOf = new Map<string, Set<string>>(); // accountId -> connected socket ids

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

  const emitTo = (accountId: string, event: string, payload: unknown): void => {
    const sockets = socketsOf.get(accountId);
    if (!sockets) return;
    for (const id of sockets) io.to(id).emit(event, payload);
  };

  const emitToEveryone = (accountIds: string[], event: string, payload: unknown): void => {
    for (const id of accountIds) emitTo(id, event, payload);
  };

  const emitThreads = (accountId: string): void => {
    if (!socketsOf.get(accountId)?.size) return;
    const payload: chat.ThreadsEvent = { threads: deps.store.threads(accountId) };
    emitTo(accountId, chat.S2C.threads, payload);
  };

  io.on('connection', (socket: Socket) => {
    const { accountId, displayName } = socket.data as SocketData;
    deps.store.upsertAccount(accountId, displayName);

    const set = socketsOf.get(accountId) ?? new Set<string>();
    set.add(socket.id);
    socketsOf.set(accountId, set);
    deps.logger.info('connect', { accountId, socket: socket.id });

    emitThreads(accountId);

    const guard = (fn: () => void): void => {
      try {
        fn();
      } catch (err) {
        if (err instanceof ContractError) socket.emit(chat.S2C.error, err.toProtocol());
        else {
          deps.logger.error('handler', { err: String(err) });
          socket.emit(chat.S2C.error, { code: 'internal', message: 'internal error' });
        }
      }
    };

    socket.on(chat.C2S.openDm, (raw, ack?: (res: chat.OpenDmAck) => void) =>
      guard(() => {
        const { withAccountId } = parse(chat.openDmPayload, raw);
        if (withAccountId === accountId) throw new ContractError('validation', 'cannot DM yourself');
        const conv = deps.store.openDm(accountId, withAccountId);
        if (typeof ack === 'function') ack({ conversationId: conv.id });
        emitThreads(accountId);
        emitThreads(withAccountId);
      }),
    );

    socket.on(chat.C2S.createGroup, (raw, ack?: (res: chat.CreateGroupAck) => void) =>
      guard(() => {
        const { name, memberIds } = parse(chat.createGroupPayload, raw);
        const conv = deps.store.createGroup(accountId, name, memberIds);
        if (typeof ack === 'function') ack({ conversationId: conv.id });
        for (const p of conv.participantIds) emitThreads(p);
      }),
    );

    socket.on(chat.C2S.addMembers, (raw, ack?: (res: chat.AddMembersAck) => void) =>
      guard(() => {
        const { conversationId, memberIds } = parse(chat.addMembersPayload, raw);
        if (!deps.store.isParticipant(conversationId, accountId)) {
          throw new ContractError('forbidden', 'not a participant of this conversation');
        }
        const result = deps.store.addMembers(conversationId, memberIds);
        if (typeof result === 'string') throw new ContractError('validation', result);
        if (typeof ack === 'function') ack({ conversationId: result.id });
        for (const p of result.participantIds) emitThreads(p);
      }),
    );

    socket.on(chat.C2S.removeMember, (raw, ack?: (res: chat.RemoveMemberAck) => void) =>
      guard(() => {
        const { conversationId, accountId: targetId } = parse(chat.removeMemberPayload, raw);
        const isSelf = targetId === accountId;
        // Ownership doesn't transfer on leave, so also require the caller still be a participant —
        // otherwise a departed owner would retain kick power forever over a group they already left.
        const isOwner =
          deps.store.isParticipant(conversationId, accountId) && deps.store.ownerOf(conversationId) === accountId;
        if (!isSelf && !isOwner) {
          throw new ContractError('forbidden', 'only the group owner may remove other members');
        }
        const before = deps.store.participantsOf(conversationId);
        const result = deps.store.removeMember(conversationId, targetId);
        if (typeof result === 'string') throw new ContractError('validation', result);
        if (typeof ack === 'function') ack({ ok: true });
        for (const p of before) emitThreads(p);
      }),
    );

    socket.on(chat.C2S.send, (raw, ack?: (res: chat.SendAck) => void) =>
      guard(() => {
        const { conversationId, text } = parse(chat.sendPayload, raw);
        if (!deps.store.isParticipant(conversationId, accountId)) {
          throw new ContractError('forbidden', 'not a participant of this conversation');
        }
        const message = deps.store.send(conversationId, accountId, text);
        if (!message) throw new ContractError('internal', 'send failed');
        const payload: chat.MessageEvent = { message };
        if (typeof ack === 'function') ack({ message });
        const participants = deps.store.participantsOf(conversationId);
        emitToEveryone(participants, chat.S2C.message, payload);
        for (const p of participants) emitThreads(p);
      }),
    );

    socket.on(chat.C2S.markRead, (raw) =>
      guard(() => {
        const { conversationId } = parse(chat.markReadPayload, raw);
        const result = deps.store.markRead(conversationId, accountId);
        if (result) {
          emitThreads(accountId);
          const payload: chat.ReadEvent = { conversationId, byAccountId: accountId, upTo: result.upTo };
          const others = deps.store.participantsOf(conversationId).filter((p) => p !== accountId);
          emitToEveryone(others, chat.S2C.read, payload);
        }
      }),
    );

    socket.on(chat.C2S.getHistory, (raw, ack?: (res: chat.HistoryAck) => void) =>
      guard(() => {
        const { conversationId, limit } = parse(chat.getHistoryPayload, raw);
        if (!deps.store.isParticipant(conversationId, accountId)) {
          throw new ContractError('forbidden', 'not a participant of this conversation');
        }
        const messages = deps.store.history(conversationId, limit ?? 100);
        if (typeof ack === 'function') ack({ conversationId, messages });
      }),
    );

    socket.on(chat.C2S.getState, () => guard(() => emitThreads(accountId)));

    /** Remove `accountId` from `conversationId`'s call; ends it (broadcasting callEnded) once empty or 1 person left in DM. */
    const leaveCall = (conversationId: string): void => {
      const call = activeCalls.get(conversationId);
      if (!call?.participantIds.delete(accountId)) return;
      
      const isDm = deps.store.typeOf(conversationId) === 'dm';
      const threshold = isDm ? 1 : 0;
      
      if (call.participantIds.size <= threshold) {
        activeCalls.delete(conversationId);
        const payload: chat.CallEndedEvent = { conversationId };
        emitToEveryone(deps.store.participantsOf(conversationId), chat.S2C.callEnded, payload);
      }
    };

    // Voice/video call signaling — ephemeral (`activeCalls` above), no store/Postgres involvement;
    // the actual media flows over LiveKit once a client has a token from `POST /chat/call/token`.
    socket.on(chat.C2S.callRing, (raw, ack?: (res: chat.CallAck) => void) =>
      guard(() => {
        const { conversationId, callType } = parse(chat.callRingPayload, raw);
        if (!deps.store.isParticipant(conversationId, accountId)) {
          throw new ContractError('forbidden', 'not a participant of this conversation');
        }
        const call = activeCalls.get(conversationId);
        if (call) call.participantIds.add(accountId);
        else activeCalls.set(conversationId, { type: callType, participantIds: new Set([accountId]) });
        const payload: chat.CallRingEvent = { conversationId, fromAccountId: accountId, fromName: displayName, callType };
        const others = deps.store.participantsOf(conversationId).filter((p) => p !== accountId);
        emitToEveryone(others, chat.S2C.callRing, payload);
        if (typeof ack === 'function') ack({ ok: true });
      }),
    );

    socket.on(chat.C2S.callAccept, (raw, ack?: (res: chat.CallAck) => void) =>
      guard(() => {
        const { conversationId } = parse(chat.callActionPayload, raw);
        const call = activeCalls.get(conversationId);
        if (!call) throw new ContractError('validation', 'no call in progress');
        if (!deps.store.isParticipant(conversationId, accountId)) {
          throw new ContractError('forbidden', 'not a participant of this conversation');
        }
        call.participantIds.add(accountId);
        const payload: chat.CallParticipantEvent = { conversationId, accountId };
        emitToEveryone([...call.participantIds], chat.S2C.callAccepted, payload);
        if (typeof ack === 'function') ack({ ok: true });
      }),
    );

    // Declining doesn't unilaterally end the call (a group call goes on for whoever's already
    // joined) — it only informs the ringer(s), who decide client-side whether to hang up (e.g. a 1:1
    // call has no one left to wait for, so the ringer's own client reacts by hanging up itself).
    socket.on(chat.C2S.callDecline, (raw) =>
      guard(() => {
        const { conversationId } = parse(chat.callActionPayload, raw);
        const payload: chat.CallParticipantEvent = { conversationId, accountId };
        const others = deps.store.participantsOf(conversationId).filter((p) => p !== accountId);
        emitToEveryone(others, chat.S2C.callDeclined, payload);
      }),
    );

    socket.on(chat.C2S.callHangup, (raw) =>
      guard(() => {
        const { conversationId } = parse(chat.callActionPayload, raw);
        leaveCall(conversationId);
      }),
    );

    socket.on('disconnect', () => {
      const sockets = socketsOf.get(accountId);
      sockets?.delete(socket.id);
      if (sockets && sockets.size === 0) {
        socketsOf.delete(accountId);
        // Fully offline (no other tabs/devices) — drop out of any call rather than leave a ghost
        // participant nobody can ever remove.
        for (const conversationId of [...activeCalls.keys()]) leaveCall(conversationId);
      }
    });
  });

  return { httpServer, io };
};
