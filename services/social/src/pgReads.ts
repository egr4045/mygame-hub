/**
 * Postgres-backed notification read-markers.
 *
 * Only keys live here — the content of every notification kind already has a durable home (friend
 * edges, the chat call-log, `accounts.achievements`, `invites`), so duplicating it would create a
 * second copy that can drift from the truth. Keys are minted by the client from the source row and
 * are stable across devices, which is what lets one device's «прочитано» clear the badge on another.
 *
 * Unlike the friends graph this is NOT mirrored through an in-memory canonical store: reads are
 * per-account, small, and only needed on connect / after a mark, so going straight to Postgres keeps
 * one source of truth. Writes are awaited (not write-behind) because the client's ack is what tells
 * the UI the mark stuck.
 */
import type { Pool } from '@mygame/platform-db';
import type { Logger } from '@mygame/shared-types';
import type { NotificationReadStore } from './server.js';

/** Keep the newest N markers per account. Sources age out (a missed call scrolls off, a request gets
 *  accepted) but their markers would otherwise sit here forever. Generous enough that nothing a user
 *  can still see in the center gets un-read by pruning. */
const KEEP_PER_ACCOUNT = 500;

export const createPgNotificationReadStore = (pool: Pool, logger: Logger): NotificationReadStore => ({
  async list(accountId) {
    const res = await pool.query(`SELECT key FROM notification_reads WHERE account_id = $1`, [accountId]);
    return res.rows.map((r) => (r as { key: string }).key);
  },

  async mark(accountId, keys) {
    if (keys.length === 0) return;
    // De-duplicate in-process: ON CONFLICT can't fire twice for the same row inside one statement
    // ("ON CONFLICT DO UPDATE command cannot affect row a second time").
    const unique = [...new Set(keys)];
    await pool.query(
      `INSERT INTO notification_reads (account_id, key)
       SELECT $1, k FROM unnest($2::text[]) AS k
       ON CONFLICT (account_id, key) DO NOTHING`,
      [accountId, unique],
    );
    // Prune outside the caller's critical path — a failure here must not fail the mark.
    void pool
      .query(
        `DELETE FROM notification_reads
          WHERE account_id = $1
            AND key NOT IN (
              SELECT key FROM notification_reads
               WHERE account_id = $1
               ORDER BY read_at DESC
               LIMIT $2
            )`,
        [accountId, KEEP_PER_ACCOUNT],
      )
      .catch((err: unknown) => logger.error('notificationReads.prune', { accountId, err: String(err) }));
  },
});
