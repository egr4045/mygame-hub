/**
 * Postgres-backed SocialStore — the durable friendship graph. The canonical graph logic stays in
 * `createMemorySocialStore` (the hot friends/presence path reads it synchronously); every mutation is
 * mirrored to Postgres via the WriteQueue. `init()` replays the stored graph back through the public
 * API on boot, so the in-memory state is reconstructed exactly.
 *
 * The `accounts` table is shared with the auth service; here we only ever touch `display_name` (so a
 * friend's name survives a restart even while they're offline) and never clobber profile fields.
 */
import { type Pool, WriteQueue } from '@mygame/platform-db';
import type { Logger } from '@mygame/shared-types';
import type { TitleAchievementRef } from '@mygame/protocol';
import { createMemorySocialStore, type SocialStore } from './store.js';

export interface PgSocialStore extends SocialStore {
  /** Load accounts + friendships from Postgres into the in-memory graph. Call once before serving. */
  init(): Promise<void>;
  /** Flush every queued write — call on shutdown so no acknowledged mutation misses Postgres. */
  drain(): Promise<void>;
  /** Live ban check against the shared accounts table (auth writes it). Briefly cached. */
  isAccountBanned(accountId: string): Promise<boolean>;
}

const sortPair = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a]);

export const createPgSocialStore = (pool: Pool, logger: Logger): PgSocialStore => {
  const mem = createMemorySocialStore();
  const queue = new WriteQueue(logger);

  const BAN_CACHE_TTL_MS = 30_000;
  const banCache = new Map<string, { banned: boolean; at: number }>();

  /** Persist the current state of the edge between `from` and `to` (or null if it no longer exists). */
  const persistEdge = (from: string, to: string): void => {
    const edge = mem.friendsOf(from).find((f) => f.accountId === to);
    const [lo, hi] = sortPair(from, to);
    if (!edge) {
      queue.push('friendship.delete', () =>
        pool.query(`DELETE FROM friendships WHERE lo = $1 AND hi = $2`, [lo, hi]),
      );
      return;
    }
    const accepted = edge.status === 'accepted';
    // For a pending edge the requester is `from` (outgoing) or `to` (incoming); for an accepted edge
    // the direction is irrelevant to the final state, so any party id is fine.
    const requestedBy = accepted ? lo : edge.status === 'outgoing' ? from : to;
    queue.push('friendship.upsert', () =>
      pool.query(
        `INSERT INTO friendships (lo, hi, accepted, requested_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (lo, hi) DO UPDATE SET accepted = EXCLUDED.accepted, requested_by = EXCLUDED.requested_by`,
        [lo, hi, accepted, requestedBy],
      ),
    );
  };

  const persistAccount = (id: string, displayName: string): void =>
    queue.push('social.account', () =>
      pool.query(
        // password_hash '' satisfies the NOT NULL constraint when this service sees an account
        // before auth ever persisted it (auth's own upsert overwrites with the real hash; the
        // ON CONFLICT branch here never touches it).
        `INSERT INTO accounts (id, display_name, password_hash, updated_at) VALUES ($1, $2, '', now())
         ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = now()`,
        [id, displayName],
      ),
    );

  return {
    async init() {
      const accounts = await pool.query(`SELECT id, display_name, avatar_icon, title_achievement FROM accounts`);
      for (const r of accounts.rows) {
        mem.upsertAccount(r.id as string, r.display_name as string);
        mem.updateProfile(r.id as string, {
          avatarIcon: (r.avatar_icon as string | null) ?? null,
          titleAchievement: (r.title_achievement as TitleAchievementRef | null) ?? null,
        });
      }

      const friendships = await pool.query(
        `SELECT lo, hi, accepted, requested_by FROM friendships`,
      );
      for (const r of friendships.rows) {
        const by = r.requested_by as string;
        const other = by === r.lo ? (r.hi as string) : (r.lo as string);
        mem.request(by, other);
        if (r.accepted) mem.accept(other, by);
      }

      const blocks = await pool.query(`SELECT blocker, blocked FROM blocks`);
      for (const r of blocks.rows) mem.block(r.blocker as string, r.blocked as string);

      logger.info('social graph hydrated', {
        accounts: accounts.rowCount,
        friendships: friendships.rowCount,
        blocks: blocks.rowCount,
      });
    },

    upsertAccount(id, displayName) {
      const a = mem.upsertAccount(id, displayName);
      persistAccount(id, displayName);
      return a;
    },
    getAccount: (id) => mem.getAccount(id),
    // Social never writes avatar/title back — auth owns them. This just mirrors into memory.
    updateProfile: (id, profile) => mem.updateProfile(id, profile),
    async refreshProfile(id) {
      const r = await pool.query(`SELECT avatar_icon, title_achievement FROM accounts WHERE id = $1`, [id]);
      const row = r.rows[0];
      if (!row) return;
      mem.updateProfile(id, {
        avatarIcon: (row.avatar_icon as string | null) ?? null,
        titleAchievement: (row.title_achievement as TitleAchievementRef | null) ?? null,
      });
    },
    request(from, to) {
      mem.request(from, to);
      persistEdge(from, to);
    },
    accept(account, other) {
      mem.accept(account, other);
      persistEdge(account, other);
    },
    decline(account, other) {
      mem.decline(account, other);
      persistEdge(account, other); // now gone -> DELETE
    },
    remove(account, other) {
      mem.remove(account, other);
      persistEdge(account, other); // now gone -> DELETE
    },
    friendsOf: (account) => mem.friendsOf(account),

    block(blocker, blocked) {
      mem.block(blocker, blocked);
      queue.push('block.upsert', () =>
        pool.query(
          `INSERT INTO blocks (blocker, blocked) VALUES ($1, $2) ON CONFLICT (blocker, blocked) DO NOTHING`,
          [blocker, blocked],
        ),
      );
    },
    unblock(blocker, blocked) {
      mem.unblock(blocker, blocked);
      queue.push('block.delete', () =>
        pool.query(`DELETE FROM blocks WHERE blocker = $1 AND blocked = $2`, [blocker, blocked]),
      );
    },
    isBlocked: (a, b) => mem.isBlocked(a, b),
    blockedByMe: (account) => mem.blockedByMe(account),
    drain: () => queue.drain(),

    async isAccountBanned(accountId) {
      const cached = banCache.get(accountId);
      if (cached && Date.now() - cached.at < BAN_CACHE_TTL_MS) return cached.banned;
      try {
        const r = await pool.query(`SELECT is_banned FROM accounts WHERE id = $1`, [accountId]);
        const banned = r.rows[0]?.is_banned === true;
        banCache.set(accountId, { banned, at: Date.now() });
        return banned;
      } catch (err) {
        logger.error('ban check failed', { err: String(err) });
        return false; // availability over enforcement on a db blip
      }
    },
  };
};
