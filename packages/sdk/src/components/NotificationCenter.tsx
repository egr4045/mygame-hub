/**
 * The 🔔 notification center — a real panel, replacing the context menu the bell used to open.
 *
 * Why a component and not a menu: a context menu can hold only labels and a single action each, which
 * is how "заявка в друзья" ended up accept-only with no way to decline, and why it looked nothing like
 * the rest of the UI. Rows here carry an avatar, a timestamp, and as many actions as the kind needs.
 *
 * Read/unread is server-side (`socialStore.readKeys`); this component only ever *marks*. Rows are
 * split into НОВЫЕ / ПРОСМОТРЕННЫЕ rather than being silently dropped once read, so "все недавние
 * уведомления" stays true.
 *
 * Controlled by the host (the hub owns the bell button in its own top bar), so there is no launcher
 * of its own — pass `open` / `onClose`.
 */
import { useEffect, useMemo, useRef } from 'react';
import { mg, mgZ } from '../theme/tokens.js';
import { btn, iconBtn, surfaceWindow } from '../theme/primitives.js';
import { useSocialStore } from '../state/socialStore.js';
import { useChatStore } from '../state/chatStore.js';
import { useMissedCallsStore } from '../state/missedCallsStore.js';
import {
  selectNotifications,
  useNotificationLogStore,
  type NotificationItem,
} from '../state/notificationsStore.js';

const accentFor = (tone: NotificationItem['tone']): string =>
  tone === 'achievement' ? mg.achievement : tone === 'invite' ? mg.positive : tone === 'message' ? mg.accent : mg.textMuted;

const sectionLabel: React.CSSProperties = {
  fontSize: 11,
  color: mg.textMuted,
  textTransform: 'uppercase',
  fontWeight: 700,
  letterSpacing: 0.5,
  margin: '10px 8px 4px',
};

/** Relative and short — an exact clock time is noise for a list you scan. */
const ago = (at: number): string => {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 60) return 'только что';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} мин`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ч`;
  const d = Math.round(h / 24);
  return d === 1 ? 'вчера' : `${d} дн`;
};

export interface NotificationCenterProps {
  open: boolean;
  onClose: () => void;
  /** Where to pin the panel's top-right corner (the bell's position in the host's own chrome). */
  anchor?: { top: number; right: number };
  /** Routing into a game room is the host's job (the SDK has no router). Omit to hide the action. */
  onOpenInvite?: (code: string) => void;
  /** Open the notification-prefs UI — also host-owned. */
  onOpenSettings?: () => void;
}

export const NotificationCenter = ({
  open,
  onClose,
  anchor,
  onOpenInvite,
  onOpenSettings,
}: NotificationCenterProps): JSX.Element => {
  // Subscribe to every source the list is derived from, so the panel re-renders when any of them
  // moves. `selectNotifications` then reads them fresh.
  const friends = useSocialStore((s) => s.friends);
  const invites = useSocialStore((s) => s.invites);
  const readKeys = useSocialStore((s) => s.readKeys);
  const sessions = useChatStore((s) => s.sessions);
  const missed = useMissedCallsStore((s) => s.missed);
  const events = useNotificationLogStore((s) => s.events);

  const accept = useSocialStore((s) => s.accept);
  const decline = useSocialStore((s) => s.decline);
  const markRead = useSocialStore((s) => s.markNotificationsRead);
  const openChat = useChatStore((s) => s.openChat);

  const items = useMemo(
    () => selectNotifications(),
    [friends, invites, readKeys, sessions, missed, events],
  );
  const unread = items.filter((i) => !i.read);
  const seen = items.filter((i) => i.read);

  const panelRef = useRef<HTMLDivElement>(null);

  // Click-away and Esc. Pointerdown (not click) so it closes before the click lands on whatever is
  // underneath, matching how the old context menu behaved.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent): void => {
      if (!panelRef.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return <></>;

  const row = (n: NotificationItem): JSX.Element => {
    const accent = accentFor(n.tone);
    const goto = (): void => {
      markRead([n.key]);
      if (n.conversationId) openChat(n.conversationId);
      else if (n.inviteCode && onOpenInvite) onOpenInvite(n.inviteCode);
      else return;
      onClose();
    };
    const navigable = !!n.conversationId || (!!n.inviteCode && !!onOpenInvite);

    return (
      <div
        key={n.key}
        onClick={navigable ? goto : () => markRead([n.key])}
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 10,
          padding: '10px 12px 10px 16px',
          borderRadius: mg.rMd,
          margin: '2px 4px',
          cursor: navigable ? 'pointer' : 'default',
          background: n.read ? 'transparent' : mg.rowHover,
          opacity: n.read ? 0.65 : 1,
        }}
      >
        {/* Accent bar only while unread — it is the "new" affordance, not decoration. */}
        {!n.read && (
          <div style={{ position: 'absolute', left: 0, top: 6, bottom: 6, width: 3, borderRadius: 2, background: accent }} />
        )}
        <div
          style={{
            flexShrink: 0,
            width: 36,
            height: 36,
            borderRadius: n.kind === 'invite' || n.kind === 'achievement' ? mg.rMd : '50%',
            background: mg.surfaceRaised,
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 18,
          }}
        >
          {n.avatar && /^(https?:|data:|\/)/.test(n.avatar) ? (
            <img src={n.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            n.avatar || n.icon
          )}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: mg.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {n.title}
            </span>
            <span style={{ fontSize: 10, color: mg.textMuted, flexShrink: 0, marginLeft: 'auto' }}>{ago(n.at)}</span>
          </div>
          <div
            style={{
              fontSize: 12,
              color: mg.textMuted,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {n.content}
          </div>

          {/* A friend request is actionable from here — the whole reason the old menu was wrong. */}
          {n.kind === 'friend-request' && n.accountId && (
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  accept(n.accountId!);
                  markRead([n.key]);
                }}
                style={{ ...btn('primary'), padding: '4px 12px' }}
              >
                ✓ Принять
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  decline(n.accountId!);
                  markRead([n.key]);
                }}
                style={{ ...btn('danger'), padding: '4px 12px' }}
              >
                ✕ Отклонить
              </button>
            </div>
          )}

          {n.kind === 'invite' && n.inviteCode && onOpenInvite && (
            <div style={{ marginTop: 8 }}>
              <button onClick={(e) => { e.stopPropagation(); goto(); }} style={{ ...btn('primary'), padding: '4px 12px' }}>
                🎮 Присоединиться
              </button>
            </div>
          )}

          {n.kind === 'missed-call' && n.conversationId && (
            <div style={{ marginTop: 8 }}>
              <button onClick={(e) => { e.stopPropagation(); goto(); }} style={{ ...btn('neutral'), padding: '4px 12px' }}>
                ↩ Открыть чат
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div
      ref={panelRef}
      className="mygame-fade-in"
      style={{
        ...surfaceWindow,
        position: 'fixed',
        top: anchor?.top ?? 48,
        right: anchor?.right ?? 16,
        width: 360,
        maxWidth: 'calc(100vw - 24px)',
        maxHeight: 'min(560px, 75vh)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: mgZ.panel,
        pointerEvents: 'auto',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 8px 10px 14px',
          background: mg.surfaceDeep,
          borderBottom: `1px solid ${mg.border}`,
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 800, color: mg.text }}>Уведомления</span>
        {unread.length > 0 && (
          <button
            onClick={() => markRead(unread.map((n) => n.key))}
            style={{ ...btn('ghost'), padding: '4px 8px', marginLeft: 'auto' }}
            title="Отметить все прочитанными"
          >
            Прочитать все
          </button>
        )}
        {onOpenSettings && (
          <button
            onClick={() => {
              onOpenSettings();
              onClose();
            }}
            style={{ ...iconBtn(28), marginLeft: unread.length > 0 ? 0 : 'auto' }}
            title="Настройки уведомлений"
          >
            ⚙️
          </button>
        )}
        <button onClick={onClose} style={iconBtn(28)} title="Закрыть">
          ✕
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0 8px' }}>
        {items.length === 0 && (
          <div style={{ padding: '32px 16px', textAlign: 'center', color: mg.textMuted, fontSize: 13 }}>
            🔔 Пока ничего нового
          </div>
        )}
        {unread.length > 0 && (
          <>
            <div style={sectionLabel}>Новые ({unread.length})</div>
            {unread.map(row)}
          </>
        )}
        {seen.length > 0 && (
          <>
            <div style={sectionLabel}>Просмотренные</div>
            {seen.map(row)}
          </>
        )}
      </div>
    </div>
  );
};
