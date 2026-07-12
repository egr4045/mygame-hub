import { randomUUID } from 'node:crypto';

/**
 * Chat store port: conversations (DMs and groups) + messages. A DM is just a 2-member conversation
 * (`type: 'dm'`), found-or-created deterministically per account pair via `openDm`; a group is
 * created explicitly with a name and an initial member list, and its membership can change afterward
 * (`addMembers`/`removeMember`). "Read" is tracked per member per conversation (`lastReadAt`), not per
 * message — that scales to N-member groups without a combinatorial per-message read-by-whom state.
 *
 * In-memory adapter for standalone/dev and tests; a Postgres adapter (`pgStore.ts`) swaps in for
 * durable history without touching the service logic (ports & adapters).
 */
export interface Account {
  id: string;
  displayName: string;
}

export type ConversationType = 'dm' | 'group';

export interface Conversation {
  id: string;
  type: ConversationType;
  /** Set for groups; null for dm (the hub derives a dm's display name from the other participant). */
  name: string | null;
  participantIds: string[];
  /** group only: the creator, who alone may remove *other* members. Null for dm. */
  ownerId: string | null;
  /** group only: admins appointed by the owner. */
  admins: string[];
  /** group only: custom avatar URL. */
  avatarUrl: string | null;
  /** group only: pinned message. */
  pinnedMessageId: string | null;
  createdAt: number;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  text: string;
  createdAt: number;
  replyToId?: string | null;
  mentions?: string[];
  attachments?: { id: string; url: string; type: string; name: string }[];
  /** Set when the sender edited the message. */
  editedAt?: number | null;
  /** Tombstone: the row survives (reply chains, ordering) but text/attachments are blanked. */
  deletedAt?: number | null;
}

export interface ChatParticipant {
  accountId: string;
  displayName: string;
}

export interface ChatThread {
  conversationId: string;
  type: ConversationType;
  name: string;
  participants: ChatParticipant[];
  lastMessage: ChatMessage | null;
  unreadCount: number;
  /** dm only: the other participant's last-read timestamp (read-receipt UI). Null for groups. */
  otherReadAt: number | null;
  ownerId: string | null;
  admins?: string[];
  avatarUrl?: string | null;
  pinnedMessageId?: string | null;
}

/** Why an `addMembers`/`removeMember` call was rejected by the store (not found or wrong type). */
export type MembershipChangeError = 'not_found' | 'not_a_group' | 'not_a_member';

/** Why an edit/delete was rejected: unknown message, not allowed for this account, or the message
 *  is already a tombstone (edit only — deleting twice is a no-op, not an error). */
export type MessageChangeError = 'not_found' | 'forbidden' | 'deleted';

export interface HistoryPage {
  /** Oldest-first, like the wire format. */
  messages: ChatMessage[];
  /** True when older messages remain before the first one returned. */
  hasMore: boolean;
}

export interface ChatStore {
  upsertAccount(id: string, displayName: string): Account;
  getAccount(id: string): Account | undefined;
  /** Find-or-create the DM conversation between `a` and `b`. Deterministic for a given pair. */
  openDm(a: string, b: string): Conversation;
  /** Create a group; `creator` is added to `memberIds` automatically and becomes its owner. */
  createGroup(creator: string, name: string, memberIds: string[]): Conversation;
  typeOf(conversationId: string): ConversationType | undefined;
  isParticipant(conversationId: string, accountId: string): boolean;
  participantsOf(conversationId: string): string[];
  /** group only: the creator, who alone may remove other members. Null for dm/not-found. */
  ownerOf(conversationId: string): string | null;
  /** group only. Members already present are silently skipped (no error, no duplicate). */
  addMembers(conversationId: string, memberIds: string[]): Conversation | MembershipChangeError;
  /** group only. Removes `targetId` (self-removal = "leave"). */
  removeMember(conversationId: string, targetId: string): Conversation | MembershipChangeError;
  /** group only. Owner can promote/demote admins. */
  setGroupRole(conversationId: string, targetId: string, role: 'admin' | 'member'): Conversation | MembershipChangeError;
  /** group only. Admins/owner can change name/avatar. */
  updateGroupProfile(conversationId: string, name?: string, avatarUrl?: string | null): Conversation | MembershipChangeError;
  /** group only. Admins/owner can pin a message. */
  pinMessage(conversationId: string, messageId: string | null): Conversation | MembershipChangeError;
  /** Null if `senderId` isn't a participant of `conversationId`. A `replyToId` pointing outside
   *  this conversation is silently dropped (stored as null) rather than trusted. */
  send(
    conversationId: string,
    senderId: string,
    text: string,
    opts?: { replyToId?: string | undefined; mentions?: string[] | undefined; attachments?: ChatMessage['attachments'] | undefined },
  ): ChatMessage | null;
  /** Sender-only, not on tombstones. Returns the updated message. */
  editMessage(conversationId: string, messageId: string, editorId: string, text: string): ChatMessage | MessageChangeError;
  /** Own messages always; others' only with `canModerate` (group owner/admin — the server decides).
   *  Tombstones: sets `deletedAt`, blanks text/attachments. Idempotent on an already-deleted message. */
  deleteMessage(conversationId: string, messageId: string, byId: string, canModerate: boolean): ChatMessage | MessageChangeError;
  /** Mark everything up to now as read for `accountId`. Null if there was nothing unread. */
  markRead(conversationId: string, accountId: string): { upTo: number } | null;
  /** Most recent `limit` messages older than `before` (exclusive; omit for the newest page), oldest
   *  first, plus whether more remain beyond the page. */
  history(conversationId: string, limit: number, before?: number): HistoryPage;
  /** Retention: drop messages with `createdAt < cutoff`, but always keep each conversation's most
   *  recent message so thread previews survive. Returns how many were removed. */
  pruneMessagesBefore(cutoff: number): number;
  /** `accountId`'s conversations, newest activity first. */
  threads(accountId: string): ChatThread[];
  /** Bulk-load previously persisted state verbatim (ids/timestamps preserved). Hydration only. */
  hydrate(data: {
    conversations: Conversation[];
    memberships: { conversationId: string; accountId: string; lastReadAt: number }[];
    messages: ChatMessage[];
  }): void;
}

const sortedKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

export interface ChatStoreOptions {
  /** Injectable clock for tests. */
  now?: () => number;
}

export const createMemoryChatStore = (opts: ChatStoreOptions = {}): ChatStore => {
  const now = opts.now ?? (() => Date.now());
  const accounts = new Map<string, Account>();
  const conversations = new Map<string, Conversation>();
  const dmIndex = new Map<string, string>(); // sorted account pair -> conversationId
  const membership = new Map<string, Map<string, number>>(); // conversationId -> accountId -> lastReadAt
  const messages = new Map<string, ChatMessage[]>(); // conversationId -> messages

  const displayNameOf = (id: string): string => accounts.get(id)?.displayName ?? id.slice(0, 8);

  /** New members start having read nothing (0), not "caught up to now" — a message landing in the
   *  same tick as conversation creation must still count as unread. */
  const initMembers = (conversationId: string, participantIds: string[]): void => {
    const m = membership.get(conversationId) ?? new Map<string, number>();
    for (const p of participantIds) if (!m.has(p)) m.set(p, 0);
    membership.set(conversationId, m);
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

    openDm(a, b) {
      const key = sortedKey(a, b);
      const existingId = dmIndex.get(key);
      if (existingId) return conversations.get(existingId)!;
      const conv: Conversation = {
        id: randomUUID(),
        type: 'dm',
        name: null,
        participantIds: [a, b],
        ownerId: null,
        admins: [],
        avatarUrl: null,
        pinnedMessageId: null,
        createdAt: now(),
      };
      conversations.set(conv.id, conv);
      dmIndex.set(key, conv.id);
      initMembers(conv.id, [a, b]);
      return conv;
    },

    createGroup(creator, name, memberIds) {
      const participantIds = [...new Set([creator, ...memberIds])];
      const conv: Conversation = {
        id: randomUUID(),
        type: 'group',
        name,
        participantIds,
        ownerId: creator,
        admins: [],
        avatarUrl: null,
        pinnedMessageId: null,
        createdAt: now(),
      };
      conversations.set(conv.id, conv);
      initMembers(conv.id, participantIds);
      return conv;
    },

    typeOf: (conversationId) => conversations.get(conversationId)?.type,
    isParticipant: (conversationId, accountId) =>
      conversations.get(conversationId)?.participantIds.includes(accountId) ?? false,
    participantsOf: (conversationId) => conversations.get(conversationId)?.participantIds ?? [],
    ownerOf: (conversationId) => conversations.get(conversationId)?.ownerId ?? null,

    addMembers(conversationId, memberIds) {
      const conv = conversations.get(conversationId);
      if (!conv) return 'not_found';
      if (conv.type !== 'group') return 'not_a_group';
      const newIds = memberIds.filter((id) => !conv.participantIds.includes(id));
      if (newIds.length > 0) {
        conv.participantIds = [...conv.participantIds, ...newIds];
        initMembers(conversationId, newIds);
      }
      return conv;
    },

    removeMember(conversationId, targetId) {
      const conv = conversations.get(conversationId);
      if (!conv) return 'not_found';
      if (conv.type !== 'group') return 'not_a_group';
      if (!conv.participantIds.includes(targetId)) return 'not_a_member';
      conv.participantIds = conv.participantIds.filter((id) => id !== targetId);
      conv.admins = conv.admins.filter((id) => id !== targetId);
      membership.get(conversationId)?.delete(targetId);
      if (conv.participantIds.length === 0) {
        // Last member left — reap the conversation and its messages; a memberless group is
        // unreachable (hydration would silently drop it and its rows would just rot).
        conversations.delete(conversationId);
        membership.delete(conversationId);
        messages.delete(conversationId);
      } else if (conv.ownerId === targetId) {
        // The owner left: promote the first admin, else the longest-standing member — otherwise
        // the group is bricked (setGroupRole requires an owner, so no new admins could ever be
        // appointed again).
        conv.ownerId = conv.admins[0] ?? conv.participantIds[0] ?? null;
      }
      return conv;
    },

    setGroupRole(conversationId, targetId, role) {
      const conv = conversations.get(conversationId);
      if (!conv) return 'not_found';
      if (conv.type !== 'group') return 'not_a_group';
      if (!conv.participantIds.includes(targetId)) return 'not_a_member';
      
      if (role === 'admin' && !conv.admins.includes(targetId)) {
        conv.admins.push(targetId);
      } else if (role === 'member') {
        conv.admins = conv.admins.filter(id => id !== targetId);
      }
      return conv;
    },

    updateGroupProfile(conversationId, name, avatarUrl) {
      const conv = conversations.get(conversationId);
      if (!conv) return 'not_found';
      if (conv.type !== 'group') return 'not_a_group';
      
      if (name !== undefined) conv.name = name;
      if (avatarUrl !== undefined) conv.avatarUrl = avatarUrl;
      return conv;
    },

    pinMessage(conversationId, messageId) {
      const conv = conversations.get(conversationId);
      if (!conv) return 'not_found';
      if (conv.type !== 'group') return 'not_a_group';
      
      conv.pinnedMessageId = messageId;
      return conv;
    },

    send(conversationId, senderId, text, opts) {
      const conv = conversations.get(conversationId);
      if (!conv || !conv.participantIds.includes(senderId)) return null;
      const replyTarget = opts?.replyToId
        ? ((messages.get(conversationId) ?? []).find((m) => m.id === opts.replyToId) ?? null)
        : null;
      const msg: ChatMessage = {
        id: randomUUID(),
        conversationId,
        senderId,
        senderName: displayNameOf(senderId),
        text,
        createdAt: now(),
        replyToId: replyTarget?.id ?? null,
        ...(opts?.mentions !== undefined ? { mentions: opts.mentions } : {}),
        ...(opts?.attachments !== undefined ? { attachments: opts.attachments } : {}),
      };
      const arr = messages.get(conversationId) ?? [];
      arr.push(msg);
      messages.set(conversationId, arr);
      return msg;
    },

    editMessage(conversationId, messageId, editorId, text) {
      const msg = (messages.get(conversationId) ?? []).find((m) => m.id === messageId);
      if (!msg) return 'not_found';
      if (msg.senderId !== editorId) return 'forbidden';
      if (msg.deletedAt) return 'deleted';
      msg.text = text;
      msg.editedAt = now();
      return msg;
    },

    deleteMessage(conversationId, messageId, byId, canModerate) {
      const msg = (messages.get(conversationId) ?? []).find((m) => m.id === messageId);
      if (!msg) return 'not_found';
      if (msg.senderId !== byId && !canModerate) return 'forbidden';
      if (!msg.deletedAt) {
        msg.deletedAt = now();
        msg.text = '';
        delete msg.attachments;
      }
      return msg;
    },

    markRead(conversationId, accountId) {
      const conv = conversations.get(conversationId);
      const mem = membership.get(conversationId);
      if (!conv || !mem || !conv.participantIds.includes(accountId)) return null;
      const lastReadAt = mem.get(accountId) ?? 0;
      const arr = messages.get(conversationId) ?? [];
      const hasUnread = arr.some((m) => m.senderId !== accountId && m.createdAt > lastReadAt);
      const t = now();
      mem.set(accountId, t);
      return hasUnread ? { upTo: t } : null;
    },

    history(conversationId, limit, before) {
      const all = messages.get(conversationId) ?? [];
      const pool = before !== undefined ? all.filter((m) => m.createdAt < before) : all;
      const page = pool.slice(-limit);
      return { messages: page, hasMore: pool.length > page.length };
    },

    pruneMessagesBefore(cutoff) {
      let removed = 0;
      for (const [convId, arr] of messages) {
        if (arr.length === 0) continue;
        // Messages are appended in send order, so the last element is the most recent — keep it
        // regardless of age so the thread's last-message preview never blanks out.
        const lastId = arr[arr.length - 1]!.id;
        const kept = arr.filter((m) => m.createdAt >= cutoff || m.id === lastId);
        removed += arr.length - kept.length;
        messages.set(convId, kept);
      }
      return removed;
    },

    threads(accountId) {
      const out: ChatThread[] = [];
      for (const conv of conversations.values()) {
        if (!conv.participantIds.includes(accountId)) continue;
        const arr = messages.get(conv.id) ?? [];
        const lastReadAt = membership.get(conv.id)?.get(accountId) ?? 0;
        const unreadCount = arr.reduce(
          (n, m) => n + (m.senderId !== accountId && m.createdAt > lastReadAt ? 1 : 0),
          0,
        );
        const other = conv.participantIds.find((p) => p !== accountId);
        // Groups may be created without a name — derive one from the *other* members' display names.
        const derivedGroupName = (): string =>
          conv.participantIds
            .filter((id) => id !== accountId)
            .map(displayNameOf)
            .slice(0, 3)
            .join(', ') || 'Группа';
        const name =
          conv.type === 'group' ? (conv.name?.trim() || derivedGroupName()) : displayNameOf(other ?? accountId);
        const otherReadAt =
          conv.type === 'dm' && other ? (membership.get(conv.id)?.get(other) ?? 0) : null;
        out.push({
          conversationId: conv.id,
          type: conv.type,
          name,
          participants: conv.participantIds.map((id) => ({ accountId: id, displayName: displayNameOf(id) })),
          lastMessage: arr[arr.length - 1] ?? null,
          unreadCount,
          otherReadAt,
          ownerId: conv.ownerId,
          admins: conv.admins,
          avatarUrl: conv.avatarUrl,
          pinnedMessageId: conv.pinnedMessageId,
        });
      }
      return out.sort((a, b) => (b.lastMessage?.createdAt ?? 0) - (a.lastMessage?.createdAt ?? 0));
    },

    hydrate(data) {
      for (const conv of data.conversations) {
        conversations.set(conv.id, conv);
        if (conv.type === 'dm' && conv.participantIds.length === 2) {
          dmIndex.set(sortedKey(conv.participantIds[0]!, conv.participantIds[1]!), conv.id);
        }
      }
      for (const m of data.memberships) {
        const mem = membership.get(m.conversationId) ?? new Map<string, number>();
        mem.set(m.accountId, m.lastReadAt);
        membership.set(m.conversationId, mem);
      }
      for (const msg of data.messages) {
        const arr = messages.get(msg.conversationId) ?? [];
        arr.push(msg);
        messages.set(msg.conversationId, arr);
      }
    },
  };
};
