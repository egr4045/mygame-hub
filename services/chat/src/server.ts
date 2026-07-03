/**
 * Chat transport: a Socket.io server that authenticates each socket with the platform JWT and binds
 * it to the player's **account** (mirrors `services/social/src/server.ts`). Direct messages only —
 * no group chat yet. On any change to a thread, the affected account gets a fresh full thread list
 * (same "push the full view" model social uses); a new message is also pushed immediately so an open
 * chat window updates without waiting for the next thread-list push.
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

    socket.on(chat.C2S.send, (raw, ack?: (res: chat.SendAck) => void) =>
      guard(() => {
        const { toAccountId, text } = parse(chat.sendPayload, raw);
        if (toAccountId === accountId) throw new ContractError('validation', 'cannot message yourself');
        const message = deps.store.send(accountId, toAccountId, text);
        const payload: chat.MessageEvent = { message };
        if (typeof ack === 'function') ack({ message });
        emitTo(accountId, chat.S2C.message, payload);
        emitTo(toAccountId, chat.S2C.message, payload);
        emitThreads(accountId);
        emitThreads(toAccountId);
      }),
    );

    socket.on(chat.C2S.markRead, (raw) =>
      guard(() => {
        const { withAccountId } = parse(chat.markReadPayload, raw);
        const result = deps.store.markRead(accountId, withAccountId);
        if (result) {
          emitThreads(accountId);
          const payload: chat.ReadEvent = { byAccountId: accountId, upTo: result.upTo };
          emitTo(withAccountId, chat.S2C.read, payload);
        }
      }),
    );

    socket.on(chat.C2S.getHistory, (raw, ack?: (res: chat.HistoryAck) => void) =>
      guard(() => {
        const { withAccountId, limit } = parse(chat.getHistoryPayload, raw);
        const messages = deps.store.history(accountId, withAccountId, limit ?? 100);
        if (typeof ack === 'function') ack({ withAccountId, messages });
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
