import { afterEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { io as ioc, type Socket as ClientSocket } from 'socket.io-client';
import { createAuthCore } from '@mygame/auth-core';
import { social, type Invite } from '@mygame/protocol';
import { createCapturingLogger } from '@mygame/test-harness';
import { createSocialServer, type SocialServer } from './server.js';
import { createMemorySocialStore } from './store.js';
import { createMemoryInviteStore } from './invites.js';

const auth = createAuthCore({ secret: 's', issuer: 'civa', accessTtl: '15m', refreshTtl: '30d' });

let server: SocialServer | undefined;
const clients: ClientSocket[] = [];

afterEach(() => {
  clients.splice(0).forEach((c) => c.close());
  server?.io.close();
  server?.httpServer.close();
  server = undefined;
});

const startServer = (store = createMemorySocialStore()): Promise<number> => {
  server = createSocialServer({
    auth,
    store,
    invites: createMemoryInviteStore(),
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
    const err = new Promise<{ code: string }>((res) => c1.once(social.S2C.error, res));
    c1.emit(social.C2S.request, { code: 'a1' });
    expect((await err).code).toBe('validation');
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
    const c1 = ioc(`http://127.0.0.1:${port}`, { auth: { token }, transports: ['websocket'], forceNew: true });
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
