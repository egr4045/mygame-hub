import { describe, expect, it } from 'vitest';
import { createMemorySocialStore } from './store.js';

const statusOf = (store: ReturnType<typeof createMemorySocialStore>, account: string, other: string) =>
  store.friendsOf(account).find((f) => f.accountId === other)?.status;

describe('social store — friendship graph', () => {
  it('a request shows as outgoing for the sender and incoming for the target', () => {
    const s = createMemorySocialStore();
    s.request('a', 'b');
    expect(statusOf(s, 'a', 'b')).toBe('outgoing');
    expect(statusOf(s, 'b', 'a')).toBe('incoming');
  });

  it('accepting an incoming request makes both sides accepted', () => {
    const s = createMemorySocialStore();
    s.request('a', 'b');
    s.accept('b', 'a');
    expect(statusOf(s, 'a', 'b')).toBe('accepted');
    expect(statusOf(s, 'b', 'a')).toBe('accepted');
  });

  it('a reverse request auto-accepts (both asked each other)', () => {
    const s = createMemorySocialStore();
    s.request('a', 'b');
    s.request('b', 'a');
    expect(statusOf(s, 'a', 'b')).toBe('accepted');
  });

  it('cannot accept your own outgoing request', () => {
    const s = createMemorySocialStore();
    s.request('a', 'b');
    s.accept('a', 'b'); // a is the requester, not the target
    expect(statusOf(s, 'a', 'b')).toBe('outgoing');
  });

  it('decline drops an incoming request; cancel drops an outgoing one', () => {
    const s = createMemorySocialStore();
    s.request('a', 'b');
    s.decline('b', 'a'); // target declines
    expect(statusOf(s, 'a', 'b')).toBeUndefined();
    s.request('a', 'b');
    s.decline('a', 'b'); // sender cancels
    expect(statusOf(s, 'b', 'a')).toBeUndefined();
  });

  it('remove deletes an accepted friendship from both sides', () => {
    const s = createMemorySocialStore();
    s.request('a', 'b');
    s.accept('b', 'a');
    s.remove('a', 'b');
    expect(s.friendsOf('a')).toHaveLength(0);
    expect(s.friendsOf('b')).toHaveLength(0);
  });

  it('ignores self-requests and resolves account display names', () => {
    const s = createMemorySocialStore();
    s.request('a', 'a');
    expect(s.friendsOf('a')).toHaveLength(0);
    s.upsertAccount('a', 'Mara');
    expect(s.getAccount('a')?.displayName).toBe('Mara');
    s.upsertAccount('a', 'Mara II');
    expect(s.getAccount('a')?.displayName).toBe('Mara II');
  });
});

describe('social store — profile mirroring', () => {
  it('a new account starts with no avatar/title', () => {
    const s = createMemorySocialStore();
    s.upsertAccount('a', 'Mara');
    expect(s.getAccount('a')).toMatchObject({ avatarIcon: null, titleAchievement: null });
  });

  it('updateProfile merges avatar/title into an existing account', () => {
    const s = createMemorySocialStore();
    s.upsertAccount('a', 'Mara');
    s.updateProfile('a', { avatarIcon: 'data:image/png;base64,abc', titleAchievement: { gameId: 'civa', achievementId: 'veteran' } });
    expect(s.getAccount('a')).toMatchObject({
      avatarIcon: 'data:image/png;base64,abc',
      titleAchievement: { gameId: 'civa', achievementId: 'veteran' },
    });
  });

  it('updateProfile is a no-op for an account that has never connected', () => {
    const s = createMemorySocialStore();
    expect(() => s.updateProfile('ghost', { avatarIcon: 'x', titleAchievement: null })).not.toThrow();
    expect(s.getAccount('ghost')).toBeUndefined();
  });

  it('refreshProfile is a safe no-op in memory-only mode (nothing to refresh from)', async () => {
    const s = createMemorySocialStore();
    s.upsertAccount('a', 'Mara');
    await expect(s.refreshProfile('a')).resolves.toBeUndefined();
    expect(s.getAccount('a')).toMatchObject({ avatarIcon: null, titleAchievement: null });
  });
});
