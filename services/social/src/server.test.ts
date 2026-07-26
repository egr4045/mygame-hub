import { afterEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { io as ioc, type Socket as ClientSocket } from 'socket.io-client';
import { createAuthCore } from '@mygame/auth-core';
import { social, type Invite } from '@mygame/protocol';
import { createCapturingLogger } from '@mygame/test-harness';
import { createSocialServer, type SocialServer } from './server.js';
import { createMemorySocialStore } from './store.js';
import { createMemoryInviteStore } from './invites.js';

const auth = createAuthCore({ secret: 's', issuer: 'gamehub', accessTtl: '15m', refreshTtl: '30d' });

let server: SocialServer | undefined;
const clients: ClientSocket[] = [];

afterEach(() => {
  readsSeen.clear();
  clients.splice(0).forEach((c) => c.close());
  server?.io.close();
  server?.httpServer.close();
  server = undefined;
});

const startServer = (
  store = createMemorySocialStore(),
  extra: Partial<Parameters<typeof createSocialServer>[0]> = {},
): Promise<number> => {
  server = createSocialServer({
    auth,
    store,
    invites: createMemoryInviteStore(),
    logger: createCapturingLogger(),
    corsOrigin: '*',
    ...extra,
  });
  return new Promise((r) =>
    server!.httpServer.listen(0, () => r((server!.httpServer.address() as AddressInfo).port)),
  );
};

/** In-memory stand-in for the pg read-marker store (services/social/src/pgReads.ts). */
const memoryReads = () => {
  const byAccount = new Map<string, Set<string>>();
  return {
    store: {
      list: (accountId: string) => Promise.resolve([...(byAccount.get(accountId) ?? [])]),
      mark: (accountId: string, keys: string[]) => {
        const set = byAccount.get(accountId) ?? new Set<string>();
        for (const k of keys) set.add(k);
        byAccount.set(accountId, set);
        return Promise.resolve();
      },
    },
    seed: (accountId: string, keys: string[]) => byAccount.set(accountId, new Set(keys)),
  };
};

/** Read-key pushes seen per socket. Recorded from socket creation, because the connect-time push can
 *  land before a test gets a chance to attach its own listener. */
const readsSeen = new Map<ClientSocket, string[][]>();

const waitReads = (c: ClientSocket, predicate: (keys: string[]) => boolean) =>
  new Promise<string[]>((res) => {
    const already = (readsSeen.get(c) ?? []).find(predicate);
    if (already) {
      res(already);
      return;
    }
    const h = (p: social.NotificationsReadEvent) => {
      if (predicate(p.keys)) {
        c.off(social.S2C.notificationsRead, h);
        res(p.keys);
      }
    };
    c.on(social.S2C.notificationsRead, h);
  });

const connect = async (port: number, accountId: string, name: string): Promise<ClientSocket> => {
  const token = await auth.signAccess(accountId, name);
  const c = ioc(`http://127.0.0.1:${port}`, { path: '/social.io/', auth: { token }, transports: ['websocket'], forceNew: true });
  clients.push(c);
  readsSeen.set(c, []);
  c.on(social.S2C.notificationsRead, (p: social.NotificationsReadEvent) => readsSeen.get(c)?.push(p.keys));
  await new Promise<void>((res) => c.once('connect', () => res()));
  return c;
};

/** Resolve on the next social.friends whose list matches the predicate. */
const waitFriends = (c: ClientSocket, predicate: (f: social.Friend[]) => boolean) =>
  new Promise<social.Friend[]>((res) => {
    const h = (p: social.FriendsEvent) => {
      if (predicate(p.friends)) {
        c.off(social.S2C.friends, h);
        res(p.friends);
      }
    };
    c.on(social.S2C.friends, h);
  });

const find = (list: social.Friend[], id: string) => list.find((f) => f.accountId === id);

describe('social server — friends + presence', () => {
  it('delivers an incoming request, accepts it, and reflects presence', async () => {
    const port = await startServer();
    const c1 = await connect(port, 'a1', 'Mara');
    const c2 = await connect(port, 'a2', 'Wei');

    // a1 adds a2 by code (= a2's accountId). a2 should see an incoming request from an online a1.
    const incoming = waitFriends(c2, (f) => find(f, 'a1')?.status === 'incoming');
    c1.emit(social.C2S.request, { code: 'a2' });
    const list2 = await incoming;
    expect(find(list2, 'a1')).toMatchObject({ status: 'incoming', presence: 'online', displayName: 'Mara' });

    // a2 accepts -> both sides become accepted.
    const accepted1 = waitFriends(c1, (f) => find(f, 'a2')?.status === 'accepted');
    c2.emit(social.C2S.accept, { accountId: 'a1' });
    const list1 = await accepted1;
    expect(find(list1, 'a2')).toMatchObject({ status: 'accepted', presence: 'online', displayName: 'Wei' });
  });

  it('propagates a friend going offline', async () => {
    const port = await startServer();
    const c1 = await connect(port, 'a1', 'Mara');
    const c2 = await connect(port, 'a2', 'Wei');
    c1.emit(social.C2S.request, { code: 'a2' });
    await waitFriends(c2, (f) => find(f, 'a1')?.status === 'incoming');
    c2.emit(social.C2S.accept, { accountId: 'a1' });
    await waitFriends(c1, (f) => find(f, 'a2')?.status === 'accepted');

    const offline = waitFriends(c1, (f) => find(f, 'a2')?.presence === 'offline');
    c2.close();
    expect(find(await offline, 'a2')?.presence).toBe('offline');
  });

  it('shares a friend\'s activity (what they are playing)', async () => {
    const port = await startServer();
    const c1 = await connect(port, 'a1', 'Mara');
    const c2 = await connect(port, 'a2', 'Wei');
    c1.emit(social.C2S.request, { code: 'a2' });
    await waitFriends(c2, (f) => find(f, 'a1')?.status === 'incoming');
    c2.emit(social.C2S.accept, { accountId: 'a1' });
    await waitFriends(c1, (f) => find(f, 'a2')?.status === 'accepted');

    const sawActivity = waitFriends(c2, (f) => find(f, 'a1')?.activity?.game === 'civa');
    c1.emit(social.C2S.setActivity, {
      activity: { game: 'civa', gameName: 'CIVA', room: 'room-7', joinable: true },
    });
    const list = await sawActivity;
    expect(find(list, 'a1')?.activity).toMatchObject({ gameName: 'CIVA', room: 'room-7', joinable: true });
  });

  it('rejects friending yourself', async () => {
    const port = await startServer();
    const c1 = await connect(port, 'a1', 'Mara');
    // With no resolver (memory/dev) the code IS the accountId — requesting your own id acks an error.
    const ack = await new Promise<social.RequestAck>((res) => c1.emit(social.C2S.request, { code: 'a1' }, res));
    expect(ack.error).toBeTruthy();
  });

  it('mints a join code (ack) that resolves over HTTP to the room + role', async () => {
    const port = await startServer();
    const c1 = await connect(port, 'a1', 'Mara');
    const code = await new Promise<string>((res) =>
      c1.emit(
        social.C2S.createInvite,
        { game: 'civa', gameName: 'CIVA', room: 'room-7', role: 'player' },
        (ack: social.CreateInviteAck) => res(ack.code),
      ),
    );
    expect(code).toBeTruthy();
    const resolved = (await fetch(`http://127.0.0.1:${port}/invite/${code}`).then((r) => r.json())) as {
      invite: Invite;
    };
    expect(resolved.invite).toMatchObject({ game: 'civa', room: 'room-7', role: 'player', inviterName: 'Mara' });
  });

  it('pushes an invite to an accepted friend', async () => {
    const port = await startServer();
    const c1 = await connect(port, 'a1', 'Mara');
    const c2 = await connect(port, 'a2', 'Wei');
    c1.emit(social.C2S.request, { code: 'a2' });
    await waitFriends(c2, (f) => find(f, 'a1')?.status === 'incoming');
    c2.emit(social.C2S.accept, { accountId: 'a1' });
    await waitFriends(c1, (f) => find(f, 'a2')?.status === 'accepted');

    const pushed = new Promise<social.InviteEvent>((res) => c2.once(social.S2C.invite, res));
    c1.emit(social.C2S.inviteFriend, {
      accountId: 'a2',
      game: 'civa',
      gameName: 'CIVA',
      room: 'room-9',
      role: 'spectator',
    });
    const { invite } = await pushed;
    expect(invite).toMatchObject({ room: 'room-9', role: 'spectator', inviterName: 'Mara' });
  });

  it('refuses to invite a non-friend', async () => {
    const port = await startServer();
    const c1 = await connect(port, 'a1', 'Mara');
    await connect(port, 'a2', 'Wei');
    const err = new Promise<{ code: string }>((res) => c1.once(social.S2C.error, res));
    c1.emit(social.C2S.inviteFriend, { accountId: 'a2', game: 'civa', gameName: 'CIVA', room: 'r', role: 'player' });
    expect((await err).code).toBe('forbidden');
  });
});

describe('social server — profile fields', () => {
  it('surfaces avatarIcon/titleAchievement on me and to friends', async () => {
    // Simulate what a Postgres-backed store's refreshProfile would already have populated.
    const store = createMemorySocialStore();
    store.upsertAccount('a1', 'Mara');
    store.updateProfile('a1', {
      avatarIcon: 'data:image/png;base64,abc',
      titleAchievement: { gameId: 'civa', achievementId: 'veteran' },
    });
    const port = await startServer(store);

    // Register the `me` listener before the connect handshake completes -- the server pushes it
    // the instant it accepts the connection (a one-shot event, not a queryable state), so awaiting
    // `connect()` first (which itself waits on the client 'connect' event) risks missing it.
    const token = await auth.signAccess('a1', 'Mara');
    const c1 = ioc(`http://127.0.0.1:${port}`, { path: '/social.io/', auth: { token }, transports: ['websocket'], forceNew: true });
    clients.push(c1);
    const me = new Promise<social.MeEvent>((res) => c1.once(social.S2C.me, res));
    await new Promise<void>((res) => c1.once('connect', () => res()));
    expect(await me).toMatchObject({
      avatarIcon: 'data:image/png;base64,abc',
      titleAchievement: { gameId: 'civa', achievementId: 'veteran' },
    });

    const c2 = await connect(port, 'a2', 'Wei');
    const incoming = waitFriends(c2, (f) => find(f, 'a1')?.status === 'incoming');
    c1.emit(social.C2S.request, { code: 'a2' });
    const list = await incoming;
    expect(find(list, 'a1')).toMatchObject({
      avatarIcon: 'data:image/png;base64,abc',
      titleAchievement: { gameId: 'civa', achievementId: 'veteran' },
    });
  });

  it('a friend with no profile set shows null avatar/title, not a crash', async () => {
    const port = await startServer();
    const c1 = await connect(port, 'a1', 'Mara');
    const c2 = await connect(port, 'a2', 'Wei');
    const incoming = waitFriends(c2, (f) => find(f, 'a1')?.status === 'incoming');
    c1.emit(social.C2S.request, { code: 'a2' });
    const list = await incoming;
    expect(find(list, 'a1')).toMatchObject({ avatarIcon: null, titleAchievement: null });
  });
});


describe('social server — blocking', () => {
  const block = (c: ClientSocket, accountId: string) =>
    new Promise<social.BlockAck>((res) => c.emit(social.C2S.block, { accountId }, res));
  const unblock = (c: ClientSocket, accountId: string) =>
    new Promise<social.BlockAck>((res) => c.emit(social.C2S.unblock, { accountId }, res));
  const getBlocked = (c: ClientSocket) =>
    new Promise<social.GetBlockedAck>((res) => c.emit(social.C2S.getBlocked, {}, res));

  it('blocking a friend hides presence both ways without deleting the friendship', async () => {
    const port = await startServer();
    const c1 = await connect(port, 'a1', 'Mara');
    const c2 = await connect(port, 'a2', 'Wei');
    c1.emit(social.C2S.request, { code: 'a2' });
    await waitFriends(c2, (f) => find(f, 'a1')?.status === 'incoming');
    c2.emit(social.C2S.accept, { accountId: 'a1' });
    await waitFriends(c1, (f) => find(f, 'a2')?.status === 'accepted');

    // Register both listeners before triggering the block — the refresh pushes both sides in the
    // same handler call, so a listener registered afterward would miss it and hang forever.
    const vanished2 = waitFriends(c2, (f) => find(f, 'a1') === undefined);
    const vanished1 = waitFriends(c1, (f) => find(f, 'a2') === undefined); // a1's own view also drops a2
    const ack = await block(c1, 'a2');
    expect(ack.ok).toBe(true);
    expect(find(await vanished2, 'a1')).toBeUndefined();
    expect(find(await vanished1, 'a2')).toBeUndefined();
  });

  it('unblocking restores visibility with no re-friending step', async () => {
    const port = await startServer();
    const c1 = await connect(port, 'a1', 'Mara');
    const c2 = await connect(port, 'a2', 'Wei');
    c1.emit(social.C2S.request, { code: 'a2' });
    await waitFriends(c2, (f) => find(f, 'a1')?.status === 'incoming');
    c2.emit(social.C2S.accept, { accountId: 'a1' });
    await waitFriends(c1, (f) => find(f, 'a2')?.status === 'accepted');
    await block(c1, 'a2');
    await waitFriends(c2, (f) => find(f, 'a1') === undefined);

    const restored = waitFriends(c2, (f) => find(f, 'a1')?.status === 'accepted');
    await unblock(c1, 'a2');
    expect(find(await restored, 'a1')?.status).toBe('accepted');
  });

  it('a friend request from someone who blocked me is silently ignored', async () => {
    const port = await startServer();
    const c1 = await connect(port, 'a1', 'Mara');
    const c2 = await connect(port, 'a2', 'Wei');
    await block(c2, 'a1'); // a2 blocks a1 before any friendship exists

    let sawError = false;
    let sawIncoming = false;
    c1.once(social.S2C.error, () => { sawError = true; });
    c2.on(social.S2C.friends, (p: social.FriendsEvent) => {
      if (find(p.friends, 'a1')) sawIncoming = true;
    });
    c1.emit(social.C2S.request, { code: 'a2' });
    await new Promise((r) => setTimeout(r, 100)); // give the (non-)event a beat to (not) arrive
    expect(sawError).toBe(false); // no error revealing the block
    expect(sawIncoming).toBe(false); // and no pending request either
  });

  it('getBlocked lists accounts I blocked, not who blocked me', async () => {
    const port = await startServer();
    const c1 = await connect(port, 'a1', 'Mara');
    const c2 = await connect(port, 'a2', 'Wei');
    await block(c1, 'a2');
    expect((await getBlocked(c1)).blocked).toEqual([{ accountId: 'a2', displayName: 'Wei' }]);
    expect((await getBlocked(c2)).blocked).toEqual([]);
  });

  it('searches accounts by name and annotates my relation to each', async () => {
    const search = (c: ClientSocket, query: string): Promise<social.SearchAck> =>
      new Promise((res) => c.emit(social.C2S.search, { query }, (ack: social.SearchAck) => res(ack)));

    const port = await startServer();
    const c1 = await connect(port, 'a1', 'Mara');
    await connect(port, 'a2', 'Wei');

    // A stranger found by name is relation 'none'; my own account is marked 'self'.
    const r1 = await search(c1, 'Wei');
    expect(r1.results.find((r) => r.accountId === 'a2')).toMatchObject({ displayName: 'Wei', relation: 'none' });
    expect((await search(c1, 'Mara')).results.find((r) => r.accountId === 'a1')?.relation).toBe('self');

    // After I request them, the pending edge shows up as 'outgoing'.
    c1.emit(social.C2S.request, { code: 'a2' });
    await new Promise((r) => setTimeout(r, 50));
    expect((await search(c1, 'Wei')).results.find((r) => r.accountId === 'a2')?.relation).toBe('outgoing');
  });

  it('omits blocked accounts from search results', async () => {
    const search = (c: ClientSocket, query: string): Promise<social.SearchAck> =>
      new Promise((res) => c.emit(social.C2S.search, { query }, (ack: social.SearchAck) => res(ack)));

    const port = await startServer();
    const c1 = await connect(port, 'a1', 'Mara');
    await connect(port, 'a2', 'Wei');
    await block(c1, 'a2');
    expect((await search(c1, 'Wei')).results.find((r) => r.accountId === 'a2')).toBeUndefined();
  });
});

describe('social server — notification read-state', () => {
  it('pushes stored read keys on connect', async () => {
    const reads = memoryReads();
    reads.seed('a1', ['friend-req:a2', 'missed:c1:100']);
    const port = await startServer(createMemorySocialStore(), { notificationReads: reads.store });
    const c1 = await connect(port, 'a1', 'Mara');
    const keys = await waitReads(c1, (k) => k.length === 2);
    expect(keys.sort()).toEqual(['friend-req:a2', 'missed:c1:100']);
  });

  it('marking read persists and echoes the full set back', async () => {
    const reads = memoryReads();
    const port = await startServer(createMemorySocialStore(), { notificationReads: reads.store });
    const c1 = await connect(port, 'a1', 'Mara');
    await waitReads(c1, (k) => k.length === 0);

    const echoed = waitReads(c1, (k) => k.includes('invite:XYZ'));
    const ack = await new Promise<social.MarkNotificationsReadAck>((res) =>
      c1.emit(social.C2S.markNotificationsRead, { keys: ['invite:XYZ'] }, res),
    );
    expect(ack.ok).toBe(true);
    expect(await echoed).toEqual(['invite:XYZ']);
    expect(await reads.store.list('a1')).toEqual(['invite:XYZ']);
  });

  it('a mark on one device reaches this account\'s other devices', async () => {
    const reads = memoryReads();
    const port = await startServer(createMemorySocialStore(), { notificationReads: reads.store });
    const phone = await connect(port, 'a1', 'Mara');
    const desktop = await connect(port, 'a1', 'Mara');
    await waitReads(desktop, (k) => k.length === 0);

    // This is the whole point of server-side read-state: the badge must clear on the other device.
    const desktopSees = waitReads(desktop, (k) => k.includes('friend-req:a9'));
    phone.emit(social.C2S.markNotificationsRead, { keys: ['friend-req:a9'] });
    expect(await desktopSees).toEqual(['friend-req:a9']);
  });

  it('read-state is per account — one account cannot mark another\'s', async () => {
    const reads = memoryReads();
    const port = await startServer(createMemorySocialStore(), { notificationReads: reads.store });
    const c1 = await connect(port, 'a1', 'Mara');
    await connect(port, 'a2', 'Wei');
    c1.emit(social.C2S.markNotificationsRead, { keys: ['friend-req:zz'] });
    await new Promise((r) => setTimeout(r, 60));
    expect(await reads.store.list('a1')).toEqual(['friend-req:zz']);
    expect(await reads.store.list('a2')).toEqual([]);
  });

  it('without a read store the mark is refused rather than silently dropped', async () => {
    const port = await startServer(); // no notificationReads (dev/memory mode)
    const c1 = await connect(port, 'a1', 'Mara');
    const ack = await new Promise<social.MarkNotificationsReadAck>((res) =>
      c1.emit(social.C2S.markNotificationsRead, { keys: ['x'] }, res),
    );
    expect(ack.ok).toBe(false);
  });
});
