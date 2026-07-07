import { useEffect, useState } from 'react';
import type { social } from '@mygame/protocol';
import { usePlatformStore } from '../platform/platformStore.js';
import { GAMES, getGameOrigin, type GameInfo } from '../platform/games.js';
import { LibrarySidebar } from '../components/LibrarySidebar.js';
import { GameDetailsView, type GameDetailsTab } from '../components/GameDetailsView.js';
import { enterGame } from '../net/orchestratorClient.js';
import { routeToInvite, routeToRoom } from '../platform/inviteRouting.js';
import { getHandoff, recordGameEnter } from '@mygame/sdk';
import { useSocialStore } from '@mygame/sdk';
import { SteamOverlay } from '../components/SteamOverlay.js';
import { ProfileView } from '../components/ProfileView.js';
import { ContextMenu } from '@mygame/sdk';
import { ChatWidget } from '@mygame/sdk';
import { FriendsWidget } from '@mygame/sdk';
import { ToastContainer } from '@mygame/sdk';
import { useMenuStore } from '@mygame/sdk';
import { useToastStore } from '@mygame/sdk';

export const HubScreen = (): JSX.Element => {
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

  useEffect(() => {
    // Show one-time modal per session
    if (!sessionStorage.getItem('link_prompt_shown')) {
      setShowLinkModal(true);
      sessionStorage.setItem('link_prompt_shown', 'true');
    }
  }, []);
  
  // Local state for library navigation (doesn't start the game yet)
  const [viewedGameId, setViewedGameId] = useState<string | null>(GAMES[0]?.id ?? null);
  const [gameDetailsTab, setGameDetailsTab] = useState<GameDetailsTab>('changelog');
  const [activeTab, setActiveTab] = useState<'store' | 'library' | 'community' | 'contact' | 'profile'>('library');

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
    <div 
      style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: '#1b2838', color: '#dcdedf', fontFamily: 'Motiva Sans, Arial, Helvetica, sans-serif', pointerEvents: 'auto' }} 
      className="civa-fade-in"
      onContextMenu={(e) => {
        e.preventDefault();
        openMenu(e.clientX, e.clientY, [
          { label: '🔄 Перезагрузить Хаб', action: () => window.location.reload() }
        ]);
      }}
    >
      {/* Global Steam-like Nav Bar */}
      <div style={{ background: '#171a21', display: 'flex', flexDirection: 'column' }}>
        
        {/* Top Row (System) */}
        <div style={{ height: 40, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', padding: '0 16px', fontSize: '11px', borderBottom: '1px solid #3d4450' }}>

          <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
            {/* Notification Center */}
            <div
              style={{ position: 'relative', cursor: 'pointer', color: '#dcdedf', fontSize: 16 }}
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
                  { label: '⚙️ Настройки уведомлений', action: () => addToast({ type: 'system', title: 'Настройки уведомлений', content: 'Скоро', icon: '⚙️' }) }
                ]);
              }}
            >
              🔔
              {notificationCount > 0 && (
                <div style={{ position: 'absolute', top: -6, right: -8, background: '#2AABEE', color: '#fff', minWidth: 14, height: 14, padding: '0 3px', borderRadius: 7, fontSize: 9, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {notificationCount}
                </div>
              )}
            </div>

            {/* Profile Menu */}
            <div 
              style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }} 
              onClick={(e) => {
                e.stopPropagation();
                const myId = me?.accountId ?? account?.accountId ?? null;
                openMenu(e.clientX, e.clientY + 20, [
                  { label: '⚙️ Настройки Хаба', action: () => addToast({ type: 'system', title: 'Настройки Хаба', content: 'Скоро', icon: '⚙️' }) },
                  {
                    label: '🔗 Скопировать мой ID',
                    action: () => {
                      if (!myId) return;
                      void navigator.clipboard?.writeText(myId);
                      addToast({ type: 'system', title: 'ID скопирован', content: myId, icon: '🔗' });
                    },
                  },
                  { separator: true, action: () => {} },
                  { label: '🚪 Выйти из аккаунта', action: () => setShowLogoutConfirm(true), danger: true }
                ]);
              }}
            >
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 700, color: '#dcdedf' }}>{me?.displayName || 'Загрузка...'}</div>
              </div>
              <div style={{ width: 24, height: 24, borderRadius: 4, background: '#3d4450', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {me?.avatarIcon ? (
                  <img src={me.avatarIcon} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <span style={{ fontSize: 14, color: '#8f98a0' }}>👤</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Main Nav Row */}
        <div className="mobile-nav" style={{ height: 64, display: 'flex', alignItems: 'center', padding: '0 24px', gap: 32, overflowX: 'auto', whiteSpace: 'nowrap' }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#fff', letterSpacing: 2, marginRight: 24 }}>GAMEHUB</div>
          <NavTab label="БИБЛИОТЕКА" active={activeTab === 'library'} onClick={() => setActiveTab('library')} />
          <NavTab label="СВЯЗЬ С АВТОРОМ" active={activeTab === 'contact'} onClick={() => setActiveTab('contact')} />
          <NavTab label={me?.displayName?.toUpperCase() || 'ПРОФИЛЬ'} active={activeTab === 'profile'} onClick={() => setActiveTab('profile')} />
        </div>
      </div>

      {activeTab === 'library' && (
        <>
          {/* Library Sub-nav */}
          <div style={{ height: 40, background: 'linear-gradient(to right, #242c3d 0%, #1b2838 100%)', display: 'flex', alignItems: 'center', padding: '0 24px', gap: 24, fontSize: '13px', fontWeight: 600, color: '#dcdedf' }}>
            <span style={{ color: '#fff', cursor: 'pointer' }}>ГЛАВНАЯ</span>
            <span style={{ color: '#8f98a0', cursor: 'pointer' }}>КОЛЛЕКЦИИ</span>
          </div>

          {/* Split View Content */}
          <div className="mobile-split-view" style={{ flex: 1, display: 'flex', minHeight: 0 }}>
            <LibrarySidebar
              selectedGameId={viewedGameId}
              onSelectGame={setViewedGameId}
              onPlay={handlePlay}
              onOpenDiscussions={openDiscussions}
            />
            <GameDetailsView game={viewedGame} onPlay={handlePlay} activeTab={gameDetailsTab} onTabChange={setGameDetailsTab} />
          </div>
        </>
      )}

      {activeTab === 'contact' && (
        <ContactAuthorView />
      )}

      {activeTab === 'profile' && (
        <ProfileView />
      )}

      {showLinkModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="civa-fade-in" style={{ width: 480, background: '#1b2838', border: '1px solid #3d4450', borderRadius: 8, padding: 32, textAlign: 'center' }}>
            <h2 style={{ color: '#fff', margin: '0 0 16px 0', fontSize: 24 }}>Защитите свой аккаунт</h2>
            <p style={{ color: '#8f98a0', marginBottom: 32, fontSize: 14, lineHeight: 1.5 }}>
              Привяжите Telegram или ВКонтакте прямо сейчас, чтобы не потерять прогресс. Это позволит вам мгновенно входить с любого устройства.
              <br/><br/>
              Вы всегда сможете сделать это позже в настройках Профиля.
            </p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <button onClick={() => { setShowLinkModal(false); setActiveTab('profile'); }} style={{ background: '#2AABEE', color: '#fff', border: 'none', padding: '14px', borderRadius: 4, cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <span>✈</span> Привязать Telegram
              </button>
              <button disabled title="Скоро" style={{ background: '#4C75A3', color: '#fff', border: 'none', padding: '14px', borderRadius: 4, cursor: 'not-allowed', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: 0.5 }}>
                <span>K</span> Привязать ВКонтакте (скоро)
              </button>
              <button onClick={() => setShowLinkModal(false)} style={{ background: 'transparent', color: '#8f98a0', border: 'none', padding: '14px', cursor: 'pointer', fontWeight: 600, marginTop: 8 }}>
                Позже
              </button>
            </div>
          </div>
        </div>
      )}

      {showLogoutConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="civa-fade-in" style={{ width: 400, background: '#1b2838', border: '1px solid #3d4450', borderRadius: 8, padding: 32, textAlign: 'center' }}>
            <h2 style={{ color: '#fff', margin: '0 0 16px 0', fontSize: 20 }}>Выход из аккаунта</h2>
            <p style={{ color: '#8f98a0', marginBottom: 24, fontSize: 14 }}>Вы действительно хотите выйти из аккаунта?</p>
            <div style={{ display: 'flex', gap: 16, justifyContent: 'center' }}>
              <button onClick={() => setShowLogoutConfirm(false)} style={{ background: '#3d4450', color: '#fff', border: 'none', padding: '10px 24px', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}>Отмена</button>
              <button onClick={logout} style={{ background: '#ff5c5c', color: '#fff', border: 'none', padding: '10px 24px', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}>Выйти</button>
            </div>
          </div>
        </div>
      )}

      <FriendsWidget onJoinActivity={handleJoinActivity} />
      <ChatWidget />
      <ContextMenu />
      <ToastContainer />
    </div>
  );
};

const NavTab = ({ label, active, onClick }: { label: string, active: boolean, onClick: () => void }) => (
  <div 
    onClick={onClick}
    style={{ 
      fontSize: '20px', 
      fontWeight: 600, 
      color: active ? '#1a9fff' : '#dcdedf', 
      cursor: 'pointer', 
      borderBottom: active ? '3px solid #1a9fff' : '3px solid transparent', 
      paddingBottom: 4,
      transition: 'color 0.1s'
    }}
    onMouseOver={(e) => !active && (e.currentTarget.style.color = '#fff')}
    onMouseOut={(e) => !active && (e.currentTarget.style.color = '#dcdedf')}
  >
    {label}
  </div>
);

const ContactAuthorView = () => (
  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '20px 5%', overflowY: 'auto' }}>
    <h1 style={{ fontSize: 32, fontWeight: 800, color: '#fff', marginBottom: 32 }}>Связь с автором</h1>
    
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 24 }}>
      <div style={{ background: 'rgba(0,0,0,0.3)', padding: 24, borderRadius: 8, border: '1px solid #3d4450' }}>
        <h2 style={{ fontSize: 24, color: '#fff', marginBottom: 12 }}>Предложить идею</h2>
        <p style={{ color: '#8f98a0', marginBottom: 16 }}>Есть крутая идея для новой механики или игры? Напиши прямо сюда:</p>
        <textarea placeholder="Опиши свою идею..." style={{ width: '100%', height: 100, background: '#171a21', border: '1px solid #3d4450', borderRadius: 4, padding: 12, color: '#fff', marginBottom: 16, resize: 'vertical' }} />
        <button style={{ background: '#1a9fff', border: 'none', color: '#fff', padding: '10px 20px', borderRadius: 4, fontWeight: 600, cursor: 'pointer' }}>Отправить автору</button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div style={{ background: 'rgba(0,0,0,0.3)', padding: 24, borderRadius: 8, border: '1px solid #3d4450' }}>
          <h2 style={{ fontSize: 24, color: '#fff', marginBottom: 12 }}>Telegram автора</h2>
          <p style={{ color: '#8f98a0', marginBottom: 16 }}>Следи за новостями, багами и разработкой:</p>
          <a href="https://t.me/egr4045" target="_blank" rel="noreferrer" style={{ display: 'inline-block', background: '#2AABEE', color: '#fff', padding: '16px 24px', borderRadius: 8, textDecoration: 'none', fontWeight: 800, fontSize: 18, width: '100%', textAlign: 'center' }}>ПЕРЕЙТИ В TELEGRAM</a>
        </div>

        <div style={{ background: 'rgba(0,0,0,0.3)', padding: 24, borderRadius: 8, border: '1px solid #3d4450' }}>
          <h2 style={{ fontSize: 24, color: '#fff', marginBottom: 12 }}>Поддержать автора</h2>
          <p style={{ color: '#8f98a0', marginBottom: 16 }}>Любая поддержка поможет оплачивать сервера и двигаться быстрее!</p>
          <div style={{ background: '#171a21', border: '1px dashed #3d4450', padding: 16, borderRadius: 4, textAlign: 'center', color: '#fff', letterSpacing: 2, fontSize: 18 }}>
            XXXX XXXX XXXX XXXX (Временно недоступно)
          </div>
        </div>
      </div>
    </div>
  </div>
);
