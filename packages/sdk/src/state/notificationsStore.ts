/**
 * The notification center's data layer.
 *
 * Deliberately NOT a second copy of every notification: each kind already has a durable home, so the
 * list is *derived* from those sources on read (`selectNotifications`). That way a request you already
 * accepted, or a call you already returned, can never linger here as a stale row.
 *
 * Two things can't be derived, because they are transitions rather than state — "your request was
 * accepted" and "you unlocked an achievement" leave nothing behind that says *recently*. Those are
 * recorded here as a small capped event log, cached in localStorage so a reload doesn't lose them.
 *
 * Read/unread is server-side (`socialStore.readKeys`), keyed by the stable `key` of each row — that is
 * what makes "I read it on my phone" clear the badge on the desktop, and what stops the tab badge
 * re-lighting after a reload.
 */
import { useMemo } from 'react';
import { create } from 'zustand';
import type { ToastType } from './toastStore.js';
import { useSocialStore } from './socialStore.js';
import { useChatStore } from './chatStore.js';
import { useMissedCallsStore } from './missedCallsStore.js';
import { loadJson, saveJson } from '../utils/storage.js';

export type NotificationKind = 'friend-request' | 'friend-accepted' | 'missed-call' | 'message' | 'invite' | 'achievement';

/** What the center renders. `key` is the read-marker id and must be stable for the same underlying
 *  thing across reloads and devices — never include anything that changes per render. */
export interface NotificationItem {
  key: string;
  kind: NotificationKind;
  /** Maps onto the toast palette so the center and toasts agree visually. */
  tone: ToastType;
  title: string;
  content: string;
  icon: string;
  avatar?: string | null;
  at: number;
  read: boolean;
  /** Present when the row has a person behind it (friend request/accept) — enables accept/decline. */
  accountId?: string;
  /** Present for message/missed-call rows — click opens that conversation. */
  conversationId?: string;
  /** Present for game invites — click routes into the room. */
  inviteCode?: string;
}

/** A transition we had to record because no source keeps it (see the module doc). */
interface LoggedEvent {
  key: string;
  kind: 'friend-accepted' | 'achievement';
  title: string;
  content: string;
  icon: string;
  at: number;
  accountId?: string;
}

const STORAGE_KEY = 'mygame.notificationLog';
const CAP = 50;
/** Rows older than this stop being "recent" and drop out of the center. */
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

interface NotificationLogState {
  events: LoggedEvent[];
  logEvent: (e: Omit<LoggedEvent, 'at'> & { at?: number }) => void;
  clearLog: () => void;
}

const hydrate = (): LoggedEvent[] =>
  loadJson<LoggedEvent[]>(STORAGE_KEY, []).filter(
    (e) => e && typeof e.key === 'string' && Number.isFinite(e.at),
  );

export const useNotificationLogStore = create<NotificationLogState>((set) => ({
  events: hydrate(),

  logEvent: (e) =>
    set((s) => {
      if (s.events.some((x) => x.key === e.key)) return s; // idempotent — same transition twice is one row
      const events = [...s.events, { ...e, at: e.at ?? Date.now() }].slice(-CAP);
      saveJson(STORAGE_KEY, events);
      return { events };
    }),

  clearLog: () => {
    saveJson(STORAGE_KEY, []);
    set({ events: [] });
  },
}));

/**
 * Watch the friends roster for outgoing→accepted flips and log them. Installed once; the roster
 * arrives as a full list with no per-change event, so a diff is the only way to spot it.
 */
let acceptWatcherInstalled = false;
export const installFriendAcceptWatcher = (): void => {
  if (acceptWatcherInstalled) return;
  acceptWatcherInstalled = true;
  useSocialStore.subscribe((s, prev) => {
    if (s.friends === prev.friends) return;
    const before = new Map(prev.friends.map((f) => [f.accountId, f.status]));
    for (const f of s.friends) {
      const was = before.get(f.accountId);
      // Only a real transition counts. A first-ever roster (no `was`) is not news — it's just state,
      // and treating it as news would spam the center with every existing friend on first connect.
      if (was && was === 'outgoing' && f.status === 'accepted') {
        useNotificationLogStore.getState().logEvent({
          key: `friend-ok:${f.accountId}`,
          kind: 'friend-accepted',
          title: f.displayName,
          content: 'принял вашу заявку в друзья',
          icon: '🤝',
          accountId: f.accountId,
        });
      }
    }
  });
};

/** Build the center's list: derived rows + logged transitions, newest first, read-state applied. */
export const selectNotifications = (): NotificationItem[] => {
  const social = useSocialStore.getState();
  const chat = useChatStore.getState();
  const missed = useMissedCallsStore.getState().missed;
  const log = useNotificationLogStore.getState().events;
  const read = new Set(social.readKeys);
  const now = Date.now();
  const rows: NotificationItem[] = [];

  for (const f of social.friends) {
    if (f.status !== 'incoming') continue;
    rows.push({
      key: `friend-req:${f.accountId}`,
      kind: 'friend-request',
      tone: 'system',
      title: f.displayName,
      content: 'хочет добавить вас в друзья',
      icon: '👤',
      avatar: f.avatarIcon ?? null,
      // The roster carries no request timestamp; sort these first by using "now" so a pending
      // request is never buried under old rows.
      at: now,
      read: read.has(`friend-req:${f.accountId}`),
      accountId: f.accountId,
    });
  }

  for (const inv of social.invites) {
    rows.push({
      key: `invite:${inv.code}`,
      kind: 'invite',
      tone: 'invite',
      title: inv.inviterName,
      content: `приглашает в ${inv.gameName}`,
      icon: '🎮',
      at: now,
      read: read.has(`invite:${inv.code}`),
      inviteCode: inv.code,
    });
  }

  for (const m of missed) {
    const key = `missed:${m.conversationId}:${m.at}`;
    rows.push({
      key,
      kind: 'missed-call',
      tone: 'system',
      title: m.fromName,
      content: m.busy ? 'звонил, пока вы были заняты' : `пропущенный ${m.type === 'video' ? 'видеозвонок' : 'звонок'}`,
      icon: '📞',
      at: m.at,
      // A missed call has its own `seen` flag (it predates server read-state) — honour either, so
      // opening the chat still counts as reading the notification.
      read: m.seen || read.has(key),
      conversationId: m.conversationId,
    });
  }

  for (const s of chat.sessions) {
    if (!s.unreadCount) continue;
    const last = s.messages[s.messages.length - 1];
    // Keyed on the newest message so a *later* message re-lights a conversation the user had read.
    const stamp = last?.createdAt ?? 0;
    const key = `msg:${s.id}:${stamp}`;
    rows.push({
      key,
      kind: 'message',
      tone: 'message',
      title: s.name,
      content: s.unreadCount === 1 ? (last?.text?.trim() || '📎 Вложение') : `${s.unreadCount} новых сообщения`,
      icon: '💬',
      avatar: s.avatar ?? null,
      at: stamp || now,
      read: read.has(key),
      conversationId: s.id,
    });
  }

  for (const e of log) {
    rows.push({
      key: e.key,
      kind: e.kind,
      tone: e.kind === 'achievement' ? 'achievement' : 'system',
      title: e.title,
      content: e.content,
      icon: e.icon,
      at: e.at,
      read: read.has(e.key),
      ...(e.accountId ? { accountId: e.accountId } : {}),
    });
  }

  return rows.filter((r) => now - r.at < MAX_AGE_MS).sort((a, b) => b.at - a.at);
};

/** Unread count for the bell and the tab badge — one formula, so they can never disagree. */
export const selectUnreadNotificationCount = (): number =>
  selectNotifications().reduce((n, r) => n + (r.read ? 0 : 1), 0);

/** React binding for the count. Subscribes to every source the list derives from — a plain call to
 *  `selectUnreadNotificationCount` reads stores outside React and would never re-render. */
export const useNotificationUnreadCount = (): number => {
  const friends = useSocialStore((s) => s.friends);
  const invites = useSocialStore((s) => s.invites);
  const readKeys = useSocialStore((s) => s.readKeys);
  const sessions = useChatStore((s) => s.sessions);
  const missed = useMissedCallsStore((s) => s.missed);
  const events = useNotificationLogStore((s) => s.events);
  return useMemo(
    () => selectUnreadNotificationCount(),
    [friends, invites, readKeys, sessions, missed, events],
  );
};
