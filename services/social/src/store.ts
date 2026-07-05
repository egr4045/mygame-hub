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

export interface SocialStore {
  upsertAccount(id: string, displayName: string): Account;
  getAccount(id: string): Account | undefined;
  /** Merge in profile display fields social mirrors from auth's account row (never writes them). */
  updateProfile(id: string, profile: { avatarIcon: string | null; titleAchievement: TitleAchievementRef | null }): void;
  /** Postgres-backed only: re-read this account's profile fields from the shared `accounts` table
   *  (auth is authoritative) and merge via `updateProfile`. No-op in-memory — there's no other
   *  source of truth to pull from, so avatar/title just stay null there. */
  refreshProfile(id: string): Promise<void>;
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
}

/** Undirected edge keyed by the sorted pair; `by` records the requester (for pending direction). */
interface Edge {
  lo: string;
  hi: string;
  accepted: boolean;
  by: string;
}

const key = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

export const createMemorySocialStore = (): SocialStore => {
  const accounts = new Map<string, Account>();
  const edges = new Map<string, Edge>();

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
  };
};
