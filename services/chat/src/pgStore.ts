/**
 * Postgres-backed ChatStore — durable message history. The canonical thread/unread logic stays in
 * `createMemoryChatStore` (reads stay synchronous); every mutation is mirrored to Postgres via the
 * WriteQueue. `init()` replays stored messages back through `hydrate()` on boot, so the in-memory
 * state is reconstructed exactly (ids and timestamps preserved).
 *
 * The `accounts` table is shared with auth/social; here we only ever touch `display_name`.
 */
import { type Pool, WriteQueue } from '@mygame/platform-db';
import type { Logger } from '@mygame/shared-types';
import { createMemoryChatStore, type ChatMessage, type ChatStore } from './store.js';

export interface PgChatStore extends ChatStore {
  /** Load accounts + message history from Postgres into memory. Call once before serving. */
  init(): Promise<void>;
}

export const createPgChatStore = (pool: Pool, logger: Logger): PgChatStore => {
  const mem = createMemoryChatStore();
  const queue = new WriteQueue(logger);

  const persistAccount = (id: string, displayName: string): void =>
    queue.push('chat.account', () =>
      pool.query(
        `INSERT INTO accounts (id, display_name, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = now()`,
        [id, displayName],
      ),
    );

  const persistMessage = (m: ChatMessage): void =>
    queue.push('chat.message', () =>
      pool.query(
        `INSERT INTO messages (id, sender_id, recipient_id, text, created_at, read_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [m.id, m.senderId, m.recipientId, m.text, m.createdAt, m.readAt],
      ),
    );

  const persistRead = (reader: string, otherId: string, upTo: number): void =>
    queue.push('chat.read', () =>
      pool.query(
        `UPDATE messages SET read_at = $1 WHERE recipient_id = $2 AND sender_id = $3 AND read_at IS NULL`,
        [upTo, reader, otherId],
      ),
    );

  return {
    async init() {
      const accounts = await pool.query(`SELECT id, display_name FROM accounts`);
      for (const r of accounts.rows) mem.upsertAccount(r.id as string, r.display_name as string);

      const rows = await pool.query(
        `SELECT id, sender_id, recipient_id, text, created_at, read_at FROM messages ORDER BY created_at ASC`,
      );
      mem.hydrate(
        rows.rows.map((r) => ({
          id: r.id as string,
          senderId: r.sender_id as string,
          recipientId: r.recipient_id as string,
          text: r.text as string,
          createdAt: Number(r.created_at),
          readAt: r.read_at === null ? null : Number(r.read_at),
        })),
      );
      logger.info('chat hydrated', { accounts: accounts.rowCount, messages: rows.rowCount });
    },

    upsertAccount(id, displayName) {
      const a = mem.upsertAccount(id, displayName);
      persistAccount(id, displayName);
      return a;
    },
    getAccount: (id) => mem.getAccount(id),

    send(from, to, text) {
      const m = mem.send(from, to, text);
      persistMessage(m);
      return m;
    },

    markRead(reader, otherId) {
      const result = mem.markRead(reader, otherId);
      if (result) persistRead(reader, otherId, result.upTo);
      return result;
    },

    history: (a, b, limit) => mem.history(a, b, limit),
    threads: (accountId) => mem.threads(accountId),
    hydrate: (messages) => mem.hydrate(messages),
  };
};
