import { describe, expect, it } from 'vitest';
import { createMemoryGameStatsStore, MAX_HEARTBEAT_GAP_MS } from './statsStore.js';

/** A controllable clock so playtime accrual is deterministic (no wall-clock flake). */
const fakeClock = (start = 0) => {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
};

describe('game stats store — playtime accrual + clamp', () => {
  it('credits real elapsed time between heartbeats', () => {
    const clock = fakeClock(0);
    const store = createMemoryGameStatsStore({ now: clock.now });

    store.recordEnter('acc', 'civa'); // opens the window at t=0
    clock.advance(30_000); // 30s later
    expect(store.heartbeat('acc', 'civa').secondsPlayed).toBe(30);
    clock.advance(45_000); // 45s later (still under the 60s clamp)
    expect(store.heartbeat('acc', 'civa').secondsPlayed).toBe(75);
  });

  it('clamps a large gap (closed/backgrounded tab) to one interval', () => {
    const clock = fakeClock(0);
    const store = createMemoryGameStatsStore({ now: clock.now });

    store.recordEnter('acc', 'civa');
    clock.advance(10 * 60_000); // 10 minutes with no beats
    // Only MAX_HEARTBEAT_GAP_MS worth is credited, not the full 600s.
    expect(store.heartbeat('acc', 'civa').secondsPlayed).toBe(MAX_HEARTBEAT_GAP_MS / 1000);
  });

  it('credits 0 on a first heartbeat with no prior enter', () => {
    const clock = fakeClock(0);
    const store = createMemoryGameStatsStore({ now: clock.now });

    // No recordEnter — the window opens now, so nothing to credit yet.
    expect(store.heartbeat('acc', 'civa').secondsPlayed).toBe(0);
    clock.advance(30_000);
    expect(store.heartbeat('acc', 'civa').secondsPlayed).toBe(30);
  });

  it('never credits a negative delta (clock skew)', () => {
    const clock = fakeClock(100_000);
    const store = createMemoryGameStatsStore({ now: clock.now });
    store.recordEnter('acc', 'civa'); // window at t=100_000
    clock.advance(-50_000); // time went backwards
    expect(store.heartbeat('acc', 'civa').secondsPlayed).toBe(0);
  });

  it('records last-played on enter and keeps stats per game', () => {
    const clock = fakeClock(1234);
    const store = createMemoryGameStatsStore({ now: clock.now });
    store.recordEnter('acc', 'civa');
    store.recordEnter('acc', 'svoyak');

    const stats = store.statsFor('acc');
    expect(stats).toHaveLength(2);
    expect(stats.every((s) => s.lastPlayedAt === 1234)).toBe(true);
    expect(store.statsFor('nobody')).toEqual([]);
  });
});
