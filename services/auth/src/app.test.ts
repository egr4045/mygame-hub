import { afterEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createAuthCore } from '@mygame/auth-core';
import type {
  GrantAchievementResponse,
  AchievementsResponse,
  GameStatsResponse,
  HandoffResponse,
  HeartbeatResponse,
  LoginResponse,
  ProfileResponse,
  RefreshResponse,
} from '@mygame/protocol';
import { createCapturingLogger, createFakeClock } from '@mygame/test-harness';
import { createApp } from './app.js';
import { createMemoryAccountStore } from './store.js';
import { createMemoryGameStatsStore } from './statsStore.js';

const json = <T>(res: Response): Promise<T> => res.json() as Promise<T>;

let server: ReturnType<typeof createApp> | undefined;
afterEach(() => server?.close());

const start = async () => {
  const auth = createAuthCore({ secret: 's', issuer: 'civa', accessTtl: '15m', refreshTtl: '30d' });
  const accounts = createMemoryAccountStore();
  server = createApp({
    clock: createFakeClock(0),
    logger: createCapturingLogger(),
    auth,
    accounts,
    stats: createMemoryGameStatsStore(),
    // Effectively disabled here — the per-IP damping is exercised by its own test below and would
    // otherwise starve suites that register many accounts from one 127.0.0.1.
    credRateLimit: { capacity: 10_000, refillPerSec: 10_000 },
  });
  const port = await new Promise<number>((r) =>
    server!.listen(0, () => r((server!.address() as AddressInfo).port)),
  );
  return { base: `http://127.0.0.1:${port}`, auth, accounts };
};

const post = (base: string, path: string, body: unknown, token?: string) =>
  fetch(base + path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

const get = (base: string, path: string, token?: string) =>
  fetch(base + path, { headers: token ? { authorization: `Bearer ${token}` } : {} });

const put = (base: string, path: string, body: unknown, token?: string) =>
  fetch(base + path, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

const del = (base: string, path: string, body?: unknown, token?: string) =>
  fetch(base + path, {
    method: 'DELETE',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

describe('auth service', () => {
  it('registers a new account and returns tokens', async () => {
    const { base, auth } = await start();
    const res = await post(base, '/auth/register', { displayName: 'Mara', password: 'pw' });
    expect(res.status).toBe(200);
    const body = await json<LoginResponse>(res);
    expect(body).toMatchObject({ displayName: 'Mara' });
    expect(body.accountId).toBeTruthy();
    const claims = await auth.verify(body.accessToken);
    expect(claims).toMatchObject({ sub: body.accountId, name: 'Mara', typ: 'access' });
  });

  it('409s registering a display name that is already taken', async () => {
    const { base } = await start();
    await post(base, '/auth/register', { displayName: 'Mara', password: 'pw' });
    const res = await post(base, '/auth/register', { displayName: 'Mara', password: 'other' });
    expect(res.status).toBe(409);
  });

  it('400s an invalid register body (empty name / missing password)', async () => {
    const { base } = await start();
    expect((await post(base, '/auth/register', { displayName: '', password: 'pw' })).status).toBe(400);
    expect((await post(base, '/auth/register', { displayName: 'Nia' })).status).toBe(400);
  });

  it('logs in with the correct password, returning the same durable account id', async () => {
    const { base } = await start();
    const registered = await json<LoginResponse>(
      await post(base, '/auth/register', { displayName: 'Wei', password: 'secret' }),
    );
    const loggedIn = await json<LoginResponse>(
      await post(base, '/auth/login', { displayName: 'Wei', password: 'secret' }),
    );
    expect(loggedIn.accountId).toBe(registered.accountId);
    expect(loggedIn.displayName).toBe('Wei');
  });

  it('401s a login with the wrong password', async () => {
    const { base } = await start();
    await post(base, '/auth/register', { displayName: 'Zed', password: 'right' });
    const res = await post(base, '/auth/login', { displayName: 'Zed', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  it('401s a login for a display name that was never registered', async () => {
    const { base } = await start();
    const res = await post(base, '/auth/login', { displayName: 'Ghost', password: 'pw' });
    expect(res.status).toBe(401);
  });

  it('400s an invalid login body', async () => {
    const { base } = await start();
    expect((await post(base, '/auth/login', { displayName: '', password: 'pw' })).status).toBe(400);
  });

  it('refreshes an access token from a refresh token', async () => {
    const { base } = await start();
    const login = await json<LoginResponse>(await post(base, '/auth/register', { displayName: 'X', password: 'pw' }));
    const res = await post(base, '/auth/refresh', { refreshToken: login.refreshToken });
    expect(res.status).toBe(200);
    expect((await json<RefreshResponse>(res)).accessToken).toBeTruthy();
  });

  it('rejects refresh when given an access token', async () => {
    const { base } = await start();
    const login = await json<LoginResponse>(await post(base, '/auth/register', { displayName: 'X', password: 'pw' }));
    const res = await post(base, '/auth/refresh', { refreshToken: login.accessToken });
    expect(res.status).toBe(401);
  });

  it('mints a handoff token (typ=handoff) from a refresh token', async () => {
    const { base, auth } = await start();
    const login = await json<LoginResponse>(await post(base, '/auth/register', { displayName: 'Lia', password: 'pw' }));
    const res = await post(base, '/auth/handoff', { refreshToken: login.refreshToken });
    expect(res.status).toBe(200);
    const body = await json<HandoffResponse>(res);
    expect(body).toMatchObject({ accountId: login.accountId, displayName: 'Lia' });
    const claims = await auth.verify(body.handoffToken);
    expect(claims).toMatchObject({ sub: login.accountId, name: 'Lia', typ: 'handoff' });
  });

  it('rejects handoff when given an access token', async () => {
    const { base } = await start();
    const login = await json<LoginResponse>(await post(base, '/auth/register', { displayName: 'X', password: 'pw' }));
    const res = await post(base, '/auth/handoff', { refreshToken: login.accessToken });
    expect(res.status).toBe(401);
  });
});

describe('auth service — bans are enforced, not just displayed', () => {
  const registerAndBan = async () => {
    const ctx = await start();
    const login = await json<LoginResponse>(
      await post(ctx.base, '/auth/register', { displayName: 'Outlaw', password: 'pw' }),
    );
    ctx.accounts.setBanned(login.accountId, true);
    return { ...ctx, login };
  };

  it('403s login for a banned account (correct password)', async () => {
    const { base } = await registerAndBan();
    const res = await post(base, '/auth/login', { displayName: 'Outlaw', password: 'pw' });
    expect(res.status).toBe(403);
    expect(await json<{ code: string }>(res)).toMatchObject({ code: 'forbidden' });
  });

  it('403s refresh for a banned account (bans bite within the access TTL)', async () => {
    const { base, login } = await registerAndBan();
    const res = await post(base, '/auth/refresh', { refreshToken: login.refreshToken });
    expect(res.status).toBe(403);
  });

  it('403s handoff and exchange for a banned account', async () => {
    const { base, login, accounts } = await registerAndBan();
    expect((await post(base, '/auth/handoff', { refreshToken: login.refreshToken })).status).toBe(403);

    // Mint the handoff while unbanned, ban, then try to redeem it.
    accounts.setBanned(login.accountId, false);
    const handoff = await json<HandoffResponse>(await post(base, '/auth/handoff', { refreshToken: login.refreshToken }));
    accounts.setBanned(login.accountId, true);
    expect((await post(base, '/auth/exchange', { handoffToken: handoff.handoffToken })).status).toBe(403);
  });

  it('un-banning restores login', async () => {
    const { base, login, accounts } = await registerAndBan();
    accounts.setBanned(login.accountId, false);
    expect((await post(base, '/auth/login', { displayName: 'Outlaw', password: 'pw' })).status).toBe(200);
  });
});

describe('auth service — credential rate limiting', () => {
  it('429s after the per-IP burst is exhausted', async () => {
    const auth = createAuthCore({ secret: 's', issuer: 'civa', accessTtl: '15m', refreshTtl: '30d' });
    server = createApp({
      clock: createFakeClock(0),
      logger: createCapturingLogger(),
      auth,
      accounts: createMemoryAccountStore(),
      stats: createMemoryGameStatsStore(),
      credRateLimit: { capacity: 3, refillPerSec: 0.0001 },
    });
    const port = await new Promise<number>((r) => server!.listen(0, () => r((server!.address() as AddressInfo).port)));
    const base = `http://127.0.0.1:${port}`;

    for (let i = 0; i < 3; i++) {
      const res = await post(base, '/auth/login', { displayName: `nobody${i}`, password: 'pw' });
      expect(res.status).toBe(401); // wrong creds, but not rate-limited yet
    }
    const res = await post(base, '/auth/login', { displayName: 'nobody', password: 'pw' });
    expect(res.status).toBe(429);
  });
});

describe('auth service — SSO exchange (a game redeeming a hub ?pt= handoff token)', () => {
  it('exchanges a valid handoff token for a full session', async () => {
    const { base, auth } = await start();
    const login = await json<LoginResponse>(await post(base, '/auth/register', { displayName: 'Lia', password: 'pw' }));
    const handoff = await json<HandoffResponse>(await post(base, '/auth/handoff', { refreshToken: login.refreshToken }));

    const res = await post(base, '/auth/exchange', { handoffToken: handoff.handoffToken });
    expect(res.status).toBe(200);
    const session = await json<LoginResponse>(res);
    expect(session).toMatchObject({ accountId: login.accountId, displayName: 'Lia' });
    const claims = await auth.verify(session.accessToken);
    expect(claims).toMatchObject({ sub: login.accountId, typ: 'access' });
  });

  it('401s exchanging an access token (not a handoff token)', async () => {
    const { base } = await start();
    const login = await json<LoginResponse>(await post(base, '/auth/register', { displayName: 'X', password: 'pw' }));
    const res = await post(base, '/auth/exchange', { handoffToken: login.accessToken });
    expect(res.status).toBe(401);
  });

  it("404s exchanging a handoff token for an account that no longer exists", async () => {
    const { base, auth } = await start();
    const ghostToken = await auth.signHandoff('no-such-id', 'Ghost');
    const res = await post(base, '/auth/exchange', { handoffToken: ghostToken });
    expect(res.status).toBe(404);
  });

  it('400s an invalid exchange body', async () => {
    const { base } = await start();
    expect((await post(base, '/auth/exchange', {})).status).toBe(400);
  });
});

describe('auth service — achievements', () => {
  it('grants an achievement and lists it back', async () => {
    const { base } = await start();
    const login = await json<LoginResponse>(await post(base, '/auth/register', { displayName: 'Mara', password: 'pw' }));

    const grantRes = await post(base, '/auth/achievements', { gameId: 'civa', achievementId: 'first_blood' }, login.accessToken);
    expect(grantRes.status).toBe(200);
    const grant = await json<GrantAchievementResponse>(grantRes);
    expect(grant).toMatchObject({ granted: true, achievement: { gameId: 'civa', achievementId: 'first_blood' } });

    const listRes = await get(base, '/auth/achievements', login.accessToken);
    const list = await json<AchievementsResponse>(listRes);
    expect(list.achievements).toEqual([grant.achievement]);
  });

  it('re-granting the same achievement is idempotent', async () => {
    const { base } = await start();
    const login = await json<LoginResponse>(await post(base, '/auth/register', { displayName: 'Mara', password: 'pw' }));
    await post(base, '/auth/achievements', { gameId: 'civa', achievementId: 'first_blood' }, login.accessToken);

    const again = await json<GrantAchievementResponse>(
      await post(base, '/auth/achievements', { gameId: 'civa', achievementId: 'first_blood' }, login.accessToken),
    );
    expect(again.granted).toBe(false);

    const list = await json<AchievementsResponse>(await get(base, '/auth/achievements', login.accessToken));
    expect(list.achievements).toHaveLength(1); // not duplicated
  });

  it('scopes achievements per game — the same id in two games is two achievements', async () => {
    const { base } = await start();
    const login = await json<LoginResponse>(await post(base, '/auth/register', { displayName: 'Mara', password: 'pw' }));
    await post(base, '/auth/achievements', { gameId: 'civa', achievementId: 'first_blood' }, login.accessToken);
    await post(base, '/auth/achievements', { gameId: 'svoyak', achievementId: 'first_blood' }, login.accessToken);

    const list = await json<AchievementsResponse>(await get(base, '/auth/achievements', login.accessToken));
    expect(list.achievements).toHaveLength(2);
  });

  it('rejects an unauthenticated grant/list', async () => {
    const { base } = await start();
    expect((await post(base, '/auth/achievements', { gameId: 'civa', achievementId: 'x' })).status).toBe(401);
    expect((await get(base, '/auth/achievements')).status).toBe(401);
  });
});

describe('auth service — profile', () => {
  it('defaults to an empty profile', async () => {
    const { base } = await start();
    const login = await json<LoginResponse>(await post(base, '/auth/register', { displayName: 'Mara', password: 'pw' }));
    const profile = await json<ProfileResponse>(await get(base, '/auth/profile', login.accessToken));
    expect(profile).toEqual({ avatarIcon: null, wallpaper: null, titleAchievement: null, favoriteGameIds: [] });
  });

  it('sets and persists an avatar and a wallpaper', async () => {
    const { base } = await start();
    const login = await json<LoginResponse>(await post(base, '/auth/register', { displayName: 'Mara', password: 'pw' }));

    const avatarRes = await put(base, '/auth/profile/avatar', { dataUrl: 'data:image/png;base64,AAA' }, login.accessToken);
    expect(avatarRes.status).toBe(200);
    const wallpaperRes = await put(base, '/auth/profile/wallpaper', { dataUrl: 'data:image/png;base64,BBB' }, login.accessToken);
    expect(wallpaperRes.status).toBe(200);

    const profile = await json<ProfileResponse>(await get(base, '/auth/profile', login.accessToken));
    expect(profile).toMatchObject({
      avatarIcon: 'data:image/png;base64,AAA',
      wallpaper: 'data:image/png;base64,BBB',
    });
  });

  it('rejects an oversized avatar payload', async () => {
    const { base } = await start();
    const login = await json<LoginResponse>(await post(base, '/auth/register', { displayName: 'Mara', password: 'pw' }));
    const huge = 'A'.repeat(5_000_000); // over the 4MB raw-body cap for this route
    const res = await put(base, '/auth/profile/avatar', { dataUrl: huge }, login.accessToken);
    expect(res.status).toBe(413);
  });

  it('rejects a title referencing an achievement the account has not unlocked', async () => {
    const { base } = await start();
    const login = await json<LoginResponse>(await post(base, '/auth/register', { displayName: 'Mara', password: 'pw' }));
    const res = await put(
      base,
      '/auth/profile/title',
      { titleAchievement: { gameId: 'civa', achievementId: 'first_blood' } },
      login.accessToken,
    );
    expect(res.status).toBe(400);
  });

  it('accepts a title once the achievement is unlocked, and clears it with null', async () => {
    const { base } = await start();
    const login = await json<LoginResponse>(await post(base, '/auth/register', { displayName: 'Mara', password: 'pw' }));
    await post(base, '/auth/achievements', { gameId: 'civa', achievementId: 'first_blood' }, login.accessToken);

    const setRes = await put(
      base,
      '/auth/profile/title',
      { titleAchievement: { gameId: 'civa', achievementId: 'first_blood' } },
      login.accessToken,
    );
    expect(setRes.status).toBe(200);
    let profile = await json<ProfileResponse>(await get(base, '/auth/profile', login.accessToken));
    expect(profile.titleAchievement).toEqual({ gameId: 'civa', achievementId: 'first_blood' });

    await put(base, '/auth/profile/title', { titleAchievement: null }, login.accessToken);
    profile = await json<ProfileResponse>(await get(base, '/auth/profile', login.accessToken));
    expect(profile.titleAchievement).toBeNull();
  });

  it('rejects unauthenticated profile reads/writes', async () => {
    const { base } = await start();
    expect((await get(base, '/auth/profile')).status).toBe(401);
    expect((await put(base, '/auth/profile/avatar', { dataUrl: 'data:image/png;base64,AAA' })).status).toBe(401);
    expect((await put(base, '/auth/profile/title', { titleAchievement: null })).status).toBe(401);
  });

  it('sets and persists the favorite games list (full replace)', async () => {
    const { base } = await start();
    const login = await json<LoginResponse>(await post(base, '/auth/register', { displayName: 'Mara', password: 'pw' }));

    const res = await put(base, '/auth/profile/favorites', { gameIds: ['civa', 'svoyak'] }, login.accessToken);
    expect(res.status).toBe(200);
    let profile = await json<ProfileResponse>(await get(base, '/auth/profile', login.accessToken));
    expect(profile.favoriteGameIds).toEqual(['civa', 'svoyak']);

    // A second call replaces rather than merges.
    await put(base, '/auth/profile/favorites', { gameIds: ['svoyak'] }, login.accessToken);
    profile = await json<ProfileResponse>(await get(base, '/auth/profile', login.accessToken));
    expect(profile.favoriteGameIds).toEqual(['svoyak']);
  });

  it('rejects unauthenticated favorites writes', async () => {
    const { base } = await start();
    expect((await put(base, '/auth/profile/favorites', { gameIds: ['civa'] })).status).toBe(401);
  });
});

describe('auth service — playtime stats', () => {
  it('records a launch (last_played) and lists per-game stats', async () => {
    const { base } = await start();
    const login = await json<LoginResponse>(await post(base, '/auth/register', { displayName: 'Mara', password: 'pw' }));

    const enterRes = await post(base, '/auth/stats/enter', { gameId: 'civa' }, login.accessToken);
    expect(enterRes.status).toBe(200);

    const stats = await json<GameStatsResponse>(await get(base, '/auth/stats', login.accessToken));
    expect(stats.stats).toHaveLength(1);
    expect(stats.stats[0]).toMatchObject({ gameId: 'civa', secondsPlayed: 0 });
    expect(stats.stats[0]!.lastPlayedAt).toBeGreaterThan(0);
  });

  it('credits ~0 seconds for a heartbeat right after enter (no elapsed time)', async () => {
    const { base } = await start();
    const login = await json<LoginResponse>(await post(base, '/auth/register', { displayName: 'Mara', password: 'pw' }));
    await post(base, '/auth/stats/enter', { gameId: 'civa' }, login.accessToken);

    const beat = await json<HeartbeatResponse>(
      await post(base, '/auth/stats/heartbeat', { gameId: 'civa' }, login.accessToken),
    );
    expect(beat.secondsPlayed).toBe(0);
  });

  it('rejects unauthenticated stats calls', async () => {
    const { base } = await start();
    expect((await post(base, '/auth/stats/enter', { gameId: 'civa' })).status).toBe(401);
    expect((await post(base, '/auth/stats/heartbeat', { gameId: 'civa' })).status).toBe(401);
    expect((await get(base, '/auth/stats')).status).toBe(401);
  });

  it('400s an invalid stats body', async () => {
    const { base } = await start();
    const login = await json<LoginResponse>(await post(base, '/auth/register', { displayName: 'Mara', password: 'pw' }));
    expect((await post(base, '/auth/stats/enter', { gameId: '' }, login.accessToken)).status).toBe(400);
  });
});

describe('auth service — admin', () => {
  it('rejects every admin route for a non-admin account', async () => {
    const { base } = await start();
    const login = await json<LoginResponse>(await post(base, '/auth/register', { displayName: 'Mara', password: 'pw' }));
    expect((await get(base, '/auth/admin/admins', login.accessToken)).status).toBe(403);
    expect((await get(base, '/auth/admin/accounts', login.accessToken)).status).toBe(403);
    expect((await get(base, `/auth/admin/accounts/${login.accountId}`, login.accessToken)).status).toBe(403);
    expect(
      (await put(base, `/auth/admin/accounts/${login.accountId}/role`, { isAdmin: true }, login.accessToken)).status,
    ).toBe(403);
  });

  it('rejects admin routes with no token at all (401, not 403)', async () => {
    const { base } = await start();
    expect((await get(base, '/auth/admin/admins')).status).toBe(401);
  });

  it('an admin can list accounts, search, and paginate', async () => {
    const { base, accounts } = await start();
    const mara = await json<LoginResponse>(await post(base, '/auth/register', { displayName: 'Mara', password: 'pw' }));
    await post(base, '/auth/register', { displayName: 'Zed', password: 'pw' });
    await post(base, '/auth/register', { displayName: 'Wei', password: 'pw' });
    accounts.setAdmin(mara.accountId, true);

    const all = await json<{ accounts: unknown[]; total: number }>(
      await get(base, '/auth/admin/accounts', mara.accessToken),
    );
    expect(all.total).toBe(3);

    const searched = await json<{ accounts: { displayName: string }[]; total: number }>(
      await get(base, '/auth/admin/accounts?q=ze', mara.accessToken),
    );
    expect(searched.total).toBe(1);
    expect(searched.accounts[0]!.displayName).toBe('Zed');

    const paged = await json<{ accounts: unknown[]; total: number }>(
      await get(base, '/auth/admin/accounts?limit=1&offset=1', mara.accessToken),
    );
    expect(paged.accounts).toHaveLength(1);
    expect(paged.total).toBe(3);
  });

  it("an admin can view another account's detail", async () => {
    const { base, accounts } = await start();
    const mara = await json<LoginResponse>(await post(base, '/auth/register', { displayName: 'Mara', password: 'pw' }));
    const zed = await json<LoginResponse>(await post(base, '/auth/register', { displayName: 'Zed', password: 'pw' }));
    accounts.setAdmin(mara.accountId, true);
    await post(base, '/auth/achievements', { gameId: 'civa', achievementId: 'first_blood' }, zed.accessToken);

    const detail = await json<{ id: string; achievements: unknown[] }>(
      await get(base, `/auth/admin/accounts/${zed.accountId}`, mara.accessToken),
    );
    expect(detail.id).toBe(zed.accountId);
    expect(detail.achievements).toHaveLength(1);
  });

  it('404s a detail lookup for an unknown account', async () => {
    const { base, accounts } = await start();
    const mara = await json<LoginResponse>(await post(base, '/auth/register', { displayName: 'Mara', password: 'pw' }));
    accounts.setAdmin(mara.accountId, true);
    expect((await get(base, '/auth/admin/accounts/no-such-id', mara.accessToken)).status).toBe(404);
  });

  it('an admin can promote another account, which then passes requireAdmin itself', async () => {
    const { base, accounts } = await start();
    const mara = await json<LoginResponse>(await post(base, '/auth/register', { displayName: 'Mara', password: 'pw' }));
    const zed = await json<LoginResponse>(await post(base, '/auth/register', { displayName: 'Zed', password: 'pw' }));
    accounts.setAdmin(mara.accountId, true);

    const promoteRes = await put(base, `/auth/admin/accounts/${zed.accountId}/role`, { isAdmin: true }, mara.accessToken);
    expect(promoteRes.status).toBe(200);

    const roster = await json<{ admins: { id: string }[] }>(await get(base, '/auth/admin/admins', zed.accessToken));
    expect(roster.admins.map((a) => a.id).sort()).toEqual([mara.accountId, zed.accountId].sort());
  });

  it('refuses to demote the last remaining admin', async () => {
    const { base, accounts } = await start();
    const mara = await json<LoginResponse>(await post(base, '/auth/register', { displayName: 'Mara', password: 'pw' }));
    accounts.setAdmin(mara.accountId, true);

    const res = await put(base, `/auth/admin/accounts/${mara.accountId}/role`, { isAdmin: false }, mara.accessToken);
    expect(res.status).toBe(400);
    expect(accounts.get(mara.accountId)?.isAdmin).toBe(true);
  });

  it('allows demoting one of several admins', async () => {
    const { base, accounts } = await start();
    const mara = await json<LoginResponse>(await post(base, '/auth/register', { displayName: 'Mara', password: 'pw' }));
    const zed = await json<LoginResponse>(await post(base, '/auth/register', { displayName: 'Zed', password: 'pw' }));
    accounts.setAdmin(mara.accountId, true);
    accounts.setAdmin(zed.accountId, true);

    const res = await put(base, `/auth/admin/accounts/${zed.accountId}/role`, { isAdmin: false }, mara.accessToken);
    expect(res.status).toBe(200);
    expect(accounts.get(zed.accountId)?.isAdmin).toBe(false);
  });

  it('an admin can grant an achievement to another account (support-ticket case)', async () => {
    const { base, accounts } = await start();
    const mara = await json<LoginResponse>(await post(base, '/auth/register', { displayName: 'Mara', password: 'pw' }));
    const zed = await json<LoginResponse>(await post(base, '/auth/register', { displayName: 'Zed', password: 'pw' }));
    accounts.setAdmin(mara.accountId, true);

    const res = await post(
      base,
      `/auth/admin/accounts/${zed.accountId}/achievements`,
      { gameId: 'civa', achievementId: 'first_blood' },
      mara.accessToken,
    );
    expect(res.status).toBe(200);
    expect((await json<{ granted: boolean }>(res)).granted).toBe(true);

    const detail = await json<{ achievements: unknown[] }>(
      await get(base, `/auth/admin/accounts/${zed.accountId}`, mara.accessToken),
    );
    expect(detail.achievements).toHaveLength(1);
  });

  it('403s a non-admin granting an achievement, 404s an unknown target account', async () => {
    const { base, accounts } = await start();
    const mara = await json<LoginResponse>(await post(base, '/auth/register', { displayName: 'Mara', password: 'pw' }));
    const zed = await json<LoginResponse>(await post(base, '/auth/register', { displayName: 'Zed', password: 'pw' }));
    accounts.setAdmin(mara.accountId, true);

    expect(
      (
        await post(base, `/auth/admin/accounts/${mara.accountId}/achievements`, { gameId: 'civa', achievementId: 'x' }, zed.accessToken)
      ).status,
    ).toBe(403);
    expect(
      (
        await post(base, `/auth/admin/accounts/no-such-id/achievements`, { gameId: 'civa', achievementId: 'x' }, mara.accessToken)
      ).status,
    ).toBe(404);
  });

  it('an admin can revoke a previously granted achievement', async () => {
    const { base, accounts } = await start();
    const mara = await json<LoginResponse>(await post(base, '/auth/register', { displayName: 'Mara', password: 'pw' }));
    const zed = await json<LoginResponse>(await post(base, '/auth/register', { displayName: 'Zed', password: 'pw' }));
    accounts.setAdmin(mara.accountId, true);
    await post(base, `/auth/admin/accounts/${zed.accountId}/achievements`, { gameId: 'civa', achievementId: 'first_blood' }, mara.accessToken);

    const res = await del(base, `/auth/admin/accounts/${zed.accountId}/achievements`, { gameId: 'civa', achievementId: 'first_blood' }, mara.accessToken);
    expect(res.status).toBe(200);

    const detail = await json<{ achievements: unknown[] }>(await get(base, `/auth/admin/accounts/${zed.accountId}`, mara.accessToken));
    expect(detail.achievements).toHaveLength(0);
  });

  it('404s revoking an achievement the account never had, 403s a non-admin revoke', async () => {
    const { base, accounts } = await start();
    const mara = await json<LoginResponse>(await post(base, '/auth/register', { displayName: 'Mara', password: 'pw' }));
    const zed = await json<LoginResponse>(await post(base, '/auth/register', { displayName: 'Zed', password: 'pw' }));
    accounts.setAdmin(mara.accountId, true);

    expect(
      (await del(base, `/auth/admin/accounts/${zed.accountId}/achievements`, { gameId: 'civa', achievementId: 'x' }, mara.accessToken)).status,
    ).toBe(404);
    expect(
      (await del(base, `/auth/admin/accounts/${mara.accountId}/achievements`, { gameId: 'civa', achievementId: 'x' }, zed.accessToken)).status,
    ).toBe(403);
  });

  it('an admin can clear another account\'s avatar and wallpaper', async () => {
    const { base, accounts } = await start();
    const mara = await json<LoginResponse>(await post(base, '/auth/register', { displayName: 'Mara', password: 'pw' }));
    const zed = await json<LoginResponse>(await post(base, '/auth/register', { displayName: 'Zed', password: 'pw' }));
    accounts.setAdmin(mara.accountId, true);
    await put(base, '/auth/profile/avatar', { dataUrl: 'data:image/png;base64,AAA' }, zed.accessToken);
    await put(base, '/auth/profile/wallpaper', { dataUrl: 'data:image/png;base64,BBB' }, zed.accessToken);

    expect((await del(base, `/auth/admin/accounts/${zed.accountId}/avatar`, undefined, mara.accessToken)).status).toBe(200);
    expect((await del(base, `/auth/admin/accounts/${zed.accountId}/wallpaper`, undefined, mara.accessToken)).status).toBe(200);

    const detail = await json<{ avatarIcon: string | null; wallpaper: string | null }>(
      await get(base, `/auth/admin/accounts/${zed.accountId}`, mara.accessToken),
    );
    expect(detail.avatarIcon).toBeNull();
    expect(detail.wallpaper).toBeNull();
  });

  it('404s clearing avatar/wallpaper for an unknown account, 403s a non-admin clear', async () => {
    const { base, accounts } = await start();
    const mara = await json<LoginResponse>(await post(base, '/auth/register', { displayName: 'Mara', password: 'pw' }));
    const zed = await json<LoginResponse>(await post(base, '/auth/register', { displayName: 'Zed', password: 'pw' }));
    accounts.setAdmin(mara.accountId, true);

    expect((await del(base, `/auth/admin/accounts/no-such-id/avatar`, undefined, mara.accessToken)).status).toBe(404);
    expect((await del(base, `/auth/admin/accounts/${mara.accountId}/avatar`, undefined, zed.accessToken)).status).toBe(403);
  });
});
