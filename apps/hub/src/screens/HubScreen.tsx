import { useEffect, useState } from 'react';
import type { social } from '@mygame/protocol';
import { usePlatformStore } from '../platform/platformStore.js';
import { GAMES, getGameOrigin, type GameInfo } from '../platform/games.js';
import { LibrarySidebar } from '../components/LibrarySidebar.js';
import { GameDetailsView, type GameDetailsTab } from '../components/GameDetailsView.js';
import { enterGame } from '../net/orchestratorClient.js';
import { routeToInvite, routeToRoom } from '../platform/inviteRouting.js';
import { getHandoff, recordGameEnter, loadSession } from '@mygame/sdk';
import { useSocialStore } from '@mygame/sdk';
import { ProfileView } from '../components/ProfileView.js';
import { SettingsModal } from '../components/SettingsModal.js';
import { ContextMenu } from '@mygame/sdk';
import { ChatWidget, CallView, SocialDndProvider } from '@mygame/sdk';
import { FriendsWidget } from '@mygame/sdk';
import { ToastContainer } from '@mygame/sdk';
import { useMenuStore } from '@mygame/sdk';
import { useToastStore } from '@mygame/sdk';
import { createTelegramLinkCode, getTelegramStatus, createSuggestion } from '@mygame/sdk';
import { useIsMobile } from '../platform/useIsMobile.js';
import { MobileHub } from '../mobile/MobileHub.js';

const TG_DISMISS_KEY = 'mygame:tg-link-dismissed';

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
  return isMobile ? <MobileHub /> : <DesktopHubScreen />;
};

const DesktopHubScreen = (): JSX.Element => {
  const selectGame = usePlatformStore((s) => s.selectGame);
  const logout = usePlatformStore((s) => s.logout);
  const account = usePlatformStore((s) => s.account);
  const me = useSocialStore((s) => s.me);
  const friends = useSocialStore((s) => s.friends);
  const invites = useSocialStore((s) => s.invites);
  const { accept, dismissInvite } = useSocialStore.getState();
  const incomingRequests = friends.filter((f) => f.status === 'incoming');
  const notificationCount = incomingRequests.length + invites.length;
  const openMenu = useMenuStore((s) => s.openMenu);
  const addToast = useToastStore((s) => s.addToast);

  const [showLinkModal, setShowLinkModal] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'notifications' | 'account' | null>(null);

  useEffect(() => {
    // Always clear activity when we are in the Hub
    useSocialStore.getState().setActivity(null);

    // Offer Telegram linking only when the account isn't linked yet and the user hasn't dismissed the offer.
    if (localStorage.getItem(TG_DISMISS_KEY) === '1') return;
    void getTelegramStatus().then((s) => {
      if (s && !s.linked) setShowLinkModal(true);
    });
  }, []);

  // Local state for library navigation (doesn't start the game yet)
  const [viewedGameId, setViewedGameId] = useState<string | null>(
    (GAMES.find((g) => g.status === 'playable') ?? GAMES[0])?.id ?? null,
  );
  const [gameDetailsTab, setGameDetailsTab] = useState<GameDetailsTab>('changelog');
  const [activeTab, setActiveTab] = useState<'library' | 'contact' | 'profile'>('library');

  const startTelegramLink = async (): Promise<void> => {
    const r = await createTelegramLinkCode();
    setShowLinkModal(false);
    if (r && r.url) {
      window.open(r.url, '_blank', 'noopener');
    } else {
      // Couldn't get a deep link — the profile tab carries the full linking flow as a fallback.
      setActiveTab('profile');
    }
  };

  const dismissLinkModal = (): void => {
    localStorage.setItem(TG_DISMISS_KEY, '1');
    setShowLinkModal(false);
  };

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

  const handlePlay = (g: GameInfo): void => {
    void recordGameEnter(g.id); // best-effort; a failed write just means stale "last played"
    const base = getGameOrigin(g);
    if (base) {
      void (async () => {
        await enterGame(g.id);
        const handoff = await getHandoff();
        window.location.href = handoff ? `${base}/?pt=${encodeURIComponent(handoff)}` : base;
      })();
    } else {
      selectGame(g.id);
    }
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
            {/* Notification Center */}
            <div
              style={{ position: 'relative', cursor: 'pointer', color: 'var(--c-text-primary)', fontSize: 16 }}
              onClick={(e) => {
                e.stopPropagation();
                const items = notificationCount === 0
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
                    ];
                openMenu(e.clientX, e.clientY + 20, [
                  ...items,
                  { separator: true, action: () => {} },
                  ...(invites.length > 0
                    ? [{ label: '🗑️ Скрыть приглашения', action: () => invites.forEach((inv) => dismissInvite(inv.code)) }]
                    : []),
                  { label: '⚙️ Настройки уведомлений', action: () => setSettingsTab('notifications') }
                ]);
              }}
            >
              🔔
              {notificationCount > 0 && (
                <div style={{ position: 'absolute', top: -6, right: -8, background: 'var(--c-accent)', color: '#fff', minWidth: 14, height: 14, padding: '0 3px', borderRadius: 7, fontSize: 9, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {notificationCount}
                </div>
              )}
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

      {showLinkModal && (
        <div className="hub-modal-scrim" style={{ zIndex: 1000 }}>
          <div className="mygame-fade-in" style={{ width: 480, background: 'var(--c-panel-solid)', border: '1px solid var(--c-panel-border)', borderRadius: 8, padding: 32, textAlign: 'center' }}>
            <h2 style={{ color: 'var(--c-text-primary)', margin: '0 0 16px 0', fontSize: 24 }}>Защитите свой аккаунт</h2>
            <p style={{ color: 'var(--c-text-muted)', marginBottom: 32, fontSize: 14, lineHeight: 1.5 }}>
              Привяжите Telegram или ВКонтакте прямо сейчас, чтобы не потерять прогресс. Это позволит вам мгновенно входить с любого устройства.
              <br/><br/>
              Вы всегда сможете сделать это позже в настройках Профиля.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <button onClick={() => void startTelegramLink()} style={{ background: 'var(--c-accent)', color: '#fff', border: 'none', padding: '14px', borderRadius: 4, cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <span>✈</span> Привязать Telegram
              </button>
              <button disabled title="Скоро" style={{ background: 'var(--c-accent-muted)', color: '#fff', border: 'none', padding: '14px', borderRadius: 4, cursor: 'not-allowed', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: 0.5 }}>
                <span>K</span> Привязать ВКонтакте (скоро)
              </button>
              <button onClick={dismissLinkModal} style={{ background: 'transparent', color: 'var(--c-text-muted)', border: 'none', padding: '14px', cursor: 'pointer', fontWeight: 600, marginTop: 8 }}>
                Позже
              </button>
            </div>
          </div>
        </div>
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

      <FriendsWidget onJoinActivity={handleJoinActivity} />
      <ChatWidget hideLauncher />
      <CallView />
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
