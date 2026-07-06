/**
 * Game-stats store port: playtime + last-played per (account, game). Kept separate from the account
 * store so the identity row stays lean. In-memory adapter for standalone/dev and tests; a Postgres
 * adapter (`pgStatsStore.ts`) swaps in for durability without touching the service logic.
 *
 * Playtime accrues from `heartbeat` calls the SDK emits from inside a running game. Each heartbeat
 * credits the elapsed time since the previous one, but clamped to `MAX_HEARTBEAT_GAP_MS` — so a
 * missed beat, a backgrounded tab, or a crash can never credit more than one interval's worth. The
 * client is never trusted with a duration; the server derives it from its own clock.
 */

/** Max time a single heartbeat may credit (ms). 2× the SDK's ~30s interval, absorbing one dropped beat. */
export const MAX_HEARTBEAT_GAP_MS = 60_000;

/** Internal row (carries `lastHeartbeatAt`, which the wire shape drops). */
export interface GameStatRow {
  gameId: string;
  secondsPlayed: number;
  lastPlayedAt: number | null;
  lastHeartbeatAt: number | null;
}

export interface GameStatsStore {
  /** Stamp a game launch: sets `lastPlayedAt` and (re)opens the heartbeat window to now. */
  recordEnter(accountId: string, gameId: string): GameStatRow;
  /** Credit clamped elapsed time since the last beat/enter and reopen the window. First beat credits 0. */
  heartbeat(accountId: string, gameId: string): GameStatRow;
  /** All per-game rows for an account (empty if none). */
  statsFor(accountId: string): GameStatRow[];
  /** Bulk-load persisted rows verbatim (hydration only). */
  hydrate(rows: (GameStatRow & { accountId: string })[]): void;
}

export interface GameStatsStoreOptions {
  /** Injectable clock for tests. */
  now?: () => number;
}

export const createMemoryGameStatsStore = (opts: GameStatsStoreOptions = {}): GameStatsStore => {
  const now = opts.now ?? (() => Date.now());
  const byAccount = new Map<string, Map<string, GameStatRow>>();

  const rowOf = (accountId: string, gameId: string): GameStatRow => {
    const games = byAccount.get(accountId) ?? new Map<string, GameStatRow>();
    byAccount.set(accountId, games);
    const existing = games.get(gameId);
    if (existing) return existing;
    const fresh: GameStatRow = { gameId, secondsPlayed: 0, lastPlayedAt: null, lastHeartbeatAt: null };
    games.set(gameId, fresh);
    return fresh;
  };

  return {
    recordEnter(accountId, gameId) {
      const t = now();
      const row = rowOf(accountId, gameId);
      row.lastPlayedAt = t;
      row.lastHeartbeatAt = t;
      return { ...row };
    },

    heartbeat(accountId, gameId) {
      const t = now();
      const row = rowOf(accountId, gameId);
      if (row.lastHeartbeatAt !== null) {
        const deltaMs = t - row.lastHeartbeatAt;
        if (deltaMs > 0) {
          row.secondsPlayed += Math.round(Math.min(deltaMs, MAX_HEARTBEAT_GAP_MS) / 1000);
        }
      }
      row.lastHeartbeatAt = t;
      return { ...row };
    },

    statsFor(accountId) {
      const games = byAccount.get(accountId);
      return games ? [...games.values()].map((r) => ({ ...r })) : [];
    },

    hydrate(rows) {
      for (const r of rows) {
        const games = byAccount.get(r.accountId) ?? new Map<string, GameStatRow>();
        games.set(r.gameId, {
          gameId: r.gameId,
          secondsPlayed: r.secondsPlayed,
          lastPlayedAt: r.lastPlayedAt,
          lastHeartbeatAt: r.lastHeartbeatAt,
        });
        byAccount.set(r.accountId, games);
      }
    },
  };
};
