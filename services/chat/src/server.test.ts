import { afterEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { io as ioc, type Socket as ClientSocket } from 'socket.io-client';
import { createAuthCore } from '@mygame/auth-core';
import { chat } from '@mygame/protocol';
import { createCapturingLogger } from '@mygame/test-harness';
import { createChatServer, type ChatServer } from './server.js';
import { createMemoryChatStore } from './store.js';

const auth = createAuthCore({ secret: 's', issuer: 'civa', accessTtl: '15m', refreshTtl: '30d' });

let server: ChatServer | undefined;
const clients: ClientSocket[] = [];

afterEach(() => {
  clients.splice(0).forEach((c) => c.close());
  server?.io.close();
  server?.httpServer.close();
  server = undefined;
});

const startServer = (): Promise<number> => {
  server = createChatServer({
    auth,
    store: createMemoryChatStore(),
    logger: createCapturingLogger(),
    corsOrigin: '*',
  });
  return new Promise((r) =>
    server!.httpServer.listen(0, () => r((server!.httpServer.address() as AddressInfo).port)),
  );
};

const connect = async (port: number, accountId: string, name: string): Promise<ClientSocket> => {
  const token = await auth.signAccess(accountId, name);
  const c = ioc(`http://127.0.0.1:${port}`, { auth: { token }, transports: ['websocket'], forceNew: true });
  clients.push(c);
  await new Promise<void>((res) => c.once('connect', () => res()));
  return c;
};

/** Resolve on the next chat.threads push whose list matches the predicate. Register BEFORE the
 *  triggering action — the push is a one-shot event, not a queryable state. */
const waitThreads = (c: ClientSocket, predicate: (t: chat.ChatThread[]) => boolean) =>
  new Promise<chat.ChatThread[]>((res) => {
    const h = (p: chat.ThreadsEvent) => {
      if (predicate(p.threads)) {
        c.off(chat.S2C.threads, h);
        res(p.threads);
      }
    };
    c.on(chat.S2C.threads, h);
  });

const send = (c: ClientSocket, toAccountId: string, text: string) =>
  new Promise<chat.SendAck>((res) => c.emit(chat.C2S.send, { toAccountId, text }, res));

describe('chat server — direct messages', () => {
  it('delivers a sent message to the recipient and both thread lists', async () => {
    const port = await startServer();
    const c1 = await connect(port, 'a1', 'Mara');
    const c2 = await connect(port, 'a2', 'Wei');

    const delivered = new Promise<chat.MessageEvent>((res) => c2.once(chat.S2C.message, res));
    const threadsPushed = waitThreads(c2, (t) => t.some((x) => x.accountId === 'a1'));
    const ack = await send(c1, 'a2', 'hey Wei');
    expect(ack.message).toMatchObject({ senderId: 'a1', recipientId: 'a2', text: 'hey Wei' });

    const { message } = await delivered;
    expect(message.text).toBe('hey Wei');

    const threads2 = await threadsPushed;
    expect(threads2.find((t) => t.accountId === 'a1')).toMatchObject({ displayName: 'Mara', unreadCount: 1 });
  });

  it('rejects messaging yourself', async () => {
    const port = await startServer();
    const c1 = await connect(port, 'a1', 'Mara');
    const err = new Promise<{ code: string }>((res) => c1.once(chat.S2C.error, res));
    c1.emit(chat.C2S.send, { toAccountId: 'a1', text: 'hi me' });
    expect((await err).code).toBe('validation');
  });

  it("markRead clears the recipient's unread count and notifies the sender", async () => {
    const port = await startServer();
    const c1 = await connect(port, 'a1', 'Mara');
    const c2 = await connect(port, 'a2', 'Wei');

    const unreadOne = waitThreads(c2, (t) => t.some((x) => x.accountId === 'a1' && x.unreadCount === 1));
    await send(c1, 'a2', 'hey');
    await unreadOne;

    const readNotice = new Promise<chat.ReadEvent>((res) => c1.once(chat.S2C.read, res));
    const unreadZero = waitThreads(c2, (t) => t.find((x) => x.accountId === 'a1')?.unreadCount === 0);
    c2.emit(chat.C2S.markRead, { withAccountId: 'a1' });

    const notice = await readNotice;
    expect(notice.byAccountId).toBe('a2');

    const threads2 = await unreadZero;
    expect(threads2.find((t) => t.accountId === 'a1')?.unreadCount).toBe(0);
  });

  it('getHistory returns prior messages via ack', async () => {
    const port = await startServer();
    const c1 = await connect(port, 'a1', 'Mara');
    const c2 = await connect(port, 'a2', 'Wei');
    await send(c1, 'a2', 'one');
    await send(c1, 'a2', 'two');

    const history = await new Promise<chat.HistoryAck>((res) =>
      c2.emit(chat.C2S.getHistory, { withAccountId: 'a1' }, res),
    );
    expect(history.messages.map((m) => m.text)).toEqual(['one', 'two']);
  });
});
