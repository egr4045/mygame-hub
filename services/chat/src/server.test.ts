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

const startServer = (overrides: Partial<Parameters<typeof createChatServer>[0]> = {}): Promise<number> => {
  server = createChatServer({
    auth,
    store: createMemoryChatStore(),
    logger: createCapturingLogger(),
    corsOrigin: '*',
    livekit: { url: 'ws://localhost:7880', apiKey: 'devkey', apiSecret: 'secret' },
    ...overrides,
  });
  return new Promise((r) =>
    server!.httpServer.listen(0, () => r((server!.httpServer.address() as AddressInfo).port)),
  );
};

const connect = async (port: number, accountId: string, name: string): Promise<ClientSocket> => {
  const token = await auth.signAccess(accountId, name);
  const c = ioc(`http://127.0.0.1:${port}`, { path: '/chat.io/', auth: { token }, transports: ['websocket'], forceNew: true });
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

const openDm = (c: ClientSocket, withAccountId: string) =>
  new Promise<chat.OpenDmAck>((res) => c.emit(chat.C2S.openDm, { withAccountId }, res));

const createGroup = (c: ClientSocket, name: string, memberIds: string[]) =>
  new Promise<chat.CreateGroupAck>((res) => c.emit(chat.C2S.createGroup, { name, memberIds }, res));

const send = (c: ClientSocket, conversationId: string, text: string) =>
  new Promise<chat.SendAck>((res) => c.emit(chat.C2S.send, { conversationId, text }, res));

const addMembers = (c: ClientSocket, conversationId: string, memberIds: string[]) =>
  new Promise<chat.AddMembersAck>((res) => c.emit(chat.C2S.addMembers, { conversationId, memberIds }, res));

const removeMember = (c: ClientSocket, conversationId: string, accountId: string) =>
  new Promise<chat.RemoveMemberAck>((res) => c.emit(chat.C2S.removeMember, { conversationId, accountId }, res));

const ring = (c: ClientSocket, conversationId: string, callType: chat.CallType) =>
  new Promise<chat.CallAck>((res) => c.emit(chat.C2S.callRing, { conversationId, callType }, res));

const acceptCall = (c: ClientSocket, conversationId: string) =>
  new Promise<chat.CallAck>((res) => c.emit(chat.C2S.callAccept, { conversationId }, res));

describe('chat server — DMs', () => {
  it('opens the same DM conversation for both sides and delivers a message', async () => {
    const port = await startServer();
    const c1 = await connect(port, 'a1', 'Mara');
    const c2 = await connect(port, 'a2', 'Wei');

    const { conversationId } = await openDm(c1, 'a2');
    expect(conversationId).toBeTruthy();

    const delivered = new Promise<chat.MessageEvent>((res) => c2.once(chat.S2C.message, res));
    const threadsPushed = waitThreads(c2, (t) =>
      t.some((x) => x.conversationId === conversationId && x.unreadCount === 1),
    );
    const ack = await send(c1, conversationId!, 'hey Wei');
    expect(ack.message).toMatchObject({ conversationId, senderId: 'a1', senderName: 'Mara', text: 'hey Wei' });

    const { message } = await delivered;
    expect(message.text).toBe('hey Wei');

    const threads2 = await threadsPushed;
    expect(threads2.find((t) => t.conversationId === conversationId)).toMatchObject({
      type: 'dm',
      name: 'Mara',
      unreadCount: 1,
    });
  });

  it('rejects DMing yourself', async () => {
    const port = await startServer();
    const c1 = await connect(port, 'a1', 'Mara');
    const err = new Promise<{ code: string }>((res) => c1.once(chat.S2C.error, res));
    c1.emit(chat.C2S.openDm, { withAccountId: 'a1' });
    expect((await err).code).toBe('validation');
  });

  it('rejects sending into a conversation you are not part of', async () => {
    const port = await startServer();
    const c1 = await connect(port, 'a1', 'Mara');
    const c2 = await connect(port, 'a2', 'Wei');
    const c3 = await connect(port, 'a3', 'Zed');
    const { conversationId } = await openDm(c1, 'a2');

    const err = new Promise<{ code: string }>((res) => c3.once(chat.S2C.error, res));
    c3.emit(chat.C2S.send, { conversationId, text: 'sneaky' });
    expect((await err).code).toBe('forbidden');
  });

  it("markRead clears the recipient's unread count and notifies the sender", async () => {
    const port = await startServer();
    const c1 = await connect(port, 'a1', 'Mara');
    const c2 = await connect(port, 'a2', 'Wei');
    const { conversationId } = await openDm(c1, 'a2');

    const unreadOne = waitThreads(c2, (t) => t.some((x) => x.conversationId === conversationId && x.unreadCount === 1));
    await send(c1, conversationId!, 'hey');
    await unreadOne;

    const readNotice = new Promise<chat.ReadEvent>((res) => c1.once(chat.S2C.read, res));
    const unreadZero = waitThreads(c2, (t) => t.find((x) => x.conversationId === conversationId)?.unreadCount === 0);
    c2.emit(chat.C2S.markRead, { conversationId });

    const notice = await readNotice;
    expect(notice).toMatchObject({ conversationId, byAccountId: 'a2' });

    const threads2 = await unreadZero;
    expect(threads2.find((t) => t.conversationId === conversationId)?.unreadCount).toBe(0);
  });

  it('getHistory returns prior messages via ack', async () => {
    const port = await startServer();
    const c1 = await connect(port, 'a1', 'Mara');
    const c2 = await connect(port, 'a2', 'Wei');
    const { conversationId } = await openDm(c1, 'a2');
    await send(c1, conversationId!, 'one');
    await send(c1, conversationId!, 'two');

    const history = await new Promise<chat.HistoryAck>((res) =>
      c2.emit(chat.C2S.getHistory, { conversationId }, res),
    );
    expect(history.messages.map((m) => m.text)).toEqual(['one', 'two']);
  });
});

describe('chat server — groups', () => {
  it('creates a group and delivers a message to every member', async () => {
    const port = await startServer();
    const c1 = await connect(port, 'a1', 'Mara');
    const c2 = await connect(port, 'a2', 'Wei');
    const c3 = await connect(port, 'a3', 'Zed');

    const { conversationId } = await createGroup(c1, 'Squad', ['a2', 'a3']);
    expect(conversationId).toBeTruthy();

    const got2 = new Promise<chat.MessageEvent>((res) => c2.once(chat.S2C.message, res));
    const got3 = new Promise<chat.MessageEvent>((res) => c3.once(chat.S2C.message, res));
    await send(c1, conversationId!, 'hello squad');

    expect((await got2).message.text).toBe('hello squad');
    expect((await got3).message.text).toBe('hello squad');
  });

  it('rejects a non-member sending into the group', async () => {
    const port = await startServer();
    const c1 = await connect(port, 'a1', 'Mara');
    await connect(port, 'a2', 'Wei');
    const outsider = await connect(port, 'a3', 'Zed');
    const { conversationId } = await createGroup(c1, 'Squad', ['a2']);

    const err = new Promise<{ code: string }>((res) => outsider.once(chat.S2C.error, res));
    outsider.emit(chat.C2S.send, { conversationId, text: 'sneaky' });
    expect((await err).code).toBe('forbidden');
  });
});

describe('chat server — group membership', () => {
  it('any current member can add a new member, who is immediately pushed the thread', async () => {
    const port = await startServer();
    const c1 = await connect(port, 'a1', 'Mara');
    const c2 = await connect(port, 'a2', 'Wei');
    const c3 = await connect(port, 'a3', 'Zed');
    const { conversationId } = await createGroup(c1, 'Squad', ['a2']);

    // c2 is a plain member (not the owner) and can still add a3.
    const c3Threads = waitThreads(c3, (t) => t.some((x) => x.conversationId === conversationId));
    const ack = await addMembers(c2, conversationId!, ['a3']);
    expect(ack.conversationId).toBe(conversationId);

    const threads = await c3Threads;
    expect(threads.find((t) => t.conversationId === conversationId)).toMatchObject({ type: 'group', name: 'Squad' });
  });

  it('rejects addMembers from someone who is not a participant', async () => {
    const port = await startServer();
    const c1 = await connect(port, 'a1', 'Mara');
    await connect(port, 'a2', 'Wei');
    const outsider = await connect(port, 'a3', 'Zed');
    const { conversationId } = await createGroup(c1, 'Squad', ['a2']);

    const err = new Promise<{ code: string }>((res) => outsider.once(chat.S2C.error, res));
    outsider.emit(chat.C2S.addMembers, { conversationId, memberIds: ['a3'] });
    expect((await err).code).toBe('forbidden');
  });

  it('the group owner can remove another member, who is dropped from their own thread list', async () => {
    const port = await startServer();
    const c1 = await connect(port, 'a1', 'Mara');
    const c2 = await connect(port, 'a2', 'Wei');
    await connect(port, 'a3', 'Zed');
    const { conversationId } = await createGroup(c1, 'Squad', ['a2', 'a3']);

    const c2Dropped = waitThreads(c2, (t) => !t.some((x) => x.conversationId === conversationId));
    const ack = await removeMember(c1, conversationId!, 'a2');
    expect(ack.ok).toBe(true);
    await c2Dropped;
  });

  it('a non-owner member cannot remove someone else', async () => {
    const port = await startServer();
    const c1 = await connect(port, 'a1', 'Mara');
    const c2 = await connect(port, 'a2', 'Wei');
    await connect(port, 'a3', 'Zed');
    const { conversationId } = await createGroup(c1, 'Squad', ['a2', 'a3']);

    const err = new Promise<{ code: string }>((res) => c2.once(chat.S2C.error, res));
    c2.emit(chat.C2S.removeMember, { conversationId, accountId: 'a3' });
    expect((await err).code).toBe('forbidden');
  });

  it('any member — including the owner — can remove themselves (leave)', async () => {
    const port = await startServer();
    const c1 = await connect(port, 'a1', 'Mara');
    const c2 = await connect(port, 'a2', 'Wei');
    const { conversationId } = await createGroup(c1, 'Squad', ['a2']);

    const c1Left = waitThreads(c1, (t) => !t.some((x) => x.conversationId === conversationId));
    const ownerAck = await removeMember(c1, conversationId!, 'a1');
    expect(ownerAck.ok).toBe(true);
    await c1Left;

    const memberAck = await removeMember(c2, conversationId!, 'a2');
    expect(memberAck.ok).toBe(true);
  });

  it('a removed member can no longer send into the group', async () => {
    const port = await startServer();
    const c1 = await connect(port, 'a1', 'Mara');
    const c2 = await connect(port, 'a2', 'Wei');
    const { conversationId } = await createGroup(c1, 'Squad', ['a2']);
    await removeMember(c1, conversationId!, 'a2');

    const err = new Promise<{ code: string }>((res) => c2.once(chat.S2C.error, res));
    c2.emit(chat.C2S.send, { conversationId, text: 'sneaky' });
    expect((await err).code).toBe('forbidden');
  });
});

describe('chat server — call signaling', () => {
  it('ring → the other side gets callRing → accept → both get callAccepted', async () => {
    const port = await startServer();
    const c1 = await connect(port, 'a1', 'Mara');
    const c2 = await connect(port, 'a2', 'Wei');
    const { conversationId } = await openDm(c1, 'a2');

    const rang = new Promise<chat.CallRingEvent>((res) => c2.once(chat.S2C.callRing, res));
    const ringAck = await ring(c1, conversationId!, 'audio');
    expect(ringAck.ok).toBe(true);
    expect(await rang).toMatchObject({ conversationId, fromAccountId: 'a1', fromName: 'Mara', callType: 'audio' });

    const accepted1 = new Promise<chat.CallParticipantEvent>((res) => c1.once(chat.S2C.callAccepted, res));
    const accepted2 = new Promise<chat.CallParticipantEvent>((res) => c2.once(chat.S2C.callAccepted, res));
    const acceptAck = await acceptCall(c2, conversationId!);
    expect(acceptAck.ok).toBe(true);
    expect(await accepted1).toMatchObject({ conversationId, accountId: 'a2' });
    expect(await accepted2).toMatchObject({ conversationId, accountId: 'a2' });
  });

  it('declining pushes callDeclined to the ringer without ending the call outright', async () => {
    const port = await startServer();
    const c1 = await connect(port, 'a1', 'Mara');
    const c2 = await connect(port, 'a2', 'Wei');
    const { conversationId } = await openDm(c1, 'a2');
    await ring(c1, conversationId!, 'video');

    const declined = new Promise<chat.CallParticipantEvent>((res) => c1.once(chat.S2C.callDeclined, res));
    c2.emit(chat.C2S.callDecline, { conversationId });
    expect(await declined).toMatchObject({ conversationId, accountId: 'a2' });
  });

  it('hangup by the last participant ends the call for everyone', async () => {
    const port = await startServer();
    const c1 = await connect(port, 'a1', 'Mara');
    const c2 = await connect(port, 'a2', 'Wei');
    const { conversationId } = await openDm(c1, 'a2');
    await ring(c1, conversationId!, 'audio');
    await acceptCall(c2, conversationId!);

    const ended1 = new Promise<chat.CallEndedEvent>((res) => c1.once(chat.S2C.callEnded, res));
    const ended2 = new Promise<chat.CallEndedEvent>((res) => c2.once(chat.S2C.callEnded, res));
    c2.emit(chat.C2S.callHangup, { conversationId });
    // a1 (the ringer) is still counted as a participant until it also hangs up.
    c1.emit(chat.C2S.callHangup, { conversationId });
    expect(await ended1).toMatchObject({ conversationId });
    expect(await ended2).toMatchObject({ conversationId });
  });

  it('refuses to ring a conversation you are not part of', async () => {
    const port = await startServer();
    const c1 = await connect(port, 'a1', 'Mara');
    await connect(port, 'a2', 'Wei');
    const err = new Promise<{ code: string }>((res) => c1.once(chat.S2C.error, res));
    c1.emit(chat.C2S.callRing, { conversationId: 'not-mine', callType: 'audio' });
    expect((await err).code).toBe('forbidden');
  });

  it('disconnecting the last participant ends the call (no ghost caller)', async () => {
    const port = await startServer();
    const c1 = await connect(port, 'a1', 'Mara');
    const c2 = await connect(port, 'a2', 'Wei');
    const { conversationId } = await openDm(c1, 'a2');
    await ring(c1, conversationId!, 'audio');
    await acceptCall(c2, conversationId!);
    c2.emit(chat.C2S.callHangup, { conversationId }); // only a1 left in the call now

    // c2 stays connected (still a chat participant) so it can observe the broadcast once a1 — the
    // last remaining call participant — disconnects without an explicit hangup.
    const ended = new Promise<chat.CallEndedEvent>((res) => c2.once(chat.S2C.callEnded, res));
    c1.close();
    expect(await ended).toMatchObject({ conversationId });
  });

  it('rejects callDecline from a non-participant (no spoofed call termination)', async () => {
    const port = await startServer();
    const c1 = await connect(port, 'a1', 'Mara');
    await connect(port, 'a2', 'Wei');
    const outsider = await connect(port, 'a3', 'Zed');
    const { conversationId } = await openDm(c1, 'a2');
    await ring(c1, conversationId!, 'audio');

    let spoofed = false;
    c1.on(chat.S2C.callDeclined, () => {
      spoofed = true;
    });
    const err = new Promise<{ code: string }>((res) => outsider.once(chat.S2C.error, res));
    outsider.emit(chat.C2S.callDecline, { conversationId });
    expect((await err).code).toBe('forbidden');
    await new Promise((r) => setTimeout(r, 50));
    expect(spoofed).toBe(false);
  });

  it("an unanswered ring times out server-side with callEnded reason 'timeout'", async () => {
    const port = await startServer({ ringTimeoutMs: 60 });
    const c1 = await connect(port, 'a1', 'Mara');
    const c2 = await connect(port, 'a2', 'Wei');
    const { conversationId } = await openDm(c1, 'a2');

    const ended1 = new Promise<chat.CallEndedEvent>((res) => c1.once(chat.S2C.callEnded, res));
    const ended2 = new Promise<chat.CallEndedEvent>((res) => c2.once(chat.S2C.callEnded, res));
    await ring(c1, conversationId!, 'audio');
    expect(await ended1).toMatchObject({ conversationId, reason: 'timeout' });
    expect(await ended2).toMatchObject({ conversationId, reason: 'timeout' });
  });

  it('a re-ring never reaches someone already connected to the call', async () => {
    const port = await startServer();
    const c1 = await connect(port, 'a1', 'Mara');
    const c2 = await connect(port, 'a2', 'Wei');
    const c3 = await connect(port, 'a3', 'Zed');
    const { conversationId } = await createGroup(c1, 'Squad', ['a2', 'a3']);
    await ring(c1, conversationId!, 'audio');
    await acceptCall(c2, conversationId!);

    let reRung = false;
    c2.on(chat.S2C.callRing, () => {
      reRung = true;
    });
    const rang3 = new Promise<chat.CallRingEvent>((res) => c3.once(chat.S2C.callRing, res));
    await ring(c1, conversationId!, 'audio'); // e.g. the caller nudges the group again
    await rang3;
    await new Promise((r) => setTimeout(r, 50));
    expect(reRung).toBe(false);
  });

  it('rejects the socket handshake for a banned account', async () => {
    const port = await startServer({ isAccountBanned: async (id) => id === 'outlaw' });
    await connect(port, 'a1', 'Mara'); // sanity: non-banned connects fine
    const token = await auth.signAccess('outlaw', 'Outlaw');
    const c = ioc(`http://127.0.0.1:${port}`, { path: '/chat.io/', auth: { token }, transports: ['websocket'], forceNew: true });
    clients.push(c);
    const err = await new Promise<Error>((res) => c.once('connect_error', res));
    expect(err.message).toBe('forbidden');
  });
});

describe('chat server — group ownership on leave', () => {
  it('transfers ownership to an admin when the owner leaves', async () => {
    const port = await startServer();
    const c1 = await connect(port, 'a1', 'Mara');
    const c2 = await connect(port, 'a2', 'Wei');
    await connect(port, 'a3', 'Zed');
    const { conversationId } = await createGroup(c1, 'Squad', ['a2', 'a3']);
    await new Promise<chat.SetGroupRoleAck>((res) =>
      c1.emit(chat.C2S.setGroupRole, { conversationId, accountId: 'a3', role: 'admin' }, res),
    );

    const c2Sees = waitThreads(
      c2,
      (t) => t.find((x) => x.conversationId === conversationId)?.ownerId === 'a3',
    );
    await removeMember(c1, conversationId!, 'a1');
    await c2Sees;
  });

  it('transfers ownership to the longest-standing member when there are no admins', async () => {
    const port = await startServer();
    const c1 = await connect(port, 'a1', 'Mara');
    const c2 = await connect(port, 'a2', 'Wei');
    await connect(port, 'a3', 'Zed');
    const { conversationId } = await createGroup(c1, 'Squad', ['a2', 'a3']);

    const c2Sees = waitThreads(
      c2,
      (t) => t.find((x) => x.conversationId === conversationId)?.ownerId === 'a2',
    );
    await removeMember(c1, conversationId!, 'a1');
    const threads = await c2Sees;
    // ...and the new owner can appoint admins (the group is not bricked).
    expect(threads.find((t) => t.conversationId === conversationId)?.ownerId).toBe('a2');
    const roleAck = await new Promise<chat.SetGroupRoleAck>((res) =>
      c2.emit(chat.C2S.setGroupRole, { conversationId, accountId: 'a3', role: 'admin' }, res),
    );
    expect(roleAck.ok).toBe(true);
  });
});
