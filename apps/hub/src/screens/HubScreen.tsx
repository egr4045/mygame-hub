import { useEffect, useState } from 'react';
import type { social } from '@mygame/protocol';
import { usePlatformStore } from '../platform/platformStore.js';
import { GAMES, type GameInfo } from '../platform/games.js';
import { LibrarySidebar } from '../components/LibrarySidebar.js';
import { GameDetailsView, type GameDetailsTab } from '../components/GameDetailsView.js';
import { enterAndPlayGame } from '../platform/enterGameFlow.js';
import { routeToInvite, routeToRoom } from '../platform/inviteRouting.js';
import { loadSession } from '@mygame/sdk';
import { useSocialStore } from '@mygame/sdk';
import { ProfileView } from '../components/ProfileView.js';
import { SettingsModal } from '../components/SettingsModal.js';
import { ContextMenu } from '@mygame/sdk';
import { ChatWidget, CallView, GameInviteModal, SocialDndProvider } from '@mygame/sdk';
import { FriendsWidget } from '@mygame/sdk';
import { ToastContainer } from '@mygame/sdk';
import { useMenuStore } from '@mygame/sdk';
import { useToastStore } from '@mygame/sdk';
import { createSuggestion } from '@mygame/sdk';
import { PermissionsModal, usePermissionsModal } from '@mygame/sdk';
import { NotificationCenter, useNotificationUnreadCount } from '@mygame/sdk';
import { useIsMobile } from '../platform/useIsMobile.js';
import { MobileHub } from '../mobile/MobileHub.js';

const PERMS_PROMPT_KEY = 'mygame.permsPromptSeen';

/** execCommand-based copy for browsers/contexts where navigator.clipboard is unavailable or denied. */
const copyViaTextarea = (text: string): boolean => {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
};

/**
 * Screen router: below 768px the hub renders a dedicated single-column mobile shell; wider viewports
 * get the desktop launcher untouched. Splitting at this boundary (rather than an early return inside
 * the desktop component) keeps each shell's hook set stable when the viewport flips across the
 * breakpoint — they mount/unmount as siblings instead of changing one component's hook count.
 */
export const HubScreen = (): JSX.Element => {
  const isMobile = useIsMobile();

  // First entry: offer the permissions/devices window once (closable, reopenable from settings).
  // Replaces the old auto-shown Telegram-link modal — TG linking still lives in the profile.
  useEffect(() => {
    try {
      if (localStorage.getItem(PERMS_PROMPT_KEY) === '1') return;
      localStorage.setItem(PERMS_PROMPT_KEY, '1');
    } catch {
      return; // no storage — don't risk nagging on every load
    }
    usePermissionsModal.getState().show();
  }, []);

  return (
    <>
      {isMobile ? <MobileHub /> : <DesktopHubScreen />}
      <PermissionsModal />
    </>
  );
};

const DesktopHubScreen = (): JSX.Element => {
  const selectGame = usePlatformStore((s) => s.selectGame);
  const logout = usePlatformStore((s) => s.logout);
  const account = usePlatformStore((s) => s.account);
  const me = useSocialStore((s) => s.me);
  const openMenu = useMenuStore((s) => s.openMenu);
  const addToast = useToastStore((s) => s.addToast);

  // One formula for the bell, the panel and the tab badge (badge.ts uses the same selector). The
  // three used to compute their own counts from different inputs, which is how the favicon kept
  // claiming a notification the user had already dealt with.
  const notificationCount = useNotificationUnreadCount();

  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'notifications' | 'account' | null>(null);
  const [bellOpen, setBellOpen] = useState(false);

  useEffect(() => {
    // Always clear activity when we are in the Hub
    useSocialStore.getState().setActivity(null);
  }, []);

  // Local state for library navigation (doesn't start the game yet)
  const [viewedGameId, setViewedGameId] = useState<string | null>(
    (GAMES.find((g) => g.status === 'playable') ?? GAMES[0])?.id ?? null,
  );
  const [gameDetailsTab, setGameDetailsTab] = useState<GameDetailsTab>('changelog');
  const [activeTab, setActiveTab] = useState<'library' | 'contact' | 'profile'>('library');

  const copyMyId = (myId: string): void => {
    const onCopied = (): void => addToast({ type: 'system', title: 'ID скопирован', content: myId, icon: '🔗' });
    const onFailed = (): void =>
      addToast({ type: 'system', title: 'Не удалось скопировать', content: `Скопируйте вручную: ${myId}`, icon: '⚠️' });
    const fallback = (): void => {
      if (copyViaTextarea(myId)) onCopied();
      else onFailed();
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(myId).then(onCopied, fallback);
    } else {
      fallback();
    }
  };

  // Same flow as the mobile shell (it also carries `?call=` so a call survives the navigation) —
  // don't re-inline it here, or the two drift apart.
  const handlePlay = (g: GameInfo): void => {
    enterAndPlayGame(g, selectGame);
  };

  const handleJoinActivity = (f: social.Friend): void => {
    if (!f.activity?.joinable || !f.activity.room) return;
    const game = GAMES.find((g) => g.id === f.activity!.game);
    if (!game) return;
    void routeToRoom(game, f.activity.room, 'player');
  };

  const openDiscussions = (g: GameInfo): void => {
    setViewedGameId(g.id);
    setGameDetailsTab('discussions');
    setActiveTab('library');
  };

  const viewedGame = GAMES.find(g => g.id === viewedGameId) || null;

  return (
    <SocialDndProvider>
      <div
        style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: 'var(--c-panel-solid)', color: 'var(--c-text-primary)', pointerEvents: 'auto' }}
        className="mygame-fade-in"
        onContextMenu={(e) => {
        e.preventDefault();
        openMenu(e.clientX, e.clientY, [
          { label: '🔄 Перезагрузить Хаб', action: () => window.location.reload() }
        ]);
      }}
    >
      {/* Global Steam-like Nav Bar */}
      <div style={{ background: 'var(--c-panel-deep)', display: 'flex', flexDirection: 'column' }}>

        {/* Top Row (System) */}
        <div style={{ height: 40, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', padding: '0 16px', fontSize: '11px', borderBottom: '1px solid var(--c-panel-border)' }}>

          <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
            {/* Bell + settings as one control group. The bell owns notifications (and, inside its
                panel, the notification prefs); this gear is hub-wide settings — two separate doors,
                which is the whole point of splitting them. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button
                className="hub-topbtn"
                data-open={bellOpen}
                aria-label="Уведомления"
                title="Уведомления"
                onClick={(e) => {
                  e.stopPropagation();
                  setBellOpen((o) => !o);
                  setSettingsTab(null);
                }}
              >
                🔔
                {notificationCount > 0 && (
                  <span className="hub-topbtn-badge">{notificationCount > 99 ? '99+' : notificationCount}</span>
                )}
              </button>
              <button
                className="hub-topbtn hub-topbtn-gear"
                data-open={settingsTab !== null}
                aria-label="Настройки"
                title="Настройки"
                onClick={(e) => {
                  e.stopPropagation();
                  // Opens on Аккаунт: notification prefs stay behind the bell, so landing here on
                  // «Уведомления» would make the two entry points feel interchangeable.
                  setSettingsTab((t) => (t === null ? 'account' : null));
                  setBellOpen(false);
                }}
              >
                <span className="hub-gear-glyph">⚙️</span>
              </button>
            </div>

            {/* Profile Menu */}
            <div
              style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
              onClick={(e) => {
                e.stopPropagation();
                const myCode = loadSession()?.friendCode ?? me?.accountId ?? account?.accountId ?? null;
                openMenu(e.clientX, e.clientY + 20, [
                  { label: '⚙️ Настройки Хаба', action: () => setSettingsTab('account') },
                  {
                    label: '🔗 Скопировать код друга',
                    action: () => {
                      if (!myCode) return;
                      copyMyId(myCode);
                    },
                  },
                  { separator: true, action: () => {} },
                  { label: '🚪 Выйти из аккаунта', action: () => setShowLogoutConfirm(true), danger: true }
                ]);
              }}
            >
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 700, color: 'var(--c-text-primary)' }}>{me?.displayName || 'Загрузка...'}</div>
              </div>
              <div style={{ width: 24, height: 24, borderRadius: 4, background: 'var(--c-panel-hover)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {me?.avatarIcon ? (
                  <img src={me.avatarIcon} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <span style={{ fontSize: 14, color: 'var(--c-text-muted)' }}>👤</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Main Nav Row */}
        <div className="mobile-nav" style={{ height: 64, display: 'flex', alignItems: 'center', padding: '0 24px', gap: 32, overflowX: 'auto', whiteSpace: 'nowrap' }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--c-text-primary)', letterSpacing: 2, marginRight: 24 }}>GAMEHUB</div>
          <NavTab label="БИБЛИОТЕКА" active={activeTab === 'library'} onClick={() => setActiveTab('library')} />
          <NavTab label="СВЯЗЬ С АВТОРОМ" active={activeTab === 'contact'} onClick={() => setActiveTab('contact')} />
          <NavTab label={me?.displayName?.toUpperCase() || 'ПРОФИЛЬ'} active={activeTab === 'profile'} onClick={() => setActiveTab('profile')} />
        </div>
      </div>

      {activeTab === 'library' && (
        <div className="mobile-split-view" style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          <LibrarySidebar
            selectedGameId={viewedGameId}
            onSelectGame={setViewedGameId}
            onPlay={handlePlay}
            onOpenDiscussions={openDiscussions}
          />
          <GameDetailsView game={viewedGame} onPlay={handlePlay} activeTab={gameDetailsTab} onTabChange={setGameDetailsTab} />
        </div>
      )}

      {activeTab === 'contact' && (
        <ContactAuthorView />
      )}

      {activeTab === 'profile' && (
        <ProfileView />
      )}

      {showLogoutConfirm && (
        <div className="hub-modal-scrim" style={{ zIndex: 1000 }}>
          <div className="mygame-fade-in" style={{ width: 400, background: 'var(--c-panel-solid)', border: '1px solid var(--c-panel-border)', borderRadius: 8, padding: 32, textAlign: 'center' }}>
            <h2 style={{ color: 'var(--c-text-primary)', margin: '0 0 16px 0', fontSize: 20 }}>Выход из аккаунта</h2>
            <p style={{ color: 'var(--c-text-muted)', marginBottom: 24, fontSize: 14 }}>Вы действительно хотите выйти из аккаунта?</p>
            <div style={{ display: 'flex', gap: 16, justifyContent: 'center' }}>
              <button className="hub-btn" onClick={() => setShowLogoutConfirm(false)} style={{ padding: '10px 24px' }}>Отмена</button>
              <button onClick={logout} style={{ background: 'var(--c-negative)', color: '#fff', border: 'none', padding: '10px 24px', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}>Выйти</button>
            </div>
          </div>
        </div>
      )}

      {settingsTab && (
        <SettingsModal
          initialTab={settingsTab}
          onClose={() => setSettingsTab(null)}
          onGoToProfile={() => setActiveTab('profile')}
        />
      )}

      {/* Anchored under the bell in the 40px system row. Routing into a room is ours, not the SDK's. */}
      <NotificationCenter
        open={bellOpen}
        onClose={() => setBellOpen(false)}
        anchor={{ top: 44, right: 16 }}
        onOpenInvite={(code) => {
          const inv = useSocialStore.getState().invites.find((i) => i.code === code);
          if (inv) void routeToInvite(inv);
        }}
        onOpenSettings={() => setSettingsTab('notifications')}
      />
      <FriendsWidget onJoinActivity={handleJoinActivity} />
      <ChatWidget hideLauncher />
      <CallView />
      <GameInviteModal />
      <ContextMenu />
      <ToastContainer />
      </div>
    </SocialDndProvider>
  );
};

const NavTab = ({ label, active, onClick }: { label: string, active: boolean, onClick: () => void }) => (
  <div
    onClick={onClick}
    className="hub-row-hover"
    style={{
      fontSize: '20px',
      fontWeight: 600,
      color: active ? 'var(--c-accent)' : 'var(--c-text-primary)',
      cursor: 'pointer',
      borderBottom: active ? '3px solid var(--c-accent)' : '3px solid transparent',
      paddingBottom: 4,
      transition: 'color var(--motion-fast)'
    }}
  >
    {label}
  </div>
);

const ContactAuthorView = (): JSX.Element => {
  const addToast = useToastStore((s) => s.addToast);
  const [idea, setIdea] = useState('');
  const [sending, setSending] = useState(false);

  const submitIdea = async (): Promise<void> => {
    const text = idea.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const created = await createSuggestion(text);
      if (created) {
        setIdea('');
        addToast({ type: 'system', title: 'Идея отправлена', content: 'Спасибо! Автор увидит её и ответит.', icon: '💡' });
      } else {
        addToast({ type: 'system', title: 'Не удалось отправить идею', content: 'Попробуйте ещё раз позже.', icon: '⚠️' });
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '20px 5%', overflowY: 'auto' }}>
      <h1 style={{ fontSize: 32, fontWeight: 800, color: 'var(--c-text-primary)', marginBottom: 32 }}>Связь с автором</h1>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 24 }}>
        <div className="hub-card" style={{ padding: 24 }}>
          <h2 style={{ fontSize: 24, color: 'var(--c-text-primary)', marginBottom: 12 }}>Предложить идею</h2>
          <p style={{ color: 'var(--c-text-muted)', marginBottom: 16 }}>Есть крутая идея для новой механики или игры? Напиши прямо сюда:</p>
          <textarea
            className="hub-input"
            placeholder="Опиши свою идею..."
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            style={{ width: '100%', height: 100, marginBottom: 16, resize: 'vertical' }}
          />
          <button
            className="hub-btn hub-btn-primary"
            disabled={!idea.trim() || sending}
            onClick={() => void submitIdea()}
            style={{ padding: '10px 20px' }}
          >
            {sending ? 'Отправка…' : 'Отправить автору'}
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div className="hub-card" style={{ padding: 24 }}>
            <h2 style={{ fontSize: 24, color: 'var(--c-text-primary)', marginBottom: 12 }}>Telegram автора</h2>
            <p style={{ color: 'var(--c-text-muted)', marginBottom: 16 }}>Предложения и вопросы пишите сюда:</p>
            <a href="https://t.me/egr4045" target="_blank" rel="noreferrer" style={{ display: 'inline-block', background: 'var(--c-accent)', color: '#fff', padding: '16px 24px', borderRadius: 8, textDecoration: 'none', fontWeight: 800, fontSize: 18, width: '100%', textAlign: 'center' }}>ПЕРЕЙТИ В TELEGRAM</a>
          </div>

          <div className="hub-card" style={{ padding: 24 }}>
            <h2 style={{ fontSize: 24, color: 'var(--c-text-primary)', marginBottom: 12 }}>Поддержать автора</h2>
            <p style={{ color: 'var(--c-text-muted)', marginBottom: 16 }}>Любая поддержка поможет оплачивать сервера и двигаться быстрее!</p>
            <div style={{ background: 'var(--c-panel-deep)', border: '1px dashed var(--c-panel-border)', padding: 16, borderRadius: 4, textAlign: 'center', color: 'var(--c-text-muted)', opacity: 0.7 }}>
              Реквизиты появятся позже
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
