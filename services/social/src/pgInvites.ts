/**
 * Postgres-backed InviteStore — durable join codes. Codes are opaque random capabilities, so they
 * can't be reconstructed through `create()`; this adapter therefore owns its own in-memory cache
 * (loaded from the DB on `init()`) and mirrors writes to Postgres via the WriteQueue. Resolve reads
 * are synchronous (cache); expired codes are dropped from both cache and DB on access.
 */
import { type Pool, WriteQueue } from '@mygame/platform-db';
import type { Logger } from '@mygame/shared-types';
import { makeCode, type InviteRecord, type InviteStore, type InviteStoreOptions } from './invites.js';

export interface PgInviteStore extends InviteStore {
  /** Load non-expired invites from Postgres into the cache. Call once before serving. */
  init(): Promise<void>;
  /** Flush every queued write — call on shutdown so no acknowledged mutation misses Postgres. */
  drain(): Promise<void>;
}

const rowToRecord = (r: Record<string, unknown>): InviteRecord => ({
  code: r.code as string,
  game: r.game as string,
  gameName: r.game_name as string,
  room: r.room as string,
  role: r.role as InviteRecord['role'],
  inviter: r.inviter as string,
  inviterName: r.inviter_name as string,
  expiresAt: Number(r.expires_at),
});

export const createPgInviteStore = (
  pool: Pool,
  logger: Logger,
  opts: InviteStoreOptions = {},
): PgInviteStore => {
  const ttlMs = opts.ttlMs ?? 60 * 60 * 1000;
  const now = opts.now ?? (() => Date.now());
  const queue = new WriteQueue(logger);
  const codes = new Map<string, InviteRecord>();

  return {
    async init() {
      const { rows } = await pool.query(
        `SELECT code, game, game_name, room, role, inviter, inviter_name, expires_at
         FROM invites WHERE expires_at > $1`,
        [now()],
      );
      for (const r of rows) {
        const rec = rowToRecord(r as Record<string, unknown>);
        codes.set(rec.code, rec);
      }
      logger.info('invites hydrated', { count: rows.length });
    },

    create(input) {
      let code = makeCode();
      while (codes.has(code)) code = makeCode();
      const record: InviteRecord = { ...input, code, expiresAt: now() + ttlMs };
      codes.set(code, record);
      queue.push('invite.create', () =>
        pool.query(
          `INSERT INTO invites (code, game, game_name, room, role, inviter, inviter_name, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            record.code,
            record.game,
            record.gameName,
            record.room,
            record.role,
            record.inviter,
            record.inviterName,
            record.expiresAt,
          ],
        ),
      );
      return record;
    },

    resolve(code) {
      const record = codes.get(code);
      if (!record) return undefined;
      if (record.expiresAt <= now()) {
        codes.delete(code);
        queue.push('invite.expire', () => pool.query(`DELETE FROM invites WHERE code = $1`, [code]));
        return undefined;
      }
      return record;
    },

    drain: () => queue.drain(),
  };
};
