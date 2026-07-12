/**
 * Postgres-backed GameStatsStore. Like the account adapter: the canonical accumulation/clamp logic
 * stays in `createMemoryGameStatsStore` (reads are synchronous), and every mutation is mirrored to
 * Postgres via the WriteQueue. `init()` hydrates memory from the DB on boot so playtime survives a
 * restart.
 */
import { type Pool, WriteQueue } from '@mygame/platform-db';
import type { Logger } from '@mygame/shared-types';
import { createMemoryGameStatsStore, type GameStatRow, type GameStatsStore } from './statsStore.js';

export interface PgGameStatsStore extends GameStatsStore {
  /** Load all rows from Postgres into the in-memory working set. Call once before serving. */
  init(): Promise<void>;
  /** Flush every queued write — call on shutdown so no acknowledged mutation misses Postgres. */
  drain(): Promise<void>;
}

export const createPgGameStatsStore = (pool: Pool, logger: Logger): PgGameStatsStore => {
  const mem = createMemoryGameStatsStore();
  const queue = new WriteQueue(logger);

  const persist = (accountId: string, row: GameStatRow): void =>
    queue.push('game_stats.upsert', () =>
      pool.query(
        `INSERT INTO game_stats (account_id, game_id, seconds_played, last_played_at, last_heartbeat_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (account_id, game_id) DO UPDATE SET
           seconds_played    = EXCLUDED.seconds_played,
           last_played_at    = EXCLUDED.last_played_at,
           last_heartbeat_at = EXCLUDED.last_heartbeat_at`,
        [accountId, row.gameId, row.secondsPlayed, row.lastPlayedAt, row.lastHeartbeatAt],
      ),
    );

  return {
    async init() {
      const { rows } = await pool.query(
        `SELECT account_id, game_id, seconds_played, last_played_at, last_heartbeat_at FROM game_stats`,
      );
      mem.hydrate(
        rows.map((r) => ({
          accountId: r.account_id as string,
          gameId: r.game_id as string,
          secondsPlayed: Number(r.seconds_played),
          lastPlayedAt: r.last_played_at === null ? null : Number(r.last_played_at),
          lastHeartbeatAt: r.last_heartbeat_at === null ? null : Number(r.last_heartbeat_at),
        })),
      );
      logger.info('game stats hydrated', { count: rows.length });
    },

    recordEnter(accountId, gameId) {
      const row = mem.recordEnter(accountId, gameId);
      persist(accountId, row);
      return row;
    },

    heartbeat(accountId, gameId) {
      const row = mem.heartbeat(accountId, gameId);
      persist(accountId, row);
      return row;
    },

    statsFor: (accountId) => mem.statsFor(accountId),
    hydrate: (rows) => mem.hydrate(rows),
    drain: () => queue.drain(),
  };
};
