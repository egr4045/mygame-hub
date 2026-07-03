import { describe, expect, it } from 'vitest';
import { createMemoryChatStore } from './store.js';

describe('chat store — DMs', () => {
  it('openDm is idempotent for the same pair, in either order', () => {
    const s = createMemoryChatStore();
    const conv1 = s.openDm('a', 'b');
    const conv2 = s.openDm('b', 'a');
    expect(conv2.id).toBe(conv1.id);
    expect(conv1).toMatchObject({ type: 'dm', participantIds: ['a', 'b'] });
  });

  it('a sent message appears in history and updates both threads', () => {
    const s = createMemoryChatStore();
    const conv = s.openDm('a', 'b');
    s.send(conv.id, 'a', 'hi');
    expect(s.history(conv.id, 10)).toHaveLength(1);
    expect(s.history(conv.id, 10)[0]).toMatchObject({ senderId: 'a', text: 'hi' });

    const bThreads = s.threads('b');
    expect(bThreads[0]).toMatchObject({ conversationId: conv.id, unreadCount: 1 });
    const aThreads = s.threads('a');
    expect(aThreads[0]).toMatchObject({ conversationId: conv.id, unreadCount: 0 });
  });

  it('markRead clears unread count and returns null when nothing was unread', () => {
    const s = createMemoryChatStore();
    const conv = s.openDm('a', 'b');
    s.send(conv.id, 'a', 'hi');
    expect(s.markRead(conv.id, 'b')).not.toBeNull();
    expect(s.threads('b')[0]).toMatchObject({ unreadCount: 0 });
    expect(s.markRead(conv.id, 'b')).toBeNull();
  });

  it("resolves a dm thread's display name to the OTHER participant", () => {
    const s = createMemoryChatStore();
    s.upsertAccount('a', 'Mara');
    s.upsertAccount('b', 'Wei');
    const conv = s.openDm('a', 'b');
    expect(s.threads('a')[0]).toMatchObject({ name: 'Wei' });
    expect(s.threads('b')[0]).toMatchObject({ name: 'Mara' });
  });

  it('send fails for a non-participant', () => {
    const s = createMemoryChatStore();
    const conv = s.openDm('a', 'b');
    expect(s.send(conv.id, 'c', 'sneaky')).toBeNull();
  });
});

describe('chat store — groups', () => {
  it('createGroup adds the creator automatically and de-duplicates members', () => {
    const s = createMemoryChatStore();
    const conv = s.createGroup('a', 'Squad', ['b', 'c', 'a']);
    expect(conv).toMatchObject({ type: 'group', name: 'Squad', participantIds: ['a', 'b', 'c'] });
  });

  it('a message reaches every member\'s thread with the group name', () => {
    const s = createMemoryChatStore();
    const conv = s.createGroup('a', 'Squad', ['b', 'c']);
    s.send(conv.id, 'a', 'hello squad');

    for (const member of ['a', 'b', 'c']) {
      const t = s.threads(member).find((x) => x.conversationId === conv.id);
      expect(t).toMatchObject({ type: 'group', name: 'Squad' });
    }
    expect(s.threads('b').find((x) => x.conversationId === conv.id)).toMatchObject({ unreadCount: 1 });
    expect(s.threads('a').find((x) => x.conversationId === conv.id)).toMatchObject({ unreadCount: 0 });
  });

  it('a fresh group with no messages still appears in every member\'s thread list', () => {
    const s = createMemoryChatStore();
    const conv = s.createGroup('a', 'Empty Squad', ['b']);
    expect(s.threads('b').find((x) => x.conversationId === conv.id)).toMatchObject({ lastMessage: null });
  });
});

describe('chat store — hydration', () => {
  it('hydrate() reconstructs conversations, membership and messages verbatim', () => {
    const s = createMemoryChatStore();
    s.hydrate({
      conversations: [{ id: 'c1', type: 'dm', name: null, participantIds: ['a', 'b'], createdAt: 50 }],
      memberships: [
        { conversationId: 'c1', accountId: 'a', lastReadAt: 100 },
        { conversationId: 'c1', accountId: 'b', lastReadAt: 0 },
      ],
      messages: [{ id: 'm1', conversationId: 'c1', senderId: 'a', senderName: 'Mara', text: 'old', createdAt: 90 }],
    });
    expect(s.history('c1', 10)).toEqual([
      { id: 'm1', conversationId: 'c1', senderId: 'a', senderName: 'Mara', text: 'old', createdAt: 90 },
    ]);
    // The message is from 'a'. b's lastReadAt (0) is before it (90) -> unread for b.
    expect(s.threads('b')[0]).toMatchObject({ unreadCount: 1 });
    // 'a' never counts their own message as unread, regardless of lastReadAt.
    expect(s.threads('a')[0]).toMatchObject({ unreadCount: 0 });
    // openDm re-derives the same conversation id for this pair post-hydration.
    expect(s.openDm('a', 'b').id).toBe('c1');
  });
});
