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
  const auth = createAuthCore({ secret: 's', issuer: 'gamehub', accessTtl: '15m', refreshTtl: '30d' });
  server = createApp({
    clock: createFakeClock(1000),
    logger: createCapturingLogger(),
    auth,
    store: createMemoryCommunityStore(),
    // Fakes the real Postgres-backed is_admin check (createAdminCheck) — no database needed to test
    // the route logic itself.
    isAdmin: async (accountId) => adminIds.includes(accountId),
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

const put = (base: string, path: string, body: unknown, token?: string) =>
  fetch(base + path, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });

const del = (base: string, path: string, token?: string) =>
  fetch(base + path, { method: 'DELETE', headers: token ? { authorization: `Bearer ${token}` } : {} });

const patch = (base: string, path: string, body: unknown, token?: string) =>
  fetch(base + path, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });

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

describe('community app — changelog moderation (admin)', () => {
  it('lets an admin edit a published entry', async () => {
    const { base, auth } = await start();
    const adminToken = await auth.signAccess(ADMIN, 'Admin');
    const entry = await json<ChangelogEntry>(
      await post(base, '/community/changelog', { gameId: 'civa', version: '1.0.0', title: 'First', body: 'a' }, adminToken),
    );

    const res = await put(base, `/community/changelog/${entry.id}`, { title: 'Fixed title' }, adminToken);
    expect(res.status).toBe(200);
    expect((await json<ChangelogEntry>(res)).title).toBe('Fixed title');

    const list = await json<{ entries: ChangelogEntry[] }>(await get(base, '/community/changelog/civa'));
    expect(list.entries[0]!.title).toBe('Fixed title');
  });

  it('404s editing an unknown entry, 403s a non-admin edit', async () => {
    const { base, auth } = await start();
    const adminToken = await auth.signAccess(ADMIN, 'Admin');
    const playerToken = await auth.signAccess('random-player', 'Random');
    expect((await put(base, '/community/changelog/nope', { title: 'X' }, adminToken)).status).toBe(404);
    expect((await put(base, '/community/changelog/nope', { title: 'X' }, playerToken)).status).toBe(403);
  });

  it('lets an admin delete an entry, removing it from the public list', async () => {
    const { base, auth } = await start();
    const adminToken = await auth.signAccess(ADMIN, 'Admin');
    const entry = await json<ChangelogEntry>(
      await post(base, '/community/changelog', { gameId: 'civa', version: '1.0.0', title: 'First', body: 'a' }, adminToken),
    );

    const res = await del(base, `/community/changelog/${entry.id}`, adminToken);
    expect(res.status).toBe(200);

    const list = await json<{ entries: ChangelogEntry[] }>(await get(base, '/community/changelog/civa'));
    expect(list.entries).toHaveLength(0);
  });

  it('404s deleting an unknown entry, 403s a non-admin delete', async () => {
    const { base, auth } = await start();
    const adminToken = await auth.signAccess(ADMIN, 'Admin');
    const playerToken = await auth.signAccess('random-player', 'Random');
    expect((await del(base, '/community/changelog/nope', adminToken)).status).toBe(404);
    expect((await del(base, '/community/changelog/nope', playerToken)).status).toBe(403);
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

describe('community app — discussion moderation (admin)', () => {
  it('lets an admin soft-delete a thread, removing it from the public list and detail view', async () => {
    const { base, auth } = await start();
    const adminToken = await auth.signAccess(ADMIN, 'Admin');
    const token = await auth.signAccess('player-1', 'Mara');
    const thread = await json<DiscussionThread>(
      await post(base, '/community/threads', { gameId: 'civa', title: 'Help', body: 'First' }, token),
    );

    const res = await del(base, `/community/threads/${thread.id}`, adminToken);
    expect(res.status).toBe(200);

    expect((await json<{ threads: DiscussionThread[] }>(await get(base, '/community/threads/civa'))).threads).toHaveLength(0);
    expect((await get(base, `/community/threads/civa/${thread.id}`)).status).toBe(404);
  });

  it('404s deleting an unknown/already-deleted thread, 403s a non-admin delete', async () => {
    const { base, auth } = await start();
    const adminToken = await auth.signAccess(ADMIN, 'Admin');
    const token = await auth.signAccess('player-1', 'Mara');
    const thread = await json<DiscussionThread>(
      await post(base, '/community/threads', { gameId: 'civa', title: 'Help', body: 'First' }, token),
    );
    expect((await del(base, `/community/threads/${thread.id}`, token)).status).toBe(403);
    expect((await del(base, `/community/threads/${thread.id}`, adminToken)).status).toBe(200);
    expect((await del(base, `/community/threads/${thread.id}`, adminToken)).status).toBe(404);
    expect((await del(base, '/community/threads/nope', adminToken)).status).toBe(404);
  });

  it('lets an admin soft-delete a reply post, decrementing replyCount and removing it from thread detail', async () => {
    const { base, auth } = await start();
    const adminToken = await auth.signAccess(ADMIN, 'Admin');
    const author = await auth.signAccess('player-1', 'Mara');
    const replier = await auth.signAccess('player-2', 'S1mple');
    const thread = await json<DiscussionThread>(
      await post(base, '/community/threads', { gameId: 'civa', title: 'Help', body: 'First post' }, author),
    );
    const reply = await json<{ id: string }>(await post(base, '/community/posts', { threadId: thread.id, body: 'Try this' }, replier));

    const res = await del(base, `/community/posts/${reply.id}`, adminToken);
    expect(res.status).toBe(200);

    const detail = await json<{ thread: DiscussionThread; posts: DiscussionPost[] }>(
      await get(base, `/community/threads/civa/${thread.id}`),
    );
    expect(detail.thread.replyCount).toBe(0);
    expect(detail.posts.map((p) => p.body)).toEqual(['First post']);
  });

  it('404s deleting an unknown post, 403s a non-admin delete', async () => {
    const { base, auth } = await start();
    const adminToken = await auth.signAccess(ADMIN, 'Admin');
    const token = await auth.signAccess('player-1', 'Mara');
    expect((await del(base, '/community/posts/nope', token)).status).toBe(403);
    expect((await del(base, '/community/posts/nope', adminToken)).status).toBe(404);
  });
});

describe('community app — platform settings', () => {
  it('reads an empty settings map with no auth', async () => {
    const { base } = await start();
    const res = await get(base, '/community/admin/settings');
    expect(res.status).toBe(200);
    expect((await json<{ settings: Record<string, string> }>(res)).settings).toEqual({});
  });

  it('lets an admin set a known key, publicly readable afterwards', async () => {
    const { base, auth } = await start();
    const adminToken = await auth.signAccess(ADMIN, 'Admin');

    const res = await put(base, '/community/admin/settings', { key: 'brand_name', value: 'GAMEHUB' }, adminToken);
    expect(res.status).toBe(200);

    const settings = (await json<{ settings: Record<string, string> }>(await get(base, '/community/admin/settings'))).settings;
    expect(settings.brand_name).toBe('GAMEHUB');
  });

  it('403s a non-admin write, 401s with no token, 400s an unknown key', async () => {
    const { base, auth } = await start();
    const adminToken = await auth.signAccess(ADMIN, 'Admin');
    const token = await auth.signAccess('player-1', 'Mara');
    expect((await put(base, '/community/admin/settings', { key: 'brand_name', value: 'X' }, token)).status).toBe(403);
    expect((await put(base, '/community/admin/settings', { key: 'brand_name', value: 'X' })).status).toBe(401);
    expect((await put(base, '/community/admin/settings', { key: 'not_a_real_key', value: 'X' }, adminToken)).status).toBe(400);
  });
});

describe('community app — suggestions', () => {
  it('accepts a suggestion from any logged-in user, lists + triages it as admin, notifies once', async () => {
    let notified = 0;
    const auth = createAuthCore({ secret: 's', issuer: 'gamehub', accessTtl: '15m', refreshTtl: '30d' });
    server = createApp({
      clock: createFakeClock(1000),
      logger: createCapturingLogger(),
      auth,
      store: createMemoryCommunityStore(),
      isAdmin: async (id) => id === ADMIN,
      notifySuggestion: () => {
        notified += 1;
      },
    });
    const port = await new Promise<number>((r) => server!.listen(0, () => r((server!.address() as AddressInfo).port)));
    const base = `http://127.0.0.1:${port}`;

    const userToken = await auth.signAccess('user-1', 'Игрок');
    const adminToken = await auth.signAccess(ADMIN, 'Admin');

    // Anonymous can't submit; a logged-in user can, and it fires the notification once.
    expect((await post(base, '/community/suggestions', { body: 'idea' })).status).toBe(401);
    const created = await json<{ id: string; status: string; authorName: string }>(
      await post(base, '/community/suggestions', { body: 'Добавьте тёмную тему' }, userToken),
    );
    expect(created).toMatchObject({ status: 'new', authorName: 'Игрок' });
    expect(notified).toBe(1);

    // Listing is admin-only.
    expect((await get(base, '/community/admin/suggestions')).status).toBe(401);
    expect((await fetch(`${base}/community/admin/suggestions`, { headers: { authorization: `Bearer ${userToken}` } })).status).toBe(403);
    const list = await json<{ suggestions: { id: string; status: string }[] }>(
      await fetch(`${base}/community/admin/suggestions`, { headers: { authorization: `Bearer ${adminToken}` } }),
    );
    expect(list.suggestions).toHaveLength(1);

    // Admin moves the status; a bad status 400s; an unknown id 404s.
    const patched = await json<{ status: string }>(await patch(base, `/community/admin/suggestions/${created.id}`, { status: 'implemented' }, adminToken));
    expect(patched.status).toBe('implemented');
    expect((await patch(base, `/community/admin/suggestions/${created.id}`, { status: 'nope' }, adminToken)).status).toBe(400);
    expect((await patch(base, `/community/admin/suggestions/does-not-exist`, { status: 'accepted' }, adminToken)).status).toBe(404);
  });
});
