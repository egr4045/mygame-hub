import { describe, expect, it } from 'vitest';
import { createAuthCore, TokenError } from './index.js';

const core = createAuthCore({ secret: 'test-secret', issuer: 'gamehub', accessTtl: '15m', refreshTtl: '30d' });

describe('auth-core', () => {
  it('round-trips an access token and exposes claims', async () => {
    const token = await core.signAccess('acc-1', 'Mara');
    const claims = await core.verify(token);
    expect(claims).toMatchObject({ sub: 'acc-1', name: 'Mara', typ: 'access' });
  });

  it('marks refresh tokens with typ=refresh', async () => {
    const claims = await core.verify(await core.signRefresh('acc-2', 'Wei'));
    expect(claims.typ).toBe('refresh');
  });

  it('marks handoff tokens with typ=handoff and carries identity', async () => {
    const claims = await core.verify(await core.signHandoff('acc-3', 'Lia'));
    expect(claims).toMatchObject({ sub: 'acc-3', name: 'Lia', typ: 'handoff' });
  });

  it('rejects a tampered/invalid token', async () => {
    await expect(core.verify('not.a.jwt')).rejects.toBeInstanceOf(TokenError);
  });

  it('rejects a token signed with a different secret', async () => {
    const other = createAuthCore({ secret: 'other', issuer: 'gamehub', accessTtl: '15m', refreshTtl: '30d' });
    const token = await other.signAccess('x', 'y');
    await expect(core.verify(token)).rejects.toMatchObject({ reason: 'invalid' });
  });
});
