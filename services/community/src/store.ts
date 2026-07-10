import { randomUUID } from 'node:crypto';

/**
 * Community store port: per-game changelog + discussion forum. In-memory adapter for standalone/dev
 * and tests; a Postgres adapter (`pgStore.ts`) swaps in for durable history without touching the
 * service logic (ports & adapters, same shape as chat/social).
 */
export interface ChangelogEntry {
  id: string;
  gameId: string;
  version: string;
  title: string;
  body: string;
  publishedAt: number;
}

export interface NewChangelogEntry {
  gameId: string;
  version: string;
  title: string;
  body: string;
}

export interface DiscussionThreadRow {
  id: string;
  gameId: string;
  authorId: string;
  authorName: string;
  title: string;
  createdAt: number;
  /** Soft-delete (admin moderation) — null unless removed. Deleted rows keep their data (no audit
   *  viewer yet, see docs/STATUS.md's backlog) but are filtered out of every public-facing read. */
  deletedAt: number | null;
}

export interface DiscussionPostRow {
  id: string;
  threadId: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: number;
  /** Soft-delete (admin moderation) — null unless removed. See `DiscussionThreadRow.deletedAt`. */
  deletedAt: number | null;
}

/** A thread with its derived reply stats — what the wire protocol's `discussionThread` carries. */
export interface DiscussionThreadView extends DiscussionThreadRow {
  replyCount: number;
  lastReplyAt: number;
}

/** Fields an admin may amend on an already-published entry (never its id/gameId/publishedAt). */
export interface ChangelogPatch {
  version?: string | undefined;
  title?: string | undefined;
  body?: string | undefined;
}

export interface CommunityStore {
  /** Newest-first entries for a game. */
  listChangelog(gameId: string): ChangelogEntry[];
  addChangelog(entry: NewChangelogEntry): ChangelogEntry;
  /** `undefined` if `id` doesn't exist. Admin-authored content — a mistake is just corrected here. */
  updateChangelog(id: string, patch: ChangelogPatch): ChangelogEntry | undefined;
  /** Hard delete (admin-authored, no investigation value in keeping a removed entry around). */
  deleteChangelog(id: string): boolean;

  /** Newest-thread-first, with reply stats resolved. Excludes soft-deleted threads. */
  listThreads(gameId: string): DiscussionThreadView[];
  /** `undefined` if missing OR soft-deleted. */
  getThread(threadId: string): DiscussionThreadView | undefined;
  /** Oldest-first posts (the thread's own first post included). Excludes soft-deleted posts. */
  postsOf(threadId: string): DiscussionPostRow[];
  /** Creates the thread and seeds it with a first post (the thread's `body`). */
  createThread(gameId: string, authorId: string, authorName: string, title: string, body: string): {
    thread: DiscussionThreadRow;
    firstPost: DiscussionPostRow;
  };
  /** `null` if `threadId` doesn't exist. */
  createPost(threadId: string, authorId: string, authorName: string, body: string): DiscussionPostRow | null;
  /** Soft-delete (moderation). `false` if `threadId` doesn't exist or is already deleted. */
  deleteThread(threadId: string): boolean;
  /** Soft-delete (moderation). `false` if `postId` doesn't exist or is already deleted. */
  deletePost(postId: string): boolean;

  /** Bulk-load previously persisted rows verbatim (ids/timestamps preserved). Hydration only. */
  hydrate(data: {
    changelog: ChangelogEntry[];
    threads: DiscussionThreadRow[];
    posts: DiscussionPostRow[];
    settings?: Record<string, string>;
  }): void;

  /** Small fixed set of platform branding/contact settings (apps/admin) — a key-value map so a new
   *  known key never needs a schema migration. Missing keys are simply absent, not empty strings. */
  getSettings(): Record<string, string>;
  setSetting(key: string, value: string): void;
}

export interface CommunityStoreOptions {
  /** Injectable clock for tests. */
  now?: () => number;
}

export const createMemoryCommunityStore = (opts: CommunityStoreOptions = {}): CommunityStore => {
  const now = opts.now ?? (() => Date.now());
  const changelog: ChangelogEntry[] = [];
  const threads = new Map<string, DiscussionThreadRow>();
  const posts = new Map<string, DiscussionPostRow[]>(); // threadId -> posts, oldest first
  const settings = new Map<string, string>();

  const viewOf = (thread: DiscussionThreadRow): DiscussionThreadView => {
    const arr = (posts.get(thread.id) ?? []).filter((p) => p.deletedAt === null);
    const last = arr[arr.length - 1];
    return { ...thread, replyCount: Math.max(0, arr.length - 1), lastReplyAt: last?.createdAt ?? thread.createdAt };
  };

  return {
    listChangelog: (gameId) =>
      changelog.filter((e) => e.gameId === gameId).sort((a, b) => b.publishedAt - a.publishedAt),

    addChangelog(entry) {
      const full: ChangelogEntry = { ...entry, id: randomUUID(), publishedAt: now() };
      changelog.push(full);
      return full;
    },

    updateChangelog(id, patch) {
      const entry = changelog.find((e) => e.id === id);
      if (!entry) return undefined;
      if (patch.version !== undefined) entry.version = patch.version;
      if (patch.title !== undefined) entry.title = patch.title;
      if (patch.body !== undefined) entry.body = patch.body;
      return entry;
    },

    deleteChangelog(id) {
      const idx = changelog.findIndex((e) => e.id === id);
      if (idx === -1) return false;
      changelog.splice(idx, 1);
      return true;
    },

    listThreads: (gameId) =>
      [...threads.values()]
        .filter((t) => t.gameId === gameId && t.deletedAt === null)
        .map(viewOf)
        .sort((a, b) => b.createdAt - a.createdAt),

    getThread: (threadId) => {
      const t = threads.get(threadId);
      return t && t.deletedAt === null ? viewOf(t) : undefined;
    },

    postsOf: (threadId) => (posts.get(threadId) ?? []).filter((p) => p.deletedAt === null),

    createThread(gameId, authorId, authorName, title, body) {
      const t = now();
      const thread: DiscussionThreadRow = {
        id: randomUUID(),
        gameId,
        authorId,
        authorName,
        title,
        createdAt: t,
        deletedAt: null,
      };
      const firstPost: DiscussionPostRow = {
        id: randomUUID(),
        threadId: thread.id,
        authorId,
        authorName,
        body,
        createdAt: t,
        deletedAt: null,
      };
      threads.set(thread.id, thread);
      posts.set(thread.id, [firstPost]);
      return { thread, firstPost };
    },

    createPost(threadId, authorId, authorName, body) {
      if (!threads.has(threadId)) return null;
      const post: DiscussionPostRow = {
        id: randomUUID(),
        threadId,
        authorId,
        authorName,
        body,
        createdAt: now(),
        deletedAt: null,
      };
      const arr = posts.get(threadId) ?? [];
      arr.push(post);
      posts.set(threadId, arr);
      return post;
    },

    deleteThread(threadId) {
      const t = threads.get(threadId);
      if (!t || t.deletedAt !== null) return false;
      t.deletedAt = now();
      return true;
    },

    deletePost(postId) {
      for (const arr of posts.values()) {
        const post = arr.find((p) => p.id === postId);
        if (post) {
          if (post.deletedAt !== null) return false;
          post.deletedAt = now();
          return true;
        }
      }
      return false;
    },

    hydrate(data) {
      changelog.push(...data.changelog);
      for (const t of data.threads) threads.set(t.id, t);
      for (const p of data.posts) {
        const arr = posts.get(p.threadId) ?? [];
        arr.push(p);
        posts.set(p.threadId, arr);
      }
      for (const [k, v] of Object.entries(data.settings ?? {})) settings.set(k, v);
    },

    getSettings: () => Object.fromEntries(settings),
    setSetting: (key, value) => {
      settings.set(key, value);
    },
  };
};
