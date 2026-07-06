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
}

export interface DiscussionPostRow {
  id: string;
  threadId: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: number;
}

/** A thread with its derived reply stats — what the wire protocol's `discussionThread` carries. */
export interface DiscussionThreadView extends DiscussionThreadRow {
  replyCount: number;
  lastReplyAt: number;
}

export interface CommunityStore {
  /** Newest-first entries for a game. */
  listChangelog(gameId: string): ChangelogEntry[];
  addChangelog(entry: NewChangelogEntry): ChangelogEntry;

  /** Newest-thread-first, with reply stats resolved. */
  listThreads(gameId: string): DiscussionThreadView[];
  getThread(threadId: string): DiscussionThreadView | undefined;
  /** Oldest-first posts (the thread's own first post included). */
  postsOf(threadId: string): DiscussionPostRow[];
  /** Creates the thread and seeds it with a first post (the thread's `body`). */
  createThread(gameId: string, authorId: string, authorName: string, title: string, body: string): {
    thread: DiscussionThreadRow;
    firstPost: DiscussionPostRow;
  };
  /** `null` if `threadId` doesn't exist. */
  createPost(threadId: string, authorId: string, authorName: string, body: string): DiscussionPostRow | null;

  /** Bulk-load previously persisted rows verbatim (ids/timestamps preserved). Hydration only. */
  hydrate(data: {
    changelog: ChangelogEntry[];
    threads: DiscussionThreadRow[];
    posts: DiscussionPostRow[];
  }): void;
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

  const viewOf = (thread: DiscussionThreadRow): DiscussionThreadView => {
    const arr = posts.get(thread.id) ?? [];
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

    listThreads: (gameId) =>
      [...threads.values()]
        .filter((t) => t.gameId === gameId)
        .map(viewOf)
        .sort((a, b) => b.createdAt - a.createdAt),

    getThread: (threadId) => {
      const t = threads.get(threadId);
      return t ? viewOf(t) : undefined;
    },

    postsOf: (threadId) => posts.get(threadId) ?? [],

    createThread(gameId, authorId, authorName, title, body) {
      const t = now();
      const thread: DiscussionThreadRow = { id: randomUUID(), gameId, authorId, authorName, title, createdAt: t };
      const firstPost: DiscussionPostRow = {
        id: randomUUID(),
        threadId: thread.id,
        authorId,
        authorName,
        body,
        createdAt: t,
      };
      threads.set(thread.id, thread);
      posts.set(thread.id, [firstPost]);
      return { thread, firstPost };
    },

    createPost(threadId, authorId, authorName, body) {
      if (!threads.has(threadId)) return null;
      const post: DiscussionPostRow = { id: randomUUID(), threadId, authorId, authorName, body, createdAt: now() };
      const arr = posts.get(threadId) ?? [];
      arr.push(post);
      posts.set(threadId, arr);
      return post;
    },

    hydrate(data) {
      changelog.push(...data.changelog);
      for (const t of data.threads) threads.set(t.id, t);
      for (const p of data.posts) {
        const arr = posts.get(p.threadId) ?? [];
        arr.push(p);
        posts.set(p.threadId, arr);
      }
    },
  };
};
