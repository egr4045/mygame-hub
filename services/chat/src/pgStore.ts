/**
 * Postgres-backed ChatStore — durable conversations, membership (read state) and message history.
 * The canonical conversation/thread logic stays in `createMemoryChatStore` (reads stay synchronous);
 * every mutation is mirrored to Postgres via the WriteQueue. `init()` replays stored state back
 * through `hydrate()` on boot, so the in-memory state is reconstructed exactly.
 *
 * The `accounts` table is shared with auth/social; here we only ever touch `display_name`.
 */
import { type Pool, WriteQueue } from '@mygame/platform-db';
import type { Logger } from '@mygame/shared-types';
import { createMemoryChatStore, type ChatMessage, type ChatStore, type Conversation } from './store.js';

export interface PgChatStore extends ChatStore {
  /** Load accounts + conversations + membership + messages from Postgres. Call once before serving. */
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

  const persistConversation = (c: Conversation): void =>
    queue.push('chat.conversation', () =>
      pool.query(`INSERT INTO conversations (id, type, name, owner_id, created_at) VALUES ($1, $2, $3, $4, $5)`, [
        c.id,
        c.type,
        c.name,
        c.ownerId,
        c.createdAt,
      ]),
    );

  const updateConversation = (c: Conversation): void =>
    queue.push('chat.conversation.update', () =>
      pool.query(
        `UPDATE conversations SET name = $1, avatar_url = $2, pinned_message_id = $3, admins = $4 WHERE id = $5`,
        [c.name, c.avatarUrl, c.pinnedMessageId, JSON.stringify(c.admins), c.id]
      )
    );

  const persistMember = (conversationId: string, accountId: string, lastReadAt: number): void =>
    queue.push('chat.member', () =>
      pool.query(
        `INSERT INTO conversation_members (conversation_id, account_id, last_read_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (conversation_id, account_id) DO UPDATE SET last_read_at = EXCLUDED.last_read_at`,
        [conversationId, accountId, lastReadAt],
      ),
    );

  const removeMemberRow = (conversationId: string, accountId: string): void =>
    queue.push('chat.member.remove', () =>
      pool.query(`DELETE FROM conversation_members WHERE conversation_id = $1 AND account_id = $2`, [
        conversationId,
        accountId,
      ]),
    );

  const persistMessage = (m: ChatMessage): void =>
    queue.push('chat.message', () =>
      pool.query(
        `INSERT INTO messages (id, conversation_id, sender_id, text, created_at, reply_to_id, mentions, attachments)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [m.id, m.conversationId, m.senderId, m.text, m.createdAt, m.replyToId ?? null, JSON.stringify(m.mentions ?? []), JSON.stringify(m.attachments ?? [])],
      ),
    );

  return {
    async init() {
      const accounts = await pool.query(`SELECT id, display_name FROM accounts`);
      for (const r of accounts.rows) mem.upsertAccount(r.id as string, r.display_name as string);

      const convRows = await pool.query(
        `SELECT c.id, c.type, c.name, c.owner_id, c.created_at, c.admins, c.avatar_url, c.pinned_message_id, array_agg(cm.account_id) AS participant_ids
         FROM conversations c JOIN conversation_members cm ON cm.conversation_id = c.id
         GROUP BY c.id, c.type, c.name, c.owner_id, c.created_at, c.admins, c.avatar_url, c.pinned_message_id`,
      );
      const conversations: Conversation[] = convRows.rows.map((r) => ({
        id: r.id as string,
        type: r.type as Conversation['type'],
        name: (r.name as string | null) ?? null,
        participantIds: r.participant_ids as string[],
        ownerId: (r.owner_id as string | null) ?? null,
        admins: (r.admins as string[] | null) ?? [],
        avatarUrl: (r.avatar_url as string | null) ?? null,
        pinnedMessageId: (r.pinned_message_id as string | null) ?? null,
        createdAt: Number(r.created_at),
      }));

      const memberRows = await pool.query(
        `SELECT conversation_id, account_id, last_read_at FROM conversation_members`,
      );
      const memberships = memberRows.rows.map((r) => ({
        conversationId: r.conversation_id as string,
        accountId: r.account_id as string,
        lastReadAt: Number(r.last_read_at),
      }));

      const msgRows = await pool.query(
        `SELECT id, conversation_id, sender_id, text, created_at, reply_to_id, mentions, attachments FROM messages ORDER BY created_at ASC`,
      );
      const messages: ChatMessage[] = msgRows.rows.map((r) => ({
        id: r.id as string,
        conversationId: r.conversation_id as string,
        senderId: r.sender_id as string,
        senderName: mem.getAccount(r.sender_id as string)?.displayName ?? (r.sender_id as string).slice(0, 8),
        text: r.text as string,
        createdAt: Number(r.created_at),
        replyToId: (r.reply_to_id as string | null) ?? undefined,
        mentions: (r.mentions as string[] | null) ?? undefined,
        attachments: (r.attachments as any[] | null) ?? undefined,
      }));

      mem.hydrate({ conversations, memberships, messages });
      logger.info('chat hydrated', {
        accounts: accounts.rowCount,
        conversations: conversations.length,
        messages: messages.length,
      });
    },

    upsertAccount(id, displayName) {
      const a = mem.upsertAccount(id, displayName);
      persistAccount(id, displayName);
      return a;
    },
    getAccount: (id) => mem.getAccount(id),

    openDm(a, b) {
      const before = mem.threads(a).find((t) => t.type === 'dm' && t.participants.some((p) => p.accountId === b));
      const conv = mem.openDm(a, b);
      if (!before) {
        persistConversation(conv);
        // New members start having read nothing (0) — matches createMemoryChatStore's initMembers.
        persistMember(conv.id, a, 0);
        persistMember(conv.id, b, 0);
      }
      return conv;
    },

    createGroup(creator, name, memberIds) {
      const conv = mem.createGroup(creator, name, memberIds);
      persistConversation(conv);
      for (const p of conv.participantIds) persistMember(conv.id, p, 0);
      return conv;
    },

    typeOf: (conversationId) => mem.typeOf(conversationId),
    isParticipant: (conversationId, accountId) => mem.isParticipant(conversationId, accountId),
    participantsOf: (conversationId) => mem.participantsOf(conversationId),
    ownerOf: (conversationId) => mem.ownerOf(conversationId),

    addMembers(conversationId, memberIds) {
      const before = mem.participantsOf(conversationId);
      const result = mem.addMembers(conversationId, memberIds);
      if (typeof result !== 'string') {
        const newIds = result.participantIds.filter((id) => !before.includes(id));
        for (const id of newIds) persistMember(conversationId, id, 0);
      }
      return result;
    },

    removeMember(conversationId, targetId) {
      const result = mem.removeMember(conversationId, targetId);
      if (typeof result !== 'string') removeMemberRow(conversationId, targetId);
      return result;
    },

    setGroupRole(conversationId, targetId, role) {
      const result = mem.setGroupRole(conversationId, targetId, role);
      if (typeof result !== 'string') updateConversation(result);
      return result;
    },

    updateGroupProfile(conversationId, name, avatarUrl) {
      const result = mem.updateGroupProfile(conversationId, name, avatarUrl);
      if (typeof result !== 'string') updateConversation(result);
      return result;
    },

    pinMessage(conversationId, messageId) {
      const result = mem.pinMessage(conversationId, messageId);
      if (typeof result !== 'string') updateConversation(result);
      return result;
    },

    send(conversationId, senderId, text, opts) {
      const m = mem.send(conversationId, senderId, text, opts);
      if (m) persistMessage(m);
      return m;
    },

    markRead(conversationId, accountId) {
      const result = mem.markRead(conversationId, accountId);
      if (result) persistMember(conversationId, accountId, result.upTo);
      return result;
    },

    history: (conversationId, limit) => mem.history(conversationId, limit),
    threads: (accountId) => mem.threads(accountId),
    hydrate: (data) => mem.hydrate(data),
  };
};
