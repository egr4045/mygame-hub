import { afterEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createAuthCore } from '@mygame/auth-core';
import type { ChangelogEntry, DiscussionPost, DiscussionThread } from '@mygame/protocol';
import { createCapturingLogger, createFakeClock } from '@mygame/test-harness';
import { createApp } from './app.js';
import { createMemoryCommunityStore } from './store.js';

const json = <T>(res: Response): Promise<T> => res.json() as Promise<T>;

let server: ReturnType<typeof createApp> | undefined;
afterEach(() => server?.close());

const ADMIN = 'admin-account-id';

const start = async (adminIds: string[] = [ADMIN]) => {
  const auth = createAuthCore({ secret: 's', issuer: 'civa', accessTtl: '15m', refreshTtl: '30d' });
  server = createApp({
    clock: createFakeClock(1000),
    logger: createCapturingLogger(),
    auth,
    store: createMemoryCommunityStore(),
    adminIds,
  });
  const port = await new Promise<number>((r) =>
    server!.listen(0, () => r((server!.address() as AddressInfo).port)),
  );
  return { base: `http://127.0.0.1:${port}`, auth };
};

const post = (base: string, path: string, body: unknown, token?: string) =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });

const get = (base: string, path: string) => fetch(base + path);

describe('community app — changelog', () => {
  it('lists changelog entries newest-first', async () => {
    const { base, auth } = await start();
    const adminToken = await auth.signAccess(ADMIN, 'Admin');

    await post(base, '/community/changelog', { gameId: 'civa', version: '1.0.0', title: 'First', body: 'a' }, adminToken);
    await post(base, '/community/changelog', { gameId: 'civa', version: '1.0.1', title: 'Second', body: 'b' }, adminToken);

    const res = await get(base, '/community/changelog/civa');
    expect(res.status).toBe(200);
    const { entries } = await json<{ entries: ChangelogEntry[] }>(res);
    expect(entries.map((e) => e.title)).toEqual(['Second', 'First']);
  });

  it('returns an empty list for a game with no entries — public, no auth needed', async () => {
    const { base } = await start();
    const res = await get(base, '/community/changelog/unknown-game');
    expect(res.status).toBe(200);
    expect((await json<{ entries: ChangelogEntry[] }>(res)).entries).toEqual([]);
  });

  it('rejects publishing without a token', async () => {
    const { base } = await start();
    const res = await post(base, '/community/changelog', { gameId: 'civa', version: '1.0.0', title: 'X', body: 'x' });
    expect(res.status).toBe(401);
  });

  it('rejects publishing from a non-admin account', async () => {
    const { base, auth } = await start();
    const token = await auth.signAccess('random-player', 'Random');
    const res = await post(base, '/community/changelog', { gameId: 'civa', version: '1.0.0', title: 'X', body: 'x' }, token);
    expect(res.status).toBe(403);
  });

  it('400s an invalid changelog body', async () => {
    const { base, auth } = await start();
    const adminToken = await auth.signAccess(ADMIN, 'Admin');
    const res = await post(base, '/community/changelog', { gameId: '', version: '1.0.0', title: 'X', body: 'x' }, adminToken);
    expect(res.status).toBe(400);
  });

  it('scopes changelog entries per game', async () => {
    const { base, auth } = await start();
    const adminToken = await auth.signAccess(ADMIN, 'Admin');
    await post(base, '/community/changelog', { gameId: 'civa', version: '1.0.0', title: 'Civa patch', body: 'a' }, adminToken);
    await post(base, '/community/changelog', { gameId: 'svoyak', version: '1.0.0', title: 'Svoyak patch', body: 'b' }, adminToken);

    const civa = await json<{ entries: ChangelogEntry[] }>(await get(base, '/community/changelog/civa'));
    expect(civa.entries).toHaveLength(1);
    expect(civa.entries[0]!.title).toBe('Civa patch');
  });
});

describe('community app — discussions', () => {
  it('creates a thread (seeding its first post) and lists it with replyCount 0', async () => {
    const { base, auth } = await start();
    const token = await auth.signAccess('player-1', 'Mara');

    const createRes = await post(base, '/community/threads', { gameId: 'civa', title: 'Help with level 4', body: 'Stuck!' }, token);
    expect(createRes.status).toBe(201);
    const created = await json<DiscussionThread>(createRes);
    expect(created).toMatchObject({ gameId: 'civa', authorId: 'player-1', authorName: 'Mara', replyCount: 0 });

    const list = await json<{ threads: DiscussionThread[] }>(await get(base, '/community/threads/civa'));
    expect(list.threads).toHaveLength(1);
    expect(list.threads[0]!.title).toBe('Help with level 4');
  });

  it('a reply increments replyCount and both posts appear in thread detail, oldest first', async () => {
    const { base, auth } = await start();
    const author = await auth.signAccess('player-1', 'Mara');
    const replier = await auth.signAccess('player-2', 'S1mple');

    const thread = await json<DiscussionThread>(
      await post(base, '/community/threads', { gameId: 'civa', title: 'Help', body: 'First post' }, author),
    );
    await post(base, '/community/posts', { threadId: thread.id, body: 'Try this' }, replier);

    const detail = await json<{ thread: DiscussionThread; posts: DiscussionPost[] }>(
      await get(base, `/community/threads/civa/${thread.id}`),
    );
    expect(detail.thread.replyCount).toBe(1);
    expect(detail.posts.map((p) => p.body)).toEqual(['First post', 'Try this']);
    expect(detail.posts[1]).toMatchObject({ authorId: 'player-2', authorName: 'S1mple' });
  });

  it('404s a reply to a nonexistent thread, and a detail lookup for one', async () => {
    const { base, auth } = await start();
    const token = await auth.signAccess('player-1', 'Mara');
    expect((await post(base, '/community/posts', { threadId: 'nope', body: 'x' }, token)).status).toBe(404);
    expect((await get(base, '/community/threads/civa/nope')).status).toBe(404);
  });

  it('rejects creating a thread or post without a token', async () => {
    const { base } = await start();
    expect((await post(base, '/community/threads', { gameId: 'civa', title: 'X', body: 'x' })).status).toBe(401);
    expect((await post(base, '/community/posts', { threadId: 'x', body: 'x' })).status).toBe(401);
  });

  it('reads (list + detail) require no auth', async () => {
    const { base, auth } = await start();
    const token = await auth.signAccess('player-1', 'Mara');
    const thread = await json<DiscussionThread>(
      await post(base, '/community/threads', { gameId: 'civa', title: 'Help', body: 'First' }, token),
    );
    expect((await get(base, '/community/threads/civa')).status).toBe(200);
    expect((await get(base, `/community/threads/civa/${thread.id}`)).status).toBe(200);
  });

  it('scopes threads per game', async () => {
    const { base, auth } = await start();
    const token = await auth.signAccess('player-1', 'Mara');
    await post(base, '/community/threads', { gameId: 'civa', title: 'Civa thread', body: 'a' }, token);
    await post(base, '/community/threads', { gameId: 'svoyak', title: 'Svoyak thread', body: 'b' }, token);

    const civa = await json<{ threads: DiscussionThread[] }>(await get(base, '/community/threads/civa'));
    expect(civa.threads).toHaveLength(1);
    expect(civa.threads[0]!.title).toBe('Civa thread');
  });

  it('400s an invalid thread/post body', async () => {
    const { base, auth } = await start();
    const token = await auth.signAccess('player-1', 'Mara');
    expect((await post(base, '/community/threads', { gameId: '', title: 'X', body: 'x' }, token)).status).toBe(400);
    expect((await post(base, '/community/posts', { threadId: '', body: 'x' }, token)).status).toBe(400);
  });
});
