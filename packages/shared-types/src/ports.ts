/**
 * Port interfaces — the swappable abstractions every service depends on instead of concrete
 * infrastructure (the "ports & adapters" rule of the isolation contract). Real adapters
 * (system clock, pino logger, Redis bus) live in services; fakes live in `@mygame/test-harness`.
 */

/** Injectable time source. The simulation and schedulers read time only through this. */
export interface Clock {
  /** Milliseconds since the epoch (or any monotonic origin in tests). */
  now(): number;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Structured logger. `traceId` threads a command through the whole system. */
export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

/** Minimal pub/sub used for in-process (tests) and cross-service (Redis) event fan-out. */
export interface EventBus {
  publish<T>(topic: string, message: T): void | Promise<void>;
  subscribe<T>(topic: string, handler: (message: T) => void): () => void;
}
