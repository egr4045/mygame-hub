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

describe('chat store — group membership', () => {
  it('ownerOf is the creator for a group and null for a dm', () => {
    const s = createMemoryChatStore();
    const group = s.createGroup('a', 'Squad', ['b']);
    expect(s.ownerOf(group.id)).toBe('a');
    const dm = s.openDm('a', 'b');
    expect(s.ownerOf(dm.id)).toBeNull();
  });

  it('addMembers adds new members who start fully unread', () => {
    const s = createMemoryChatStore();
    const group = s.createGroup('a', 'Squad', ['b']);
    s.send(group.id, 'a', 'before c joined');
    const result = s.addMembers(group.id, ['c']);
    expect(result).toMatchObject({ participantIds: ['a', 'b', 'c'] });
    const cThread = s.threads('c').find((t) => t.conversationId === group.id);
    // c sees the pre-existing message as unread, not "caught up" — same rule as a fresh dm/group.
    expect(cThread).toMatchObject({ unreadCount: 1 });
  });

  it('addMembers silently skips members already present (no duplicates, no error)', () => {
    const s = createMemoryChatStore();
    const group = s.createGroup('a', 'Squad', ['b']);
    const result = s.addMembers(group.id, ['b', 'c']);
    expect(result).toMatchObject({ participantIds: ['a', 'b', 'c'] });
  });

  it('addMembers rejects an unknown conversation or a dm', () => {
    const s = createMemoryChatStore();
    expect(s.addMembers('missing', ['x'])).toBe('not_found');
    const dm = s.openDm('a', 'b');
    expect(s.addMembers(dm.id, ['c'])).toBe('not_a_group');
  });

  it('removeMember drops a member (kick) so they no longer see the thread', () => {
    const s = createMemoryChatStore();
    const group = s.createGroup('a', 'Squad', ['b', 'c']);
    const result = s.removeMember(group.id, 'c');
    expect(result).toMatchObject({ participantIds: ['a', 'b'] });
    expect(s.threads('c').find((t) => t.conversationId === group.id)).toBeUndefined();
    expect(s.isParticipant(group.id, 'c')).toBe(false);
  });

  it('removeMember allows a member to remove themselves (leave)', () => {
    const s = createMemoryChatStore();
    const group = s.createGroup('a', 'Squad', ['b']);
    expect(s.removeMember(group.id, 'b')).toMatchObject({ participantIds: ['a'] });
  });

  it('removeMember rejects an unknown conversation, a dm, or a non-member', () => {
    const s = createMemoryChatStore();
    expect(s.removeMember('missing', 'a')).toBe('not_found');
    const dm = s.openDm('a', 'b');
    expect(s.removeMember(dm.id, 'a')).toBe('not_a_group');
    const group = s.createGroup('a', 'Squad', ['b']);
    expect(s.removeMember(group.id, 'stranger')).toBe('not_a_member');
  });
});

describe('chat store — hydration', () => {
  it('hydrate() reconstructs conversations, membership and messages verbatim', () => {
    const s = createMemoryChatStore();
    s.hydrate({
      conversations: [
        { id: 'c1', type: 'dm', name: null, participantIds: ['a', 'b'], ownerId: null, createdAt: 50 },
      ],
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
