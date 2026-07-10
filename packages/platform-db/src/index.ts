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
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS favorite_game_ids JSONB NOT NULL DEFAULT '[]'::jsonb;
    -- The platform's one privileged tier (apps/admin). A bare boolean, not a role enum -- exactly one
    -- tier was ever asked for; widen into a real role column later if a second tier is ever needed.
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;

    CREATE TABLE IF NOT EXISTS friendships (
      lo            TEXT NOT NULL,
      hi            TEXT NOT NULL,
      accepted      BOOLEAN NOT NULL DEFAULT false,
      requested_by  TEXT NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (lo, hi)
    );

    -- Directed: only the blocker can remove their own block. Does not touch the friendships table --
    -- blocking hides presence/activity and rejects new requests without deleting the underlying
    -- friend edge, so unblocking silently restores visibility with no re-friending step.
    CREATE TABLE IF NOT EXISTS blocks (
      blocker       TEXT NOT NULL,
      blocked       TEXT NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (blocker, blocked)
    );
    CREATE INDEX IF NOT EXISTS blocks_blocked_idx ON blocks (blocked);

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

    -- Chat: a conversation is either a 2-member 'dm' or a named 'group' with mutable membership.
    -- Membership carries per-member read state, so a message has no per-recipient row to update —
    -- "read" is "created_at <= my last_read_at".
    CREATE TABLE IF NOT EXISTS conversations (
      id            TEXT PRIMARY KEY,
      type          TEXT NOT NULL, -- 'dm' | 'group'
      name          TEXT,          -- set for groups; null for dm (name is derived client-side)
      created_at    BIGINT NOT NULL
    );
    -- group only: the creator, who alone may remove *other* members. Null for dm.
    ALTER TABLE conversations ADD COLUMN IF NOT EXISTS owner_id TEXT;

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

    -- Playtime per (account, game), owned by auth. last_played_at is written on game launch;
    -- seconds_played accrues from in-game SDK heartbeats, clamped server-side so a gap or closed
    -- tab never over-credits (last_heartbeat_at is the window anchor).
    CREATE TABLE IF NOT EXISTS game_stats (
      account_id        TEXT NOT NULL,
      game_id           TEXT NOT NULL,
      seconds_played    BIGINT NOT NULL DEFAULT 0,
      last_played_at    BIGINT,
      last_heartbeat_at BIGINT,
      PRIMARY KEY (account_id, game_id)
    );
    CREATE INDEX IF NOT EXISTS game_stats_account_idx ON game_stats (account_id);

    -- Community: per-game changelog (curated — see @mygame/community's admin allowlist).
    CREATE TABLE IF NOT EXISTS changelog (
      id            TEXT PRIMARY KEY,
      game_id       TEXT NOT NULL,
      version       TEXT NOT NULL,
      title         TEXT NOT NULL,
      body          TEXT NOT NULL,
      published_at  BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS changelog_game_idx ON changelog (game_id, published_at DESC);

    -- Community: per-game discussion forum. Any logged-in account may start a thread or reply (same
    -- trust model as chat); author_name is denormalized at write time (community has no cross-service
    -- account lookup), mirroring chat's senderName.
    CREATE TABLE IF NOT EXISTS discussion_threads (
      id            TEXT PRIMARY KEY,
      game_id       TEXT NOT NULL,
      author_id     TEXT NOT NULL,
      author_name   TEXT NOT NULL,
      title         TEXT NOT NULL,
      created_at    BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS discussion_threads_game_idx ON discussion_threads (game_id, created_at DESC);
    -- Admin moderation (apps/admin) soft-deletes rather than hard-deletes UGC — worth being able to
    -- see "removed by admin" during an investigation rather than content silently vanishing.
    ALTER TABLE discussion_threads ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

    CREATE TABLE IF NOT EXISTS discussion_posts (
      id            TEXT PRIMARY KEY,
      thread_id     TEXT NOT NULL,
      author_id     TEXT NOT NULL,
      author_name   TEXT NOT NULL,
      body          TEXT NOT NULL,
      created_at    BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS discussion_posts_thread_idx ON discussion_posts (thread_id, created_at ASC);
    ALTER TABLE discussion_posts ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

    -- Small fixed set of admin-editable platform settings (apps/admin) — a key-value table so adding a
    -- new known key never needs a schema migration.
    CREATE TABLE IF NOT EXISTS platform_settings (
      key           TEXT PRIMARY KEY,
      value         TEXT NOT NULL,
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
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
