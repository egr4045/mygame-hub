import { describe, expect, it } from 'vitest';
import { createMemoryChatStore } from './store.js';

describe('chat store — direct messages', () => {
  it('a sent message appears in history from both sides', () => {
    const s = createMemoryChatStore();
    s.send('a', 'b', 'hi');
    expect(s.history('a', 'b', 10)).toHaveLength(1);
    expect(s.history('b', 'a', 10)).toHaveLength(1);
    expect(s.history('a', 'b', 10)[0]).toMatchObject({ senderId: 'a', recipientId: 'b', text: 'hi' });
  });

  it('threads() reports the last message and unread count for the recipient only', () => {
    const s = createMemoryChatStore();
    s.send('a', 'b', 'one');
    s.send('a', 'b', 'two');

    const bThreads = s.threads('b');
    expect(bThreads).toHaveLength(1);
    expect(bThreads[0]).toMatchObject({ accountId: 'a', unreadCount: 2 });
    expect(bThreads[0]!.lastMessage?.text).toBe('two');

    // The sender never has unread messages in their own thread view.
    const aThreads = s.threads('a');
    expect(aThreads[0]).toMatchObject({ accountId: 'b', unreadCount: 0 });
  });

  it('markRead clears unread count and returns null when nothing was unread', () => {
    const s = createMemoryChatStore();
    s.send('a', 'b', 'hi');
    const result = s.markRead('b', 'a');
    expect(result).not.toBeNull();
    expect(s.threads('b')[0]).toMatchObject({ unreadCount: 0 });
    expect(s.markRead('b', 'a')).toBeNull(); // nothing left to mark
  });

  it('resolves a thread\'s display name from the account directory', () => {
    const s = createMemoryChatStore();
    s.upsertAccount('a', 'Mara');
    s.send('a', 'b', 'hi');
    expect(s.threads('b')[0]).toMatchObject({ accountId: 'a', displayName: 'Mara' });
  });

  it('hydrate() preserves ids and timestamps without duplicating', () => {
    const s = createMemoryChatStore();
    s.hydrate([{ id: 'm1', senderId: 'a', recipientId: 'b', text: 'old', createdAt: 100, readAt: null }]);
    expect(s.history('a', 'b', 10)).toEqual([
      { id: 'm1', senderId: 'a', recipientId: 'b', text: 'old', createdAt: 100, readAt: null },
    ]);
  });
});
