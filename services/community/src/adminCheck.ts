import type { Pool } from '@mygame/platform-db';

/**
 * Checks the shared `is_admin` flag on the `accounts` table — community doesn't own that table
 * (auth does), so this mirrors it read-only, the same way `social`'s `refreshProfile` reads
 * avatar/title off the same row. No caching: admin traffic is inherently low-volume, and a cached
 * flag going stale after a promote/demote would be a real correctness bug, not just a performance one.
 *
 * A factory (not a bare function taking `pool` directly) so `AppDeps` can hold a plain
 * `(accountId) => Promise<boolean>` port — same shape as `auth`/`store` — keeping `app.ts`'s route
 * logic free of a raw Postgres dependency and trivially fakeable in tests (`services/community/src/app.test.ts`
 * injects a fake `isAdmin` instead of needing a real database just to test a 403).
 */
export const createAdminCheck = (pool: Pool | undefined): ((accountId: string) => Promise<boolean>) => {
  // In-memory mode (no `pool`): no Postgres, no durable admin state — same posture the rest of this
  // service already has without `DATABASE_URL`.
  if (!pool) return async () => false;
  return async (accountId) => {
    const { rows } = await pool.query('SELECT is_admin FROM accounts WHERE id = $1', [accountId]);
    return rows[0]?.is_admin === true;
  };
};
