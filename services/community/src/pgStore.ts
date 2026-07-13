/**
 * Postgres-backed CommunityStore. Canonical logic stays in `createMemoryCommunityStore` (reads are
 * synchronous, sorted in memory); every write mirrors to Postgres via the WriteQueue. `init()`
 * hydrates memory from the DB on boot, so the changelog + discussions survive a restart.
 */
import { type Pool, WriteQueue } from '@mygame/platform-db';
import type { Logger } from '@mygame/shared-types';
import type { Suggestion } from '@mygame/protocol';
import {
  createMemoryCommunityStore,
  type ChangelogEntry,
  type CommunityStore,
  type DiscussionPostRow,
  type DiscussionThreadRow,
  type NewChangelogEntry,
} from './store.js';

export interface PgCommunityStore extends CommunityStore {
  /** Load all rows from Postgres into the in-memory working set. Call once before serving. */
  init(): Promise<void>;
}

export const createPgCommunityStore = (pool: Pool, logger: Logger): PgCommunityStore => {
  const mem = createMemoryCommunityStore();
  const queue = new WriteQueue(logger);

  const persistChangelog = (e: ChangelogEntry): void =>
    queue.push('changelog.insert', () =>
      pool.query(
        `INSERT INTO changelog (id, game_id, version, title, body, published_at) VALUES ($1, $2, $3, $4, $5, $6)`,
        [e.id, e.gameId, e.version, e.title, e.body, e.publishedAt],
      ),
    );

  const persistThread = (t: DiscussionThreadRow): void =>
    queue.push('discussion_threads.insert', () =>
      pool.query(
        `INSERT INTO discussion_threads (id, game_id, author_id, author_name, title, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
        [t.id, t.gameId, t.authorId, t.authorName, t.title, t.createdAt],
      ),
    );

  const persistPost = (p: DiscussionPostRow): void =>
    queue.push('discussion_posts.insert', () =>
      pool.query(
        `INSERT INTO discussion_posts (id, thread_id, author_id, author_name, body, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
        [p.id, p.threadId, p.authorId, p.authorName, p.body, p.createdAt],
      ),
    );

  return {
    async init() {
      const [changelogRes, threadsRes, postsRes, suggestionsRes, settingsRes] = await Promise.all([
        pool.query(`SELECT id, game_id, version, title, body, published_at FROM changelog`),
        pool.query(`SELECT id, game_id, author_id, author_name, title, created_at, deleted_at FROM discussion_threads`),
        pool.query(
          `SELECT id, thread_id, author_id, author_name, body, created_at, deleted_at FROM discussion_posts ORDER BY created_at ASC`,
        ),
        pool.query(`SELECT id, author_id, author_name, body, status, created_at, updated_at FROM suggestions`),
        pool.query(`SELECT key, value FROM platform_settings`),
      ]);
      mem.hydrate({
        changelog: changelogRes.rows.map((r) => ({
          id: r.id as string,
          gameId: r.game_id as string,
          version: r.version as string,
          title: r.title as string,
          body: r.body as string,
          publishedAt: Number(r.published_at),
        })),
        threads: threadsRes.rows.map((r) => ({
          id: r.id as string,
          gameId: r.game_id as string,
          authorId: r.author_id as string,
          authorName: r.author_name as string,
          title: r.title as string,
          createdAt: Number(r.created_at),
          deletedAt: r.deleted_at ? new Date(r.deleted_at as string | Date).getTime() : null,
        })),
        posts: postsRes.rows.map((r) => ({
          id: r.id as string,
          threadId: r.thread_id as string,
          authorId: r.author_id as string,
          authorName: r.author_name as string,
          body: r.body as string,
          createdAt: Number(r.created_at),
          deletedAt: r.deleted_at ? new Date(r.deleted_at as string | Date).getTime() : null,
        })),
        suggestions: suggestionsRes.rows.map((r) => ({
          id: r.id as string,
          authorId: r.author_id as string,
          authorName: r.author_name as string,
          body: r.body as string,
          status: r.status as Suggestion['status'],
          createdAt: Number(r.created_at),
          updatedAt: Number(r.updated_at),
        })),
        settings: Object.fromEntries(settingsRes.rows.map((r) => [r.key as string, r.value as string])),
      });
      logger.info('community hydrated', {
        changelog: changelogRes.rows.length,
        threads: threadsRes.rows.length,
        posts: postsRes.rows.length,
        suggestions: suggestionsRes.rows.length,
        settings: settingsRes.rows.length,
      });
    },

    listChangelog: (gameId) => mem.listChangelog(gameId),
    addChangelog(entry: NewChangelogEntry) {
      const full = mem.addChangelog(entry);
      persistChangelog(full);
      return full;
    },

    updateChangelog(id, patch) {
      const updated = mem.updateChangelog(id, patch);
      if (!updated) return undefined;
      queue.push('changelog.update', () =>
        pool.query(`UPDATE changelog SET version = $2, title = $3, body = $4 WHERE id = $1`, [
          updated.id,
          updated.version,
          updated.title,
          updated.body,
        ]),
      );
      return updated;
    },

    deleteChangelog(id) {
      const deleted = mem.deleteChangelog(id);
      if (deleted) queue.push('changelog.delete', () => pool.query(`DELETE FROM changelog WHERE id = $1`, [id]));
      return deleted;
    },

    listThreads: (gameId) => mem.listThreads(gameId),
    getThread: (threadId) => mem.getThread(threadId),
    postsOf: (threadId) => mem.postsOf(threadId),

    createThread(gameId, authorId, authorName, title, body) {
      const { thread, firstPost } = mem.createThread(gameId, authorId, authorName, title, body);
      persistThread(thread);
      persistPost(firstPost);
      return { thread, firstPost };
    },

    createPost(threadId, authorId, authorName, body) {
      const post = mem.createPost(threadId, authorId, authorName, body);
      if (post) persistPost(post);
      return post;
    },

    deleteThread(threadId) {
      const deleted = mem.deleteThread(threadId);
      if (deleted) {
        queue.push('discussion_threads.delete', () =>
          pool.query(`UPDATE discussion_threads SET deleted_at = now() WHERE id = $1`, [threadId]),
        );
      }
      return deleted;
    },

    deletePost(postId) {
      const deleted = mem.deletePost(postId);
      if (deleted) {
        queue.push('discussion_posts.delete', () =>
          pool.query(`UPDATE discussion_posts SET deleted_at = now() WHERE id = $1`, [postId]),
        );
      }
      return deleted;
    },

    listSuggestions: () => mem.listSuggestions(),
    createSuggestion(authorId, authorName, body) {
      const s = mem.createSuggestion(authorId, authorName, body);
      queue.push('suggestions.insert', () =>
        pool.query(
          `INSERT INTO suggestions (id, author_id, author_name, body, status, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [s.id, s.authorId, s.authorName, s.body, s.status, s.createdAt, s.updatedAt],
        ),
      );
      return s;
    },
    setSuggestionStatus(id, status) {
      const updated = mem.setSuggestionStatus(id, status);
      if (updated) {
        queue.push('suggestions.update', () =>
          pool.query(`UPDATE suggestions SET status = $2, updated_at = $3 WHERE id = $1`, [updated.id, updated.status, updated.updatedAt]),
        );
      }
      return updated;
    },

    hydrate: (data) => mem.hydrate(data),

    getSettings: () => mem.getSettings(),
    setSetting(key, value) {
      mem.setSetting(key, value);
      queue.push('platform_settings.upsert', () =>
        pool.query(
          `INSERT INTO platform_settings (key, value, updated_at) VALUES ($1, $2, now())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
          [key, value],
        ),
      );
    },
  };
};
