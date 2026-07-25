import { useRef, useState } from 'react';
import type { social } from '@mygame/protocol';
import { FriendsSidebar } from './FriendsSidebar.js';
import { useSocialStore } from '../state/socialStore.js';
import { useChatStore } from '../state/chatStore.js';
import { useMissedCallsStore, selectUnseenBusyMissed } from '../state/missedCallsStore.js';
import { mg, mgZ } from '../theme/tokens.js';
import { btn, countBadge, surfaceWindow } from '../theme/primitives.js';
import { useFloatingWindow } from '../hooks/useFloatingWindow.js';
import { useViewport } from '../hooks/useViewport.js';

/**
 * The unified social launcher: a single **draggable** "Друзья и чат" button (online + unread badges)
 * that expands into the friends list and links to the messenger — replacing the old pair of separate
 * bottom buttons. Shipped in `@mygame/sdk` so any game embedding the SDK gets it via `mountOverlay()`;
 * the hub renders it directly (and hides ChatWidget's own launcher via `hideLauncher`).
 *
 * Position is bottom-right anchored (useFloatingWindow): "N px above the bottom edge" survives any
 * window/taskbar geometry — the old top-anchored persistence could strand it behind the taskbar.
 */
const LAUNCHER_FALLBACK_SIZE = { w: 220, h: 44 };

export const FriendsWidget = ({
  onJoinActivity,
}: {
  /** See `FriendsSidebar`'s prop of the same name — only the hub passes one. */
  onJoinActivity?: ((f: social.Friend) => void) | undefined;
} = {}): JSX.Element => {
  const [isOpen, setIsOpen] = useState(false);
  const friends = useSocialStore((s) => s.friends);
  const onlineCount = friends.filter((f) => f.status === 'accepted' && f.presence === 'online').length;
  const unreadMessages = useChatStore((s) => s.sessions.reduce((n, x) => n + (x.unreadCount ?? 0), 0));
  // Server call-log rows already count as unread; only busy-line misses need adding on top.
  const unseenBusyMissed = useMissedCallsStore(selectUnseenBusyMissed);
  const totalUnread = unreadMessages + unseenBusyMissed;
  const toggleChat = useChatStore((s) => s.toggleChat);

  const vp = useViewport();
  const btnRef = useRef<HTMLButtonElement>(null);
  const { pos, dragging, moved, handleProps } = useFloatingWindow({
    key: 'launcher',
    anchor: 'bottom-right',
    legacyKey: 'mygame.socialLauncher.pos',
    defaultPos: (v, s) => ({ x: v.w - s.w - 24, y: v.h - s.h - 16 }),
    size: () =>
      btnRef.current
        ? { w: btnRef.current.offsetWidth, h: btnRef.current.offsetHeight }
        : LAUNCHER_FALLBACK_SIZE,
    // ≥ the button's own height, so the launcher can never hang off the bottom edge even partially.
    minVisible: 48,
  });

  // The panel anchors to the launcher's corner; keep it on-screen (open upward from a low button).
  const panelStyle: React.CSSProperties = {
    ...surfaceWindow,
    position: 'fixed',
    left: Math.max(8, Math.min(pos.x, vp.w - 328)),
    bottom: Math.max(8, vp.h - pos.y + 8),
    width: 320,
    height: 'min(500px, 70vh)',
    display: isOpen ? 'flex' : 'none',
    flexDirection: 'column',
    zIndex: mgZ.panel,
    pointerEvents: 'auto',
  };

  return (
    <>
      <div style={panelStyle}>
        <div style={{ background: mg.surfaceDeep, padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: mg.text }}>Друзья</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              onClick={() => { setIsOpen(false); toggleChat(); }}
              title="Открыть мессенджер"
              style={btn('primary')}
            >
              💬 Чаты{totalUnread > 0 ? ` · ${totalUnread}` : ''}
            </button>
            <button onClick={() => setIsOpen(false)} title="Свернуть" style={{ background: 'transparent', border: 'none', color: mg.textMuted, cursor: 'pointer', fontSize: 16 }}>
              ×
            </button>
          </div>
        </div>
        <div style={{ flex: 1, position: 'relative' }}>
          <FriendsSidebar inOverlay={true} onJoinActivity={onJoinActivity} />
        </div>
      </div>

      {/* The single draggable launcher (drag = useFloatingWindow pointer engine, tap = toggle). */}
      <button
        ref={btnRef}
        onPointerDown={handleProps.onPointerDown}
        onClick={() => {
          if (!moved.current) setIsOpen((o) => !o);
        }}
        title="Друзья и чат — перетащите, чтобы переместить"
        style={{
          position: 'fixed',
          left: pos.x,
          top: pos.y,
          zIndex: mgZ.launcher,
          background: mg.surfaceDeep,
          color: mg.text,
          border: `1px solid ${mg.border}`,
          borderRadius: mg.rPill,
          padding: '10px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          boxShadow: mg.shadowMd,
          fontFamily: mg.font,
          pointerEvents: 'auto',
          ...handleProps.style,
          cursor: dragging ? 'grabbing' : 'grab',
        }}
      >
        <span style={{ fontSize: 15, fontWeight: 700 }}>💬 Друзья и чат</span>
        <span style={countBadge('positive')}>{onlineCount}</span>
        {totalUnread > 0 && (
          <span style={countBadge('danger')}>{totalUnread}</span>
        )}
      </button>
    </>
  );
};
