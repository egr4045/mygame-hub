import { describe, expect, it } from 'vitest';
import { createCapturingLogger, createFakeClock, createMemoryBus } from './index.js';

describe('fake clock', () => {
  it('advances and sets time deterministically', () => {
    const clock = createFakeClock(1000);
    expect(clock.now()).toBe(1000);
    clock.advance(500);
    expect(clock.now()).toBe(1500);
    clock.set(0);
    expect(clock.now()).toBe(0);
  });
});

describe('memory bus', () => {
  it('delivers to subscribers and stops after unsubscribe', () => {
    const bus = createMemoryBus();
    const seen: number[] = [];
    const off = bus.subscribe<number>('t', (m) => seen.push(m));
    bus.publish('t', 1);
    off();
    bus.publish('t', 2);
    expect(seen).toEqual([1]);
  });
});

describe('capturing logger', () => {
  it('captures lines and merges child bindings', () => {
    const log = createCapturingLogger({ svc: 'test' });
    log.info('hello', { a: 1 });
    expect(log.lines[0]).toMatchObject({ level: 'info', msg: 'hello', fields: { svc: 'test', a: 1 } });
  });
});
