/**
 * In-memory token-bucket rate limiter, keyed per account (or IP). Deliberately not Redis-backed:
 * every service here is a single process, and the point is abuse-damping (spam floods, token-mint
 * loops), not precise global quotas. A bucket starts full (`capacity` = allowed burst) and refills
 * continuously at `refillPerSec`.
 */
export interface RateLimiter {
  /** True = allowed (a token was consumed); false = over the limit right now. */
  take(key: string): boolean;
  dispose(): void;
}

interface Bucket {
  tokens: number;
  last: number; // ms of the last refill
}

export const createLimiter = (capacity: number, refillPerSec: number): RateLimiter => {
  const buckets = new Map<string, Bucket>();

  // A full-and-idle bucket carries no state worth keeping — sweep so one-off keys don't accumulate.
  const idleMs = Math.max(60_000, ((capacity / refillPerSec) * 1000) | 0);
  const sweep = setInterval(() => {
    const cutoff = Date.now() - idleMs;
    for (const [key, b] of buckets) if (b.last < cutoff) buckets.delete(key);
  }, idleMs);
  sweep.unref?.();

  return {
    take(key) {
      const now = Date.now();
      const b = buckets.get(key) ?? { tokens: capacity, last: now };
      b.tokens = Math.min(capacity, b.tokens + ((now - b.last) / 1000) * refillPerSec);
      b.last = now;
      if (b.tokens < 1) {
        buckets.set(key, b);
        return false;
      }
      b.tokens -= 1;
      buckets.set(key, b);
      return true;
    },
    dispose() {
      clearInterval(sweep);
    },
  };
};
