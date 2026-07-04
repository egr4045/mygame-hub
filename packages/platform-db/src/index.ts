/**
 * @mygame/platform-db — shared Postgres plumbing for the platform services (auth, social, chat).
 *
 * It provides only infrastructure: a connection pool, the platform schema migration, and an ordered
 * write queue. The concrete store adapters (account / social / invite) live in each service next to
 * their port interfaces — this package never imports service logic (ports & adapters layering).
 *
 * Persistence model: each service keeps its in-memory working set authoritative for *reads* (the hot
 * friends/presence path stays fast and synchronous) and mirrors every *write* to Postgres through the
 * WriteQueue. On boot the service hydrates its memory from Postgres. So a restart no longer loses
 * data, and the realtime path never blocks on the database.
 */
import { Pool } from 'pg';
import type { Logger } from '@mygame/shared-types';

export { Pool };
export type { PoolClient, QueryResult } from 'pg';

/** A pooled Postgres connection from `DATABASE_URL` (e.g. `postgres://civa:civa@localhost:5432/civa`). */
export const createPool = (databaseUrl: string): Pool => new Pool({ connectionString: databaseUrl, max: 10 });

/**
 * The platform schema. Idempotent (`IF NOT EXISTS`), so it is safe to run on every boot. The
 * `accounts` table is shared by auth (authoritative for profile fields) and social (refreshes
 * display names for the friends list).
 */
export const runMigrations = async (pool: Pool): Promise<void> => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS accounts (
      id            TEXT PRIMARY KEY,
      display_name  TEXT NOT NULL,
      telegram_id   TEXT UNIQUE,
      vk_id         TEXT UNIQUE,
      avatar_icon   TEXT,
      achievements  JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    -- Profile customization, added after accounts already had real rows — ALTER (not a fresh
    -- CREATE TABLE shape) so existing accounts/friendships/etc. aren't lost, unlike the earlier
    -- messages-table redesign which predated any real data.
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS wallpaper TEXT;
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS title_achievement JSONB;

    CREATE TABLE IF NOT EXISTS friendships (
      lo            TEXT NOT NULL,
      hi            TEXT NOT NULL,
      accepted      BOOLEAN NOT NULL DEFAULT false,
      requested_by  TEXT NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (lo, hi)
    );

    CREATE TABLE IF NOT EXISTS invites (
      code          TEXT PRIMARY KEY,
      game          TEXT NOT NULL,
      game_name     TEXT NOT NULL,
      room          TEXT NOT NULL,
      role          TEXT NOT NULL,
      inviter       TEXT NOT NULL,
      inviter_name  TEXT NOT NULL,
      expires_at    BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS invites_expires_at_idx ON invites (expires_at);

    -- Chat: a conversation is either a 2-member 'dm' or a named 'group' (fixed membership for now —
    -- no add/remove member yet, see docs/PLAN.md). Membership carries per-member read state, so a
    -- message has no per-recipient row to update — "read" is "created_at <= my last_read_at".
    CREATE TABLE IF NOT EXISTS conversations (
      id            TEXT PRIMARY KEY,
      type          TEXT NOT NULL, -- 'dm' | 'group'
      name          TEXT,          -- set for groups; null for dm (name is derived client-side)
      created_at    BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversation_members (
      conversation_id  TEXT NOT NULL,
      account_id       TEXT NOT NULL,
      last_read_at     BIGINT NOT NULL,
      PRIMARY KEY (conversation_id, account_id)
    );
    CREATE INDEX IF NOT EXISTS conversation_members_account_idx ON conversation_members (account_id);

    CREATE TABLE IF NOT EXISTS messages (
      id               TEXT PRIMARY KEY,
      conversation_id  TEXT NOT NULL,
      sender_id        TEXT NOT NULL,
      text             TEXT NOT NULL,
      created_at       BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS messages_conversation_idx ON messages (conversation_id, created_at);
  `);
};

/**
 * Ordered, non-blocking write queue. Mutations apply to the in-memory working set synchronously; the
 * durable write is pushed here and runs in submission order, so callers (e.g. socket handlers) never
 * await the database. A failed write is logged, not thrown — the in-memory state stays correct and
 * the next write for that key overwrites it. Call `drain()` on shutdown to flush.
 */
export class WriteQueue {
  private tail: Promise<void> = Promise.resolve();
  constructor(private readonly logger: Logger) {}

  push(label: string, op: () => Promise<unknown>): void {
    this.tail = this.tail.then(() =>
      op().then(
        () => undefined,
        (err: unknown) => this.logger.error('db write failed', { label, err: String(err) }),
      ),
    );
  }

  /** Resolve once every queued write so far has settled. */
  drain(): Promise<void> {
    return this.tail;
  }
}
