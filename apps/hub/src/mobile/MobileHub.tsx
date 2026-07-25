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
  useMenuStore,
  useChatStore,
  useMissedCallsStore,
  ChatWidget,
  CallView,
  ContextMenu,
  ToastContainer,
  SocialDndProvider,
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
  const friends = useSocialStore((s) => s.friends);
  const invites = useSocialStore((s) => s.invites);
  const { accept, dismissInvite } = useSocialStore.getState();
  const openMenu = useMenuStore((s) => s.openMenu);

  const [tab, setTab] = useState<MobileTab>('games');

  const incomingRequests = friends.filter((f) => f.status === 'incoming');
  const allMissed = useMissedCallsStore((s) => s.missed);
  const missedCalls = allMissed.filter((m) => !m.seen);
  const notificationCount = incomingRequests.length + invites.length + missedCalls.length;
  const unreadMessages = useChatStore((s) => s.sessions.reduce((n, x) => n + (x.unreadCount ?? 0), 0));
  // Server call-log rows already count as unread; only busy-line misses need adding on top.
  const totalUnread = unreadMessages + missedCalls.filter((m) => m.busy).length;

  const openBell = (e: React.MouseEvent): void => {
    const items =
      notificationCount === 0
        ? [{ label: '🔔 Нет новых уведомлений', action: () => {} }]
        : [
            ...incomingRequests.map((f) => ({
              label: `👤 Заявка от ${f.displayName} — принять`,
              action: () => accept(f.accountId),
            })),
            ...invites.map((inv) => ({
              label: `🎮 ${inv.inviterName}: ${inv.gameName} — присоединиться`,
              action: () => void routeToInvite(inv),
            })),
            ...missedCalls.map((mc) => ({
              label: `📵 Пропущенный звонок от ${mc.fromName} — открыть чат`,
              action: () => useChatStore.getState().openChat(mc.conversationId),
              danger: true,
            })),
          ];
    openMenu(e.clientX, e.clientY + 16, [
      ...items,
      ...(invites.length > 0
        ? [{ separator: true, action: () => {} }, { label: '🗑️ Скрыть приглашения', action: () => invites.forEach((inv) => dismissInvite(inv.code)) }]
        : []),
    ]);
  };

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
            <button className="mhub-iconbtn" aria-label="Уведомления" onClick={openBell}>
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
        <ChatWidget hideLauncher />
        <CallView />
        <ContextMenu />
        <ToastContainer />
      </div>
    </SocialDndProvider>
  );
};
