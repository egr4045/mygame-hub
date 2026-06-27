/**
 * Fake adapters for the ports in `@mygame/shared-types`. These let any service run in its
 * `dev:standalone` / contract-test mode with zero real infrastructure — controllable time,
 * an in-process bus, and a logger that captures lines for assertions.
 */
import type { Clock, EventBus, Logger } from '@mygame/shared-types';

export interface FakeClock extends Clock {
  /** Move time forward by `ms`. */
  advance(ms: number): void;
  /** Set absolute time. */
  set(ms: number): void;
}

export const createFakeClock = (startMs = 0): FakeClock => {
  let t = startMs;
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
    set: (ms) => {
      t = ms;
    },
  };
};

export interface CapturingLogger extends Logger {
  readonly lines: ReadonlyArray<{ level: string; msg: string; fields?: Record<string, unknown> }>;
}

export const createCapturingLogger = (
  base: Record<string, unknown> = {},
): CapturingLogger => {
  const lines: { level: string; msg: string; fields?: Record<string, unknown> }[] = [];
  const log = (level: string) => (msg: string, fields?: Record<string, unknown>) =>
    lines.push({ level, msg, ...(fields ? { fields: { ...base, ...fields } } : { fields: base }) });
  const logger: CapturingLogger = {
    lines,
    debug: log('debug'),
    info: log('info'),
    warn: log('warn'),
    error: log('error'),
    child: (bindings) => createCapturingLogger({ ...base, ...bindings }),
  };
  return logger;
};

/** Synchronous in-process bus — good enough for isolation tests. */
export const createMemoryBus = (): EventBus => {
  const handlers = new Map<string, Set<(m: unknown) => void>>();
  return {
    publish: (topic, message) => {
      handlers.get(topic)?.forEach((h) => h(message));
    },
    subscribe: (topic, handler) => {
      const set = handlers.get(topic) ?? new Set();
      set.add(handler as (m: unknown) => void);
      handlers.set(topic, set);
      return () => set.delete(handler as (m: unknown) => void);
    },
  };
};
