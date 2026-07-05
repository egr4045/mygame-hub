/**
 * Chat transport: a Socket.io server that authenticates each socket with the platform JWT and binds
 * it to the player's **account** (mirrors `services/social/src/server.ts`). Handles both DMs and
 * groups through the unified `Conversation` concept. On any change to a conversation, every
 * participant's thread list is refreshed (same "push the full view" model social uses); a new message
 * is also pushed immediately so an open chat window updates without waiting for the next push.
 */
import { createServer, type Server as HttpServer } from 'node:http';
import { Server as IOServer, type Socket } from 'socket.io';
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
}

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
  const httpServer = createServer((req, res) => {
    const cors = { 'content-type': 'application/json', 'access-control-allow-origin': '*' };
    if (req.url === '/health' || req.url === '/ready') {
      res.writeHead(200, cors);
      res.end(JSON.stringify({ status: 'ok', service: 'chat' }));
      return;
    }
    res.writeHead(404, cors);
    res.end(JSON.stringify({ error: 'not_found' }));
  });

  const io = new IOServer(httpServer, { cors: { origin: deps.corsOrigin, methods: ['GET', 'POST'] } });

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

    socket.on('disconnect', () => {
      const sockets = socketsOf.get(accountId);
      sockets?.delete(socket.id);
      if (sockets && sockets.size === 0) socketsOf.delete(accountId);
    });
  });

  return { httpServer, io };
};
