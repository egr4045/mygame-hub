import { afterEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createAuthCore } from '@mygame/auth-core';
import { createCapturingLogger, createFakeClock } from '@mygame/test-harness';
import { createApp } from './app.js';
import { Orchestrator } from './orchestrator.js';
import type { GameManifest } from './manifest.js';
import type { ActivityProbe, ContainerRuntime, GameStatus } from './ports.js';

const json = <T>(res: Response): Promise<T> => res.json() as Promise<T>;

const game = (over: Partial<GameManifest> = {}): GameManifest => ({
  id: 'civa',
  name: 'CIVA',
  composeDir: '/x',
  composeProject: 'civa',
  activityUrl: 'http://x/metrics',
  idleMs: 10 * 60 * 1000,
  ...over,
});

class FakeRuntime implements ContainerRuntime {
  readonly states = new Map<string, GameStatus>();
  downs = 0;
  async status(g: GameManifest): Promise<GameStatus> {
    return this.states.get(g.id) ?? 'stopped';
  }
  async up(g: GameManifest): Promise<void> {
    this.states.set(g.id, 'running');
  }
  async down(g: GameManifest): Promise<void> {
    this.downs++;
    this.states.set(g.id, 'stopped');
  }
}

const fakeProbe: ActivityProbe = { async players() {
  return 0;
} };

const ADMIN = 'admin-account-id';

let server: ReturnType<typeof createApp> | undefined;
afterEach(() => server?.close());

const start = async (opts: { admin?: boolean } = {}) => {
  const runtime = new FakeRuntime();
  const orch = new Orchestrator([game()], { runtime, probe: fakeProbe, clock: createFakeClock(0), logger: createCapturingLogger() });
  const auth = createAuthCore({ secret: 's', issuer: 'gamehub', accessTtl: '15m', refreshTtl: '30d' });
  server = createApp({
    orch,
    logger: createCapturingLogger(),
    auth,
    // Fakes the real Postgres-backed is_admin check — no database needed to test route logic.
    // `admin: false` simulates no DATABASE_URL configured (isAdmin undefined -> route 501s).
    isAdmin: opts.admin === false ? undefined : async (id) => id === ADMIN,
  });
  const port = await new Promise<number>((r) => server!.listen(0, () => r((server!.address() as AddressInfo).port)));
  return { base: `http://127.0.0.1:${port}`, auth, runtime };
};

const post = (base: string, path: string, token?: string) =>
  fetch(base + path, { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {} });

const get = (base: string, path: string) => fetch(base + path);

describe('orchestrator app — public routes (unchanged)', () => {
  it('lists games with no auth', async () => {
    const { base } = await start();
    const res = await get(base, '/games');
    expect(res.status).toBe(200);
    const { games } = await json<{ games: { id: string; status: string }[] }>(res);
    expect(games).toEqual([{ id: 'civa', name: 'CIVA', status: 'stopped', players: 0 }]);
  });

  it('enters (wakes) a game with no auth', async () => {
    const { base, runtime } = await start();
    const res = await post(base, '/games/civa/enter');
    expect(res.status).toBe(200);
    expect(runtime.states.get('civa')).toBe('running');
  });

  it('404s entering an unknown game', async () => {
    const { base } = await start();
    expect((await post(base, '/games/nope/enter')).status).toBe(404);
  });
});

describe('orchestrator app — admin force-stop', () => {
  it('501s when no Postgres is configured (isAdmin undefined)', async () => {
    const { base } = await start({ admin: false });
    const res = await post(base, '/games/civa/stop');
    expect(res.status).toBe(501);
  });

  it('401s with no token, 403s a non-admin token', async () => {
    const { base, auth } = await start();
    expect((await post(base, '/games/civa/stop')).status).toBe(401);
    const playerToken = await auth.signAccess('random-player', 'Random');
    expect((await post(base, '/games/civa/stop', playerToken)).status).toBe(403);
  });

  it('404s stopping an unknown game (admin token)', async () => {
    const { base, auth } = await start();
    const adminToken = await auth.signAccess(ADMIN, 'Admin');
    expect((await post(base, '/games/nope/stop', adminToken)).status).toBe(404);
  });

  it('force-stops a running game immediately, bypassing the idle timer', async () => {
    const { base, auth, runtime } = await start();
    const adminToken = await auth.signAccess(ADMIN, 'Admin');
    await post(base, '/games/civa/enter'); // wakes it, well within idleMs
    expect(runtime.states.get('civa')).toBe('running');

    const res = await post(base, '/games/civa/stop', adminToken);
    expect(res.status).toBe(200);
    expect(await json<{ stopped: boolean }>(res)).toEqual({ stopped: true });
    expect(runtime.states.get('civa')).toBe('stopped');
    expect(runtime.downs).toBe(1);
  });

  it('is a no-op on an already-stopped game', async () => {
    const { base, auth, runtime } = await start();
    const adminToken = await auth.signAccess(ADMIN, 'Admin');
    const res = await post(base, '/games/civa/stop', adminToken);
    expect(res.status).toBe(200);
    expect(runtime.downs).toBe(0);
  });
});
