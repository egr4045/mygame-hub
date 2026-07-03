import { randomUUID } from 'node:crypto';

/**
 * Chat store port: direct messages between two accounts (no group chat yet). In-memory adapter for
 * standalone/dev and tests; a Postgres adapter (`pgStore.ts`) swaps in for durable history without
 * touching the service logic (ports & adapters). There is no thread id — a thread is identified by
 * the *other* account's id, since it's always exactly two participants.
 */
export interface Account {
  id: string;
  displayName: string;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  recipientId: string;
  text: string;
  createdAt: number;
  readAt: number | null;
}

export interface ChatThread {
  accountId: string;
  displayName: string;
  lastMessage: ChatMessage | null;
  unreadCount: number;
}

export interface ChatStore {
  upsertAccount(id: string, displayName: string): Account;
  getAccount(id: string): Account | undefined;
  send(from: string, to: string, text: string): ChatMessage;
  /** Mark every unread message *from* `otherId` *to* `reader` as read. Null if nothing was unread. */
  markRead(reader: string, otherId: string): { upTo: number } | null;
  /** Most recent `limit` messages between the two accounts, oldest first. */
  history(a: string, b: string, limit: number): ChatMessage[];
  /** `accountId`'s DM threads, newest activity first. */
  threads(accountId: string): ChatThread[];
  /** Bulk-load previously persisted messages verbatim (id/timestamps preserved). Hydration only. */
  hydrate(messages: ChatMessage[]): void;
}

const key = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

export interface ChatStoreOptions {
  /** Injectable clock for tests. */
  now?: () => number;
}

export const createMemoryChatStore = (opts: ChatStoreOptions = {}): ChatStore => {
  const now = opts.now ?? (() => Date.now());
  const accounts = new Map<string, Account>();
  const threads = new Map<string, ChatMessage[]>();

  const bucket = (a: string, b: string): ChatMessage[] => {
    const k = key(a, b);
    let arr = threads.get(k);
    if (!arr) {
      arr = [];
      threads.set(k, arr);
    }
    return arr;
  };

  return {
    upsertAccount(id, displayName) {
      const existing = accounts.get(id);
      if (existing) {
        existing.displayName = displayName;
        return existing;
      }
      const account: Account = { id, displayName };
      accounts.set(id, account);
      return account;
    },
    getAccount: (id) => accounts.get(id),

    send(from, to, text) {
      const msg: ChatMessage = { id: randomUUID(), senderId: from, recipientId: to, text, createdAt: now(), readAt: null };
      bucket(from, to).push(msg);
      return msg;
    },

    markRead(reader, otherId) {
      const arr = threads.get(key(reader, otherId));
      if (!arr) return null;
      const t = now();
      let changed = false;
      for (const m of arr) {
        if (m.recipientId === reader && m.readAt === null) {
          m.readAt = t;
          changed = true;
        }
      }
      return changed ? { upTo: t } : null;
    },

    history: (a, b, limit) => (threads.get(key(a, b)) ?? []).slice(-limit),

    threads(accountId) {
      const out: ChatThread[] = [];
      for (const [k, arr] of threads) {
        if (arr.length === 0) continue;
        const [lo, hi] = k.split('|') as [string, string];
        if (lo !== accountId && hi !== accountId) continue;
        const other = lo === accountId ? hi : lo;
        const unreadCount = arr.reduce(
          (n, m) => n + (m.recipientId === accountId && m.readAt === null ? 1 : 0),
          0,
        );
        out.push({
          accountId: other,
          displayName: accounts.get(other)?.displayName ?? other.slice(0, 8),
          lastMessage: arr[arr.length - 1] ?? null,
          unreadCount,
        });
      }
      return out.sort((a, b) => (b.lastMessage?.createdAt ?? 0) - (a.lastMessage?.createdAt ?? 0));
    },

    hydrate(messages) {
      for (const m of messages) bucket(m.senderId, m.recipientId).push(m);
    },
  };
};
