/**
 * Social store port: the account directory + the friendship graph. Pure and in-memory for
 * standalone/dev and tests; a Postgres adapter (platform-db) swaps in for durable friends without
 * touching the service logic (ports & adapters). Live presence/activity are NOT here — they belong
 * to the connection layer in server.ts; this store is the persistent social graph.
 */
import type { social, TitleAchievementRef } from '@mygame/protocol';

export interface Account {
  id: string;
  displayName: string;
  /** Mirrored from the shared `accounts` table; null until a Postgres-backed store refreshes it
   *  (see `refreshProfile`). Always null in pure in-memory mode — there's nothing to mirror from. */
  avatarIcon: string | null;
  titleAchievement: TitleAchievementRef | null;
}

/** A friend edge seen from one account's perspective. */
export interface FriendEdge {
  accountId: string;
  status: social.FriendStatus; // 'accepted' | 'incoming' | 'outgoing'
}

/** A raw account match from `searchAccounts` — the server annotates the caller's relation and filters
 *  blocks/self before returning it on the wire. `friendCode` is the short code in Postgres mode; in
 *  pure in-memory mode there's no code column, so the account id doubles as it (matching resolveFriendCode). */
export interface AccountMatch {
  accountId: string;
  displayName: string;
  avatarIcon: string | null;
  friendCode: string | null;
  titleAchievement: TitleAchievementRef | null;
}

export interface SocialStore {
  upsertAccount(id: string, displayName: string): Account;
  getAccount(id: string): Account | undefined;
  /** Merge in profile display fields social mirrors from auth's account row (never writes them). */
  updateProfile(id: string, profile: { avatarIcon: string | null; titleAchievement: TitleAchievementRef | null }): void;
  /** Postgres-backed only: re-read this account's profile fields from the shared `accounts` table
   *  (auth is authoritative) and merge via `updateProfile`. No-op in-memory — there's no other
   *  source of truth to pull from, so avatar/title just stay null there. */
  refreshProfile(id: string): Promise<void>;
  /** Find accounts by display name (substring) or friend code (exact/prefix), ranked with an exact
   *  code match first, then name matches. Returns raw account fields; presence, the caller's relation
   *  and block filtering are applied by the server. */
  searchAccounts(query: string, limit: number): Promise<AccountMatch[]>;
  /** Send a request from `from` to `to`. Auto-accepts if `to` had already requested `from`. */
  request(from: string, to: string): void;
  /** Accept an incoming request (only if `other` requested `account`). */
  accept(account: string, other: string): void;
  /** Decline an incoming request or cancel an outgoing one (drops the pending edge). */
  decline(account: string, other: string): void;
  /** Remove an accepted friend (or any edge). */
  remove(account: string, other: string): void;
  /** Edges visible to `account`, with direction resolved to incoming/outgoing/accepted. */
  friendsOf(account: string): FriendEdge[];
  /** Blocking does not delete the underlying friend edge — it only hides presence/activity between
   *  the two (checked via `isBlocked` at render time) and rejects new requests; unblocking silently
   *  restores visibility with no re-friending step. */
  block(blocker: string, blocked: string): void;
  unblock(blocker: string, blocked: string): void;
  /** True if either has blocked the other. */
  isBlocked(a: string, b: string): boolean;
  /** Accounts `account` has blocked (for an unblock list) — not who has blocked `account`. */
  blockedByMe(account: string): Account[];
}

/** Undirected edge keyed by the sorted pair; `by` records the requester (for pending direction). */
interface Edge {
  lo: string;
  hi: string;
  accepted: boolean;
  by: string;
}

const key = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);
/** Directed, unlike the friend edge key above — only the blocker can undo it. */
const blockKey = (blocker: string, blocked: string): string => `${blocker}>${blocked}`;

export const createMemorySocialStore = (): SocialStore => {
  const accounts = new Map<string, Account>();
  const edges = new Map<string, Edge>();
  const blocks = new Set<string>();

  return {
    upsertAccount(id, displayName) {
      const existing = accounts.get(id);
      if (existing) {
        existing.displayName = displayName;
        return existing;
      }
      const account: Account = { id, displayName, avatarIcon: null, titleAchievement: null };
      accounts.set(id, account);
      return account;
    },
    getAccount: (id) => accounts.get(id),
    updateProfile(id, profile) {
      const existing = accounts.get(id);
      if (existing) Object.assign(existing, profile);
    },
    refreshProfile: async () => {},

    async searchAccounts(query, limit) {
      const q = query.trim().toLowerCase();
      if (!q) return [];
      // In-memory has no friend_code column — the account id doubles as the code (see resolveFriendCode).
      const scored: { m: AccountMatch; rank: number }[] = [];
      for (const acc of accounts.values()) {
        const id = acc.id.toLowerCase();
        const name = acc.displayName.toLowerCase();
        const rank = id === q ? 0 : name.startsWith(q) ? 1 : name.includes(q) ? 2 : id.startsWith(q) ? 3 : -1;
        if (rank < 0) continue;
        scored.push({
          rank,
          m: {
            accountId: acc.id,
            displayName: acc.displayName,
            avatarIcon: acc.avatarIcon,
            friendCode: acc.id,
            titleAchievement: acc.titleAchievement,
          },
        });
      }
      scored.sort((a, b) => a.rank - b.rank || a.m.displayName.length - b.m.displayName.length);
      return scored.slice(0, limit).map((s) => s.m);
    },

    request(from, to) {
      if (from === to) return;
      const k = key(from, to);
      const edge = edges.get(k);
      if (!edge) {
        const [lo, hi] = from < to ? [from, to] : [to, from];
        edges.set(k, { lo, hi, accepted: false, by: from });
        return;
      }
      if (edge.accepted) return; // already friends
      if (edge.by !== from) edge.accepted = true; // reverse request -> accept; duplicate -> no-op
    },

    accept(account, other) {
      const edge = edges.get(key(account, other));
      if (edge && !edge.accepted && edge.by === other) edge.accepted = true;
    },

    decline(account, other) {
      const edge = edges.get(key(account, other));
      if (edge && !edge.accepted) edges.delete(key(account, other));
    },

    remove(account, other) {
      edges.delete(key(account, other));
    },

    friendsOf(account) {
      const out: FriendEdge[] = [];
      for (const edge of edges.values()) {
        if (edge.lo !== account && edge.hi !== account) continue;
        const other = edge.lo === account ? edge.hi : edge.lo;
        if (edge.accepted) out.push({ accountId: other, status: 'accepted' });
        else out.push({ accountId: other, status: edge.by === account ? 'outgoing' : 'incoming' });
      }
      return out;
    },

    block(blocker, blocked) {
      if (blocker === blocked) return;
      blocks.add(blockKey(blocker, blocked));
    },
    unblock(blocker, blocked) {
      blocks.delete(blockKey(blocker, blocked));
    },
    isBlocked: (a, b) => blocks.has(blockKey(a, b)) || blocks.has(blockKey(b, a)),
    blockedByMe(account) {
      const out: Account[] = [];
      for (const k of blocks) {
        const [blocker, blocked] = k.split('>') as [string, string];
        if (blocker !== account) continue;
        const acc = accounts.get(blocked);
        if (acc) out.push(acc);
      }
      return out;
    },
  };
};
