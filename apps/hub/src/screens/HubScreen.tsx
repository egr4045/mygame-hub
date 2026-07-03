import { useEffect, useState } from 'react';
import { usePlatformStore } from '../platform/platformStore.js';
import { GAMES, type GameInfo } from '../platform/games.js';
import { FriendsWidget } from '../components/FriendsWidget.js';
import { LibrarySidebar } from '../components/LibrarySidebar.js';
import { GameDetailsView } from '../components/GameDetailsView.js';
import { enterGame } from '../net/orchestratorClient.js';
import { getHandoff } from '@mygame/sdk';
import { useSocialStore } from '@mygame/sdk';
import { SteamOverlay } from '../components/SteamOverlay.js';
import { ProfileView } from '../components/ProfileView.js';
import { ContextMenu } from '@mygame/sdk';
import { ChatWidget } from '@mygame/sdk';
import { ToastContainer } from '@mygame/sdk';
import { useMenuStore } from '@mygame/sdk';
import { useToastStore } from '@mygame/sdk';

export const HubScreen = (): JSX.Element => {
  const selectGame = usePlatformStore((s) => s.selectGame);
  const logout = usePlatformStore((s) => s.logout);
  const me = useSocialStore((s) => s.me);
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
  const [activeTab, setActiveTab] = useState<'store' | 'library' | 'community' | 'contact' | 'profile'>('library');

  const handlePlay = (g: GameInfo): void => {
    if (g.externalPort) {
      void (async () => {
        await enterGame(g.id);
        const handoff = await getHandoff();
        const base = `${window.location.protocol}//${window.location.hostname}:${g.externalPort}`;
        window.location.href = handoff ? `${base}/?pt=${encodeURIComponent(handoff)}` : base;
      })();
    } else {
      selectGame(g.id);
    }
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
                openMenu(e.clientX, e.clientY + 20, [
                  { label: '🔔 Нет новых уведомлений', action: () => {} },
                  { separator: true, action: () => {} },
                  { label: '⚙️ Настройки уведомлений', action: () => alert('Открытие настроек...') }
                ]);
              }}
            >
              🔔
              <div style={{ position: 'absolute', top: -2, right: -4, background: '#2AABEE', width: 6, height: 6, borderRadius: '50%' }} />
            </div>

            {/* Profile Menu */}
            <div 
              style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }} 
              onClick={(e) => {
                e.stopPropagation();
                openMenu(e.clientX, e.clientY + 20, [
                  { label: '🟢 В сети', action: () => alert('Статус изменен') },
                  { label: '🌙 Не беспокоить', action: () => alert('Статус изменен') },
                  { separator: true, action: () => {} },
                  { label: '⚙️ Настройки Хаба', action: () => alert('Открыты глобальные настройки Хаба') },
                  { label: '🔗 Скопировать мой ID', action: () => navigator.clipboard.writeText('ID: 12345') },
                  { separator: true, action: () => {} },
                  { label: '🚪 Выйти из аккаунта', action: () => setShowLogoutConfirm(true), danger: true }
                ]);
              }}
            >
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 700, color: '#dcdedf' }}>{me?.displayName || 'Загрузка...'}</div>
              </div>
              <div style={{ width: 24, height: 24, borderRadius: 4, background: '#3d4450', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {me?.avatarUrl ? (
                  <img src={me.avatarUrl} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <span style={{ fontSize: 14, color: '#8f98a0' }}>👤</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Main Nav Row */}
        <div className="mobile-nav" style={{ height: 64, display: 'flex', alignItems: 'center', padding: '0 24px', gap: 32, overflowX: 'auto', whiteSpace: 'nowrap' }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#fff', letterSpacing: 2, marginRight: 24 }}>CIVA</div>
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
            <LibrarySidebar selectedGameId={viewedGameId} onSelectGame={setViewedGameId} />
            <GameDetailsView game={viewedGame} onPlay={handlePlay} />
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
              <button onClick={() => setShowLinkModal(false)} style={{ background: '#2AABEE', color: '#fff', border: 'none', padding: '14px', borderRadius: 4, cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <span>✈</span> Привязать Telegram
              </button>
              <button onClick={() => setShowLinkModal(false)} style={{ background: '#4C75A3', color: '#fff', border: 'none', padding: '14px', borderRadius: 4, cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <span>K</span> Привязать ВКонтакте
              </button>
              <button onClick={() => setShowLinkModal(false)} style={{ background: 'transparent', color: '#8f98a0', border: 'none', padding: '14px', cursor: 'pointer', fontWeight: 600, marginTop: 8 }}>
                Позже
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DEMO BUTTONS */}
      <div style={{ position: 'fixed', bottom: 16, left: 16, display: 'flex', gap: 8, zIndex: 100 }}>
        <button
          onClick={() => addToast({ type: 'message', title: 'Новое сообщение', content: 'S1mple: Пойдем катать?', icon: '💬' })}
          style={{ background: '#23262e', border: '1px solid #3d4450', color: '#fff', padding: '8px 12px', borderRadius: 4, cursor: 'pointer' }}>
          🔔 Тест: Сообщение
        </button>
        <button 
          onClick={() => addToast({ type: 'achievement', title: 'Достижение получено', content: 'Первая кровь (CIVA 2)', icon: '🏆' })}
          style={{ background: '#23262e', border: '1px solid #3d4450', color: '#fff', padding: '8px 12px', borderRadius: 4, cursor: 'pointer' }}>
          🔔 Тест: Ачивка
        </button>
      </div>

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

      <FriendsWidget />
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
