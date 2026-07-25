/**
 * OS-level notifications (the browser Notification API). Everything here is opt-in and self-gating:
 * a `notify*` call fires only when (a) the API exists, (b) the user granted permission, (c) the
 * `systemNotifications` pref is on, and (d) the tab is hidden or unfocused — an in-view event never
 * double-notifies. No service worker: notifications live only while a tab is open (accepted scope).
 *
 * No store imports on purpose (chatStore imports this module — callbacks keep it cycle-free).
 */
import { useNotificationPrefsStore } from './state/notificationPrefsStore.js';
import { useToastStore } from './state/toastStore.js';

export const notificationsSupported = (): boolean =>
  typeof window !== 'undefined' && typeof Notification !== 'undefined';

export const notificationPermission = (): NotificationPermission =>
  notificationsSupported() ? Notification.permission : 'denied';

/** Must be called from a user gesture (settings toggle, prompt-toast button). */
export const requestNotificationPermission = async (): Promise<NotificationPermission> => {
  if (!notificationsSupported()) return 'denied';
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
};

const shouldNotify = (): boolean => {
  if (!notificationsSupported() || Notification.permission !== 'granted') return false;
  if (!useNotificationPrefsStore.getState().systemNotifications) return false;
  if (typeof document === 'undefined') return false;
  return document.visibilityState === 'hidden' || !document.hasFocus();
};

/** Live call notifications by conversation — closable when the ring ends. */
const callNotifications = new Map<string, Notification>();

const show = (
  title: string,
  options: NotificationOptions & { onOpen?: (() => void) | undefined; autoCloseMs?: number },
): Notification | null => {
  const { onOpen, autoCloseMs, ...rest } = options;
  try {
    const n = new Notification(title, rest);
    n.onclick = () => {
      try {
        window.focus();
      } catch {
        /* ignore */
      }
      onOpen?.();
      n.close();
    };
    if (autoCloseMs && autoCloseMs > 0) setTimeout(() => n.close(), autoCloseMs);
    return n;
  } catch {
    return null; // some platforms (Android Chrome without SW) throw on page-scoped notifications
  }
};

/** New chat message — tag-deduped per conversation so a burst collapses to one banner. */
export const notifyMessage = (p: {
  conversationId: string;
  title: string;
  body: string;
  avatar?: string | null | undefined;
  onOpen?: (() => void) | undefined;
}): void => {
  if (!shouldNotify()) return;
  show(p.title, {
    body: p.body,
    tag: `mygame-msg:${p.conversationId}`,
    ...(p.avatar ? { icon: p.avatar } : {}),
    silent: true, // the SDK plays its own sound — avoid double audio
    onOpen: p.onOpen,
    autoCloseMs: 8000,
  });
};

/** Incoming call — sticky (`requireInteraction`) for the whole 45–60s ring window. */
export const notifyCall = (p: {
  conversationId: string;
  fromName: string;
  type: 'audio' | 'video';
  onOpen?: (() => void) | undefined;
}): void => {
  if (!shouldNotify()) return;
  closeCallNotification(p.conversationId);
  const n = show(`Входящий звонок — ${p.fromName}`, {
    body: p.type === 'video' ? 'Видеозвонок · нажмите, чтобы открыть' : 'Аудиозвонок · нажмите, чтобы открыть',
    tag: `mygame-call:${p.conversationId}`,
    requireInteraction: true,
    onOpen: p.onOpen,
  });
  if (n) {
    callNotifications.set(p.conversationId, n);
    n.onclose = () => callNotifications.delete(p.conversationId);
  }
};

/** Close the sticky call banner (accept/decline/timeout/hangup/disconnect). */
export const closeCallNotification = (conversationId: string): void => {
  const n = callNotifications.get(conversationId);
  if (n) {
    callNotifications.delete(conversationId);
    try {
      n.close();
    } catch {
      /* ignore */
    }
  }
};

export const closeAllCallNotifications = (): void => {
  for (const id of [...callNotifications.keys()]) closeCallNotification(id);
};

const PROMPT_SEEN_KEY = 'mygame.notifPromptSeen';

/**
 * One-time-per-origin actionable toast offering to enable system notifications — the settings-less
 * path for embedded games (the hub also has a proper toggle in Settings). Fired on the first
 * notify-worthy event (an incoming call); the "Включить" tap is the required user gesture.
 */
export const maybeOfferSystemNotifications = (): void => {
  if (!notificationsSupported() || Notification.permission !== 'default') return;
  if (useNotificationPrefsStore.getState().systemNotifications) return;
  try {
    if (localStorage.getItem(PROMPT_SEEN_KEY) === '1') return;
    localStorage.setItem(PROMPT_SEEN_KEY, '1');
  } catch {
    return; // no storage — don't risk re-prompting every event
  }
  useToastStore.getState().addToast({
    type: 'system',
    title: 'Системные уведомления',
    content: 'Показывать звонки и сообщения, когда вкладка не активна?',
    icon: '🔔',
    duration: 15000,
    actions: [
      {
        label: 'Включить',
        primary: true,
        onClick: () =>
          void requestNotificationPermission().then((p) =>
            useNotificationPrefsStore.getState().setSystemNotifications(p === 'granted'),
          ),
      },
      { label: 'Не нужно', onClick: () => {} },
    ],
  });
};

export const notifyMissedCall = (p: {
  conversationId: string;
  fromName: string;
  onOpen?: (() => void) | undefined;
}): void => {
  if (!shouldNotify()) return;
  show(`Пропущенный звонок — ${p.fromName}`, {
    body: 'Нажмите, чтобы открыть чат',
    tag: `mygame-missed:${p.conversationId}`,
    onOpen: p.onOpen,
    autoCloseMs: 15000,
  });
};
