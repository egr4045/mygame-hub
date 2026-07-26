/**
 * Mobile hub shell. Rendered by <HubScreen/> in place of the desktop layout when `useIsMobile()` is
 * true (see HubScreen.tsx). A full-viewport column: a slim app bar (wordmark + notifications bell +
 * avatar), a scrollable content area that swaps by the active bottom tab, and a fixed 3-tab bottom
 * bar (Игры / Друзья / Профиль). All the game/social/overlay logic is the shared SDK stores and hub
 * registries — this file only lays them out for a phone.
 */
import { useState } from 'react';
import {
  useSocialStore,
  useChatStore,
  useMissedCallsStore,
  ChatWidget,
  CallView,
  GameInviteModal,
  ContextMenu,
  ToastContainer,
  SocialDndProvider,
  NotificationCenter,
  useNotificationUnreadCount,
} from '@mygame/sdk';
import { routeToInvite } from '../platform/inviteRouting.js';
import { MobileGamesTab } from './MobileGamesTab.js';
import { MobileFriendsTab } from './MobileFriendsTab.js';
import { MobileProfileTab } from './MobileProfileTab.js';

type MobileTab = 'games' | 'friends' | 'profile';

const TABS: { id: MobileTab; label: string; icon: string }[] = [
  { id: 'games', label: 'Игры', icon: '🎮' },
  { id: 'friends', label: 'Друзья', icon: '👥' },
  { id: 'profile', label: 'Профиль', icon: '👤' },
];

export const MobileHub = (): JSX.Element => {
  const me = useSocialStore((s) => s.me);

  const [tab, setTab] = useState<MobileTab>('games');
  const [bellOpen, setBellOpen] = useState(false);

  // Same selector as the desktop bell and the tab badge — see the comment in HubScreen.
  const notificationCount = useNotificationUnreadCount();
  const allMissed = useMissedCallsStore((s) => s.missed);
  const unreadMessages = useChatStore((s) => s.sessions.reduce((n, x) => n + (x.unreadCount ?? 0), 0));
  // Server call-log rows already count as unread; only busy-line misses need adding on top.
  const totalUnread = unreadMessages + allMissed.filter((m) => m.busy && !m.seen).length;

  return (
    <SocialDndProvider>
      <div className="mhub-root mygame-fade-in">
        {/* App bar */}
        <div className="mhub-appbar">
          <span className="mhub-wordmark">GAMEHUB</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button className="mhub-iconbtn" aria-label="Мессенджер" onClick={() => useChatStore.getState().toggleChat()}>
              💬
              {totalUnread > 0 && <span className="mhub-badge">{totalUnread}</span>}
            </button>
            <button
              className="mhub-iconbtn"
              aria-label="Уведомления"
              onClick={(e) => {
                e.stopPropagation();
                setBellOpen((o) => !o);
              }}
            >
              🔔
              {notificationCount > 0 && <span className="mhub-badge">{notificationCount}</span>}
            </button>
            <button className="mhub-iconbtn" aria-label="Профиль" onClick={() => setTab('profile')} style={{ overflow: 'hidden' }}>
              {me?.avatarIcon ? (
                <img src={me.avatarIcon} alt="" style={{ width: 30, height: 30, borderRadius: '50%', objectFit: 'cover' }} />
              ) : (
                '👤'
              )}
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="mhub-content">
          {tab === 'games' && <MobileGamesTab />}
          {tab === 'friends' && <MobileFriendsTab />}
          {tab === 'profile' && <MobileProfileTab />}
        </div>

        {/* Bottom tab bar */}
        <nav className="mhub-tabbar">
          {TABS.map((t) => (
            <button key={t.id} className="mhub-tab" data-active={tab === t.id} onClick={() => setTab(t.id)}>
              <span className="mhub-tab-icon">{t.icon}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </nav>

        {/* Global overlays (chat, calls, menus, toasts) — the floating desktop FriendsWidget is
            intentionally omitted; the Друзья tab is its mobile replacement. */}
        {/* Full-width sheet under the app bar — 360px would overflow a phone. */}
        <NotificationCenter
          open={bellOpen}
          onClose={() => setBellOpen(false)}
          anchor={{ top: 56, right: 8 }}
          onOpenInvite={(code) => {
            const inv = useSocialStore.getState().invites.find((i) => i.code === code);
            if (inv) void routeToInvite(inv);
          }}
        />
        <ChatWidget hideLauncher />
        <CallView />
        <GameInviteModal />
        <ContextMenu />
        <ToastContainer />
      </div>
    </SocialDndProvider>
  );
};
