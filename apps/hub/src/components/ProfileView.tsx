import { useState, useRef, useEffect } from 'react';
import { usePlatformStore } from '../platform/platformStore.js';
import { useMenuStore, createTelegramLinkCode, getTelegramStatus, getAchievements } from '@mygame/sdk';

/**
 * Display catalog for CIVA's achievements — name/description/icon are presentation details the
 * platform's achievements API doesn't (and can't, being cross-game) know about; only the fact that
 * `gameId + achievementId` is unlocked is real (`mygame.achievements.list()`). A game with its own
 * achievements would keep its own such catalog.
 */
const CIVA_GAME_ID = 'civa';
const ACHIEVEMENTS = [
  { id: 'first_blood', name: 'Первая кровь', desc: 'Одержите свою первую победу.', icon: '🏆', color: '#ffd700' },
  { id: 'veteran', name: 'Ветеран', desc: 'Сыграйте 100 матчей.', icon: '⚔', color: '#c0c0c0' },
  { id: 'rich', name: 'Богач', desc: 'Соберите 10 000 золота.', icon: '💰', color: '#ffb347' },
  { id: 'social', name: 'Душа компании', desc: 'Добавьте 10 друзей.', icon: '🤝', color: '#66c0f4' },
  { id: 'night_owl', name: 'Сова', desc: 'Сыграйте матч после полуночи.', icon: '🦉', color: '#a020f0' },
];

export const ProfileView = (): JSX.Element => {
  const me = usePlatformStore((s) => s.account);
  const openMenu = useMenuStore((s) => s.openMenu);
  
  const [avatar, setAvatar] = useState<string | null>(null);
  const [wallpaper, setWallpaper] = useState<string | null>(null);
  const [titleAchievement, setTitleAchievement] = useState<string | null>(null);
  
  const [isChoosingAchievement, setIsChoosingAchievement] = useState(false);

  // Telegram linking state
  const [tgLinked, setTgLinked] = useState<boolean | null>(null);
  const [tgId, setTgId] = useState<string | undefined>(undefined);
  const [tgModal, setTgModal] = useState<{ code: string; url: string } | null>(null);

  // Real unlocked achievements (CIVA only — the showcase catalog above is CIVA-specific).
  const [unlockedIds, setUnlockedIds] = useState<Set<string>>(new Set());
  const refreshAchievements = () =>
    void getAchievements().then((res) => {
      const list = res?.achievements ?? [];
      setUnlockedIds(new Set(list.filter((a) => a.gameId === CIVA_GAME_ID).map((a) => a.achievementId)));
    });
  useEffect(refreshAchievements, []);

  useEffect(() => {
    void getTelegramStatus().then((s) => {
      if (s) {
        setTgLinked(s.linked);
        setTgId(s.telegramId);
      }
    });
  }, []);

  // While the link modal is open, poll for confirmation from the bot, then auto-close.
  useEffect(() => {
    if (!tgModal) return;
    const handle = window.setInterval(() => {
      void getTelegramStatus().then((s) => {
        if (s?.linked) {
          setTgLinked(true);
          setTgId(s.telegramId);
          setTgModal(null);
        }
      });
    }, 2500);
    const stop = window.setTimeout(() => window.clearInterval(handle), 120_000);
    return () => {
      window.clearInterval(handle);
      window.clearTimeout(stop);
    };
  }, [tgModal]);

  const startTelegramLink = async () => {
    const r = await createTelegramLinkCode();
    if (!r) {
      alert('Не удалось создать код привязки. Попробуйте позже.');
      return;
    }
    if (r.url) window.open(r.url, '_blank', 'noopener');
    setTgModal(r);
  };

  const avatarInputRef = useRef<HTMLInputElement>(null);
  const wallpaperInputRef = useRef<HTMLInputElement>(null);

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setAvatar(URL.createObjectURL(e.target.files[0]));
    }
  };

  const handleWallpaperChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setWallpaper(URL.createObjectURL(e.target.files[0]));
    }
  };

  const selectedAchiev = ACHIEVEMENTS.find(a => a.id === titleAchievement);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto', background: '#1b2838' }}>
      
      {/* Hidden file inputs */}
      <input type="file" ref={avatarInputRef} style={{ display: 'none' }} accept="image/*" onChange={handleAvatarChange} />
      <input type="file" ref={wallpaperInputRef} style={{ display: 'none' }} accept="image/*" onChange={handleWallpaperChange} />

      {/* Hero Section */}
      <div style={{ 
        position: 'relative', 
        minHeight: 300, 
        background: wallpaper ? `url(${wallpaper}) center/cover no-repeat` : 'linear-gradient(to bottom, #2a475e, #1b2838)',
        padding: '40px 10%',
        display: 'flex',
        alignItems: 'flex-end',
        gap: 32
      }}>
        {/* Dark overlay if wallpaper exists */}
        {wallpaper && <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, transparent 0%, #1b2838 100%)' }} />}

        {/* Avatar Container */}
        <div style={{ position: 'relative', zIndex: 10, cursor: 'pointer' }} onClick={() => avatarInputRef.current?.click()}>
          <div style={{ 
            width: 160, 
            height: 160, 
            background: avatar ? `url(${avatar}) center/cover` : '#3d4450', 
            borderRadius: 8,
            border: selectedAchiev ? `4px solid ${selectedAchiev.color}` : '2px solid #5c7e10',
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: avatar ? 0 : 48,
            color: '#fff'
          }}>
            {!avatar && (me?.displayName?.[0]?.toUpperCase() || '?')}
          </div>
          
          {/* Title Achievement Badge */}
          {selectedAchiev && (
            <div style={{ 
              position: 'absolute', 
              bottom: -16, 
              left: '50%', 
              transform: 'translateX(-50%)', 
              background: '#171a21',
              border: `2px solid ${selectedAchiev.color}`,
              color: '#fff',
              padding: '4px 12px',
              borderRadius: 16,
              fontSize: '12px',
              fontWeight: 800,
              whiteSpace: 'nowrap',
              boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
              display: 'flex',
              alignItems: 'center',
              gap: 6
            }}>
              <span style={{ fontSize: '16px' }}>{selectedAchiev.icon}</span> {selectedAchiev.name}
            </div>
          )}
          
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', opacity: 0, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'opacity 0.2s', fontWeight: 600 }}
               onMouseOver={(e) => e.currentTarget.style.opacity = '1'}
               onMouseOut={(e) => e.currentTarget.style.opacity = '0'}>
            Изменить
          </div>
        </div>

        {/* User Info */}
        <div style={{ position: 'relative', zIndex: 10, paddingBottom: selectedAchiev ? 16 : 0 }}>
          <h1 style={{ fontSize: 36, fontWeight: 800, color: '#fff', margin: 0, textShadow: '0 2px 8px rgba(0,0,0,0.8)' }}>
            {me?.displayName || 'Гость'}
          </h1>
          <div style={{ color: '#5c7e10', fontSize: '14px', fontWeight: 600, marginTop: 8, textShadow: '0 2px 4px rgba(0,0,0,0.8)' }}>
            В сети
          </div>
          
          <div style={{ display: 'flex', gap: 16, marginTop: 24 }}>
            <button 
              onClick={() => wallpaperInputRef.current?.click()}
              style={{ background: 'rgba(0,0,0,0.4)', color: '#fff', border: '1px solid #3d4450', padding: '8px 16px', borderRadius: 4, cursor: 'pointer', backdropFilter: 'blur(4px)' }}
            >
              Загрузить фон
            </button>
            <button 
              onClick={() => setIsChoosingAchievement(true)}
              style={{ background: 'rgba(0,0,0,0.4)', color: '#fff', border: '1px solid #3d4450', padding: '8px 16px', borderRadius: 4, cursor: 'pointer', backdropFilter: 'blur(4px)' }}
            >
              Выбрать титул
            </button>
            {tgLinked ? (
              <div
                title={tgId ? `Telegram chat ${tgId}` : undefined}
                style={{ background: 'rgba(92,126,16,0.25)', color: '#a3d928', border: '1px solid #5c7e10', padding: '8px 16px', borderRadius: 4, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}
              >
                <span>✈</span> Telegram привязан ✓
              </div>
            ) : (
              <button
                onClick={() => void startTelegramLink()}
                style={{ background: '#2AABEE', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 4, cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}
              >
                <span>✈</span> Привязать TG
              </button>
            )}
            <button
              disabled
              title="Скоро"
              style={{ background: '#4C75A3', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 4, cursor: 'not-allowed', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, opacity: 0.5 }}
            >
              <span>K</span> Привязать VK (скоро)
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div style={{ display: 'flex', gap: 32, padding: '40px 10%', flex: 1 }}>
        
        {/* Left Column (Activity) */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 4, padding: 24 }}>
            <h2 style={{ fontSize: '16px', fontWeight: 600, color: '#fff', marginBottom: 16 }}>НЕДАВНЯЯ АКТИВНОСТЬ</h2>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                <div style={{ width: 64, height: 64, background: '#2a475e', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32 }}>👑</div>
                <div>
                  <div style={{ color: '#fff', fontWeight: 600 }}>CIVA 2</div>
                  <div style={{ color: '#8f98a0', fontSize: '12px' }}>Сыграно 12 часов • Последний запуск: сегодня</div>
                </div>
              </div>
              
              <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                <div style={{ width: 64, height: 64, background: '#2a475e', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32 }}>🌍</div>
                <div>
                  <div style={{ color: '#fff', fontWeight: 600 }}>Leaders</div>
                  <div style={{ color: '#8f98a0', fontSize: '12px' }}>Сыграно 3 часа • Последний запуск: вчера</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column (Achievements Showcase) */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 4, padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 style={{ fontSize: '16px', fontWeight: 600, color: '#fff' }}>ВИТРИНА ДОСТИЖЕНИЙ</h2>
              <span style={{ color: '#8f98a0', fontSize: '14px' }}>{unlockedIds.size} из {ACHIEVEMENTS.length}</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))', gap: 16 }}>
              {ACHIEVEMENTS.map(ach => {
                const unlocked = unlockedIds.has(ach.id);
                return (
                <div key={ach.id} style={{
                  aspectRatio: '1/1',
                  background: '#171a21',
                  borderRadius: 8,
                  border: `2px solid ${unlocked ? ach.color : '#3d4450'}${unlocked ? '40' : ''}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 28,
                  cursor: 'pointer',
                  opacity: unlocked ? 1 : 0.35,
                  filter: unlocked ? 'none' : 'grayscale(1)',
                  transition: 'transform 0.2s'
                }}
                title={unlocked ? `${ach.name} - ${ach.desc}` : `${ach.name} (не получено) - ${ach.desc}`}
                onMouseOver={(e) => e.currentTarget.style.transform = 'scale(1.1)'}
                onMouseOut={(e) => e.currentTarget.style.transform = 'scale(1)'}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (!unlocked) return;
                  openMenu(e.clientX, e.clientY, [
                    { label: '👑 Сделать титульной', action: () => setTitleAchievement(ach.id) },
                    { label: '✈️ Поделиться в Telegram', action: () => alert('Поделились в ТГ') }
                  ]);
                }}
                >
                  {ach.icon}
                </div>
                );
              })}
            </div>
          </div>
        </div>

      </div>

      {/* Title Achievement Modal */}
      {isChoosingAchievement && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="civa-fade-in" style={{ width: 500, background: '#1b2838', border: '1px solid #3d4450', borderRadius: 8, padding: 24 }}>
            <h2 style={{ color: '#fff', margin: '0 0 24px 0', fontSize: 20 }}>Выберите титульную ачивку</h2>
            <p style={{ color: '#8f98a0', marginBottom: 24, fontSize: 14 }}>
              Выбранная ачивка будет отображаться в виде специальной рамки и значка поверх вашей аватарки во всех играх.
            </p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 400, overflowY: 'auto' }}>
              <div 
                onClick={() => { setTitleAchievement(null); setIsChoosingAchievement(false); }}
                style={{ background: !titleAchievement ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.3)', padding: 16, borderRadius: 4, cursor: 'pointer', color: '#fff' }}
              >
                Без титула
              </div>
              
              {ACHIEVEMENTS.filter(ach => unlockedIds.has(ach.id)).map(ach => (
                <div
                  key={ach.id}
                  onClick={() => { setTitleAchievement(ach.id); setIsChoosingAchievement(false); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 16,
                    background: titleAchievement === ach.id ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.3)',
                    padding: 16, borderRadius: 4, cursor: 'pointer',
                    border: titleAchievement === ach.id ? `1px solid ${ach.color}` : '1px solid transparent'
                  }}
                >
                  <div style={{ fontSize: 24 }}>{ach.icon}</div>
                  <div>
                    <div style={{ color: ach.color, fontWeight: 700 }}>{ach.name}</div>
                    <div style={{ color: '#8f98a0', fontSize: 12 }}>{ach.desc}</div>
                  </div>
                </div>
              ))}
            </div>

            <button 
              onClick={() => setIsChoosingAchievement(false)}
              style={{ marginTop: 24, width: '100%', background: '#3d4450', color: '#fff', border: 'none', padding: '12px', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}
            >
              Закрыть
            </button>
          </div>
        </div>
      )}

      {/* Telegram link modal */}
      {tgModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="civa-fade-in" style={{ width: 460, background: '#1b2838', border: '1px solid #3d4450', borderRadius: 8, padding: 32, textAlign: 'center' }}>
            <h2 style={{ color: '#fff', margin: '0 0 12px 0', fontSize: 22 }}>Привязка Telegram</h2>
            <p style={{ color: '#8f98a0', marginBottom: 20, fontSize: 14, lineHeight: 1.5 }}>
              Открой бота в Telegram и нажми <b>Start</b> — аккаунт привяжется автоматически.
              Если бот не открылся, отправь ему команду:
            </p>
            <div style={{ background: '#171a21', border: '1px dashed #3d4450', padding: 16, borderRadius: 4, color: '#fff', letterSpacing: 1, fontSize: 18, marginBottom: 20, fontFamily: 'monospace' }}>
              /start {tgModal.code}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {tgModal.url && (
                <a href={tgModal.url} target="_blank" rel="noreferrer" style={{ background: '#2AABEE', color: '#fff', padding: '12px', borderRadius: 4, textDecoration: 'none', fontWeight: 600 }}>
                  ✈ Открыть Telegram
                </a>
              )}
              <div style={{ color: '#8f98a0', fontSize: 13 }}>Ожидаем подтверждения от бота…</div>
              <button onClick={() => setTgModal(null)} style={{ background: 'transparent', color: '#8f98a0', border: 'none', padding: '8px', cursor: 'pointer', fontWeight: 600 }}>
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
