import type { Pool } from '@mygame/platform-db';

/**
 * Checks the shared `is_admin` flag on the `accounts` table — the orchestrator doesn't own that
 * table (auth does), so this mirrors it read-only, same query as `services/community/src/adminCheck.ts`.
 * No caching: admin traffic is inherently low-volume, and a cached flag going stale after a
 * promote/demote would be a real correctness bug, not just a performance one.
 *
 * Unlike community's version, this always requires a real `pool` — the orchestrator's admin route
 * is 501 (not configured), never a blanket 403, when there's no Postgres to check against (see
 * `index.ts`, which only calls this when `config.databaseUrl` is set).
 */
export const createAdminCheck = (pool: Pool): ((accountId: string) => Promise<boolean>) => {
  return async (accountId) => {
    const { rows } = await pool.query('SELECT is_admin FROM accounts WHERE id = $1', [accountId]);
    return rows[0]?.is_admin === true;
  };
};
