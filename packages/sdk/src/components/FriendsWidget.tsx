import { useEffect, useRef, useState } from 'react';
import type { social } from '@mygame/protocol';
import { FriendsSidebar } from './FriendsSidebar.js';
import { useSocialStore } from '../state/socialStore.js';
import { useChatStore } from '../state/chatStore.js';

/**
 * The unified social launcher: a single **draggable** "Друзья и чат" button (online + unread badges)
 * that expands into the friends list and links to the messenger — replacing the old pair of separate
 * bottom buttons. Shipped in `@mygame/sdk` so any game embedding the SDK gets it via `mountOverlay()`;
 * the hub renders it directly (and hides ChatWidget's own launcher via `hideLauncher`).
 */
const POS_KEY = 'mygame.socialLauncher.pos';

const loadPos = (): { x: number; y: number } => {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (raw) return JSON.parse(raw) as { x: number; y: number };
  } catch {
    /* ignore */
  }
  // Default: bottom-right.
  return { x: typeof window !== 'undefined' ? window.innerWidth - 260 : 24, y: typeof window !== 'undefined' ? window.innerHeight - 52 : 24 };
};

export const FriendsWidget = ({
  onJoinActivity,
}: {
  /** See `FriendsSidebar`'s prop of the same name — only the hub passes one. */
  onJoinActivity?: ((f: social.Friend) => void) | undefined;
} = {}): JSX.Element => {
  const [isOpen, setIsOpen] = useState(false);
  const friends = useSocialStore((s) => s.friends);
  const onlineCount = friends.filter((f) => f.status === 'accepted' && f.presence === 'online').length;
  const totalUnread = useChatStore((s) => s.sessions.reduce((n, x) => n + (x.unreadCount ?? 0), 0));
  const toggleChat = useChatStore((s) => s.toggleChat);

  const [pos, setPos] = useState(loadPos);
  const [dragging, setDragging] = useState(false);
  const dragMeta = useRef<{ dx: number; dy: number; moved: boolean }>({ dx: 0, dy: 0, moved: false });

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent): void => {
      dragMeta.current.moved = true;
      const x = Math.max(8, Math.min(e.clientX - dragMeta.current.dx, window.innerWidth - 60));
      const y = Math.max(8, Math.min(e.clientY - dragMeta.current.dy, window.innerHeight - 40));
      setPos({ x, y });
    };
    const onUp = (): void => {
      setDragging(false);
      try {
        localStorage.setItem(POS_KEY, JSON.stringify(pos));
      } catch {
        /* ignore */
      }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [dragging, pos]);

  // The panel anchors to the launcher's corner; keep it on-screen (open upward from a low button).
  const panelStyle: React.CSSProperties = {
    position: 'fixed',
    left: Math.min(pos.x, (typeof window !== 'undefined' ? window.innerWidth : 360) - 328),
    bottom: typeof window !== 'undefined' ? Math.max(8, window.innerHeight - pos.y + 8) : 60,
    width: 320,
    height: 'min(500px, 70vh)',
    background: '#1b2838',
    borderRadius: 8,
    overflow: 'hidden',
    boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
    display: isOpen ? 'flex' : 'none',
    flexDirection: 'column',
    zIndex: 1001,
    pointerEvents: 'auto',
  };

  return (
    <>
      <div style={panelStyle}>
        <div style={{ background: '#171a21', padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#dcdedf' }}>Друзья</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              onClick={() => { setIsOpen(false); toggleChat(); }}
              title="Открыть мессенджер"
              style={{ background: '#2AABEE', border: 'none', color: '#fff', cursor: 'pointer', borderRadius: 5, padding: '4px 10px', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}
            >
              💬 Чаты{totalUnread > 0 ? ` · ${totalUnread}` : ''}
            </button>
            <button onClick={() => setIsOpen(false)} title="Свернуть" style={{ background: 'transparent', border: 'none', color: '#8f98a0', cursor: 'pointer', fontSize: 16 }}>
              ×
            </button>
          </div>
        </div>
        <div style={{ flex: 1, position: 'relative' }}>
          <FriendsSidebar inOverlay={true} onJoinActivity={onJoinActivity} />
        </div>
      </div>

      {/* The single draggable launcher. */}
      <button
        onMouseDown={(e) => {
          dragMeta.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y, moved: false };
          setDragging(true);
        }}
        onClick={() => {
          if (!dragMeta.current.moved) setIsOpen((o) => !o);
        }}
        title="Друзья и чат — перетащите, чтобы переместить"
        style={{
          position: 'fixed',
          left: pos.x,
          top: pos.y,
          zIndex: 1000,
          background: '#171a21',
          color: '#dcdedf',
          border: '1px solid #3d4450',
          borderRadius: 24,
          padding: '10px 16px',
          cursor: dragging ? 'grabbing' : 'grab',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
          pointerEvents: 'auto',
          userSelect: 'none',
        }}
      >
        <span style={{ fontSize: 15, fontWeight: 700 }}>💬 Друзья и чат</span>
        <span style={{ fontSize: 12, background: '#3ba55d', color: '#fff', padding: '2px 8px', borderRadius: 10, fontWeight: 700 }}>{onlineCount}</span>
        {totalUnread > 0 && (
          <span style={{ fontSize: 12, background: '#c0563f', color: '#fff', padding: '2px 8px', borderRadius: 10, fontWeight: 800 }}>{totalUnread}</span>
        )}
      </button>
    </>
  );
};
