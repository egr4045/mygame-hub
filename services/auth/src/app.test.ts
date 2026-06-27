import { afterEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createAuthCore } from '@mygame/auth-core';
import type { HandoffResponse, LoginResponse, RefreshResponse } from '@mygame/protocol';
import { createCapturingLogger, createFakeClock } from '@mygame/test-harness';
import { createApp } from './app.js';
import { createMemoryAccountStore } from './store.js';

const json = <T>(res: Response): Promise<T> => res.json() as Promise<T>;

let server: ReturnType<typeof createApp> | undefined;
afterEach(() => server?.close());

const start = async () => {
  const auth = createAuthCore({ secret: 's', issuer: 'civa', accessTtl: '15m', refreshTtl: '30d' });
  server = createApp({
    clock: createFakeClock(0),
    logger: createCapturingLogger(),
    auth,
    accounts: createMemoryAccountStore(),
  });
  const port = await new Promise<number>((r) =>
    server!.listen(0, () => r((server!.address() as AddressInfo).port)),
  );
  return { base: `http://127.0.0.1:${port}`, auth };
};

const post = (base: string, path: string, body: unknown) =>
  fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('auth service', () => {
  it('issues an account + tokens on login', async () => {
    const { base, auth } = await start();
    const res = await post(base, '/auth/login', { displayName: 'Mara' });
    expect(res.status).toBe(200);
    const body = await json<LoginResponse>(res);
    expect(body).toMatchObject({ displayName: 'Mara' });
    expect(body.accountId).toBeTruthy();
    const claims = await auth.verify(body.accessToken);
    expect(claims).toMatchObject({ sub: body.accountId, name: 'Mara', typ: 'access' });
  });

  it('re-claims the same account id (durable identity for reconnect)', async () => {
    const { base } = await start();
    const first = await json<LoginResponse>(await post(base, '/auth/login', { displayName: 'Wei' }));
    const again = await json<LoginResponse>(
      await post(base, '/auth/login', { displayName: 'Wei Updated', accountId: first.accountId }),
    );
    expect(again.accountId).toBe(first.accountId);
    expect(again.displayName).toBe('Wei Updated');
  });

  it('refreshes an access token from a refresh token', async () => {
    const { base } = await start();
    const login = await json<LoginResponse>(await post(base, '/auth/login', { displayName: 'X' }));
    const res = await post(base, '/auth/refresh', { refreshToken: login.refreshToken });
    expect(res.status).toBe(200);
    expect((await json<RefreshResponse>(res)).accessToken).toBeTruthy();
  });

  it('rejects refresh when given an access token', async () => {
    const { base } = await start();
    const login = await json<LoginResponse>(await post(base, '/auth/login', { displayName: 'X' }));
    const res = await post(base, '/auth/refresh', { refreshToken: login.accessToken });
    expect(res.status).toBe(401);
  });

  it('mints a handoff token (typ=handoff) from a refresh token', async () => {
    const { base, auth } = await start();
    const login = await json<LoginResponse>(await post(base, '/auth/login', { displayName: 'Lia' }));
    const res = await post(base, '/auth/handoff', { refreshToken: login.refreshToken });
    expect(res.status).toBe(200);
    const body = await json<HandoffResponse>(res);
    expect(body).toMatchObject({ accountId: login.accountId, displayName: 'Lia' });
    const claims = await auth.verify(body.handoffToken);
    expect(claims).toMatchObject({ sub: login.accountId, name: 'Lia', typ: 'handoff' });
  });

  it('rejects handoff when given an access token', async () => {
    const { base } = await start();
    const login = await json<LoginResponse>(await post(base, '/auth/login', { displayName: 'X' }));
    const res = await post(base, '/auth/handoff', { refreshToken: login.accessToken });
    expect(res.status).toBe(401);
  });

  it('400s an invalid login body', async () => {
    const { base } = await start();
    expect((await post(base, '/auth/login', { displayName: '' })).status).toBe(400);
  });
});
