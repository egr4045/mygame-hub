import { useState, useRef, useEffect } from 'react';
import { usePlatformStore } from '../platform/platformStore.js';
import {
  useSocialStore,
  useToastStore,
  createTelegramLinkCode,
  getTelegramStatus,
  getAchievements,
  getGameStats,
  getProfile,
  setAvatar as apiSetAvatar,
  setWallpaper as apiSetWallpaper,
  setTitleAchievement as apiSetTitleAchievement,
} from '@mygame/sdk';
import type { GameStat, social } from '@mygame/protocol';
import { useAchievementCatalogs } from '../platform/achievementsCatalog.js';
import { GAMES } from '../platform/games.js';
import { formatLastPlayed, formatPlaytime } from '../platform/statsFormat.js';

/** Human game name for a gameId, falling back to the id for games not in the local registry. */
const gameLabel = (gameId: string): string => GAMES.find((g) => g.id === gameId)?.name ?? gameId;

/** Reads a File as a data URL (what the profile API stores/serves). */
const readAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

/** Matches the server's per-route body cap (4MB) with headroom for base64 + JSON overhead. */
const MAX_IMAGE_BYTES = 2_500_000;

const errorToast = (content: string): void =>
  useToastStore.getState().addToast({ type: 'system', title: 'Профиль', content, icon: '⚠️' });

export const ProfileView = (): JSX.Element => {
  const me = usePlatformStore((s) => s.account);

  const [avatar, setAvatar] = useState<string | null>(null);
  const [wallpaper, setWallpaper] = useState<string | null>(null);
  // The equipped title, now a full cross-game reference (was CIVA-only) so any game's achievement works.
  const [titleAchievement, setTitleAchievement] = useState<{ gameId: string; achievementId: string } | null>(null);
  const { defOf } = useAchievementCatalogs();

  const [isChoosingAchievement, setIsChoosingAchievement] = useState(false);

  // Real per-game playtime, joined against the game registry for name/icon.
  // null = still loading (render skeletons), [] = resolved empty (render the empty copy).
  const [gameStats, setGameStats] = useState<GameStat[] | null>(null);
  useEffect(() => {
    getGameStats()
      .then((res) => setGameStats((res?.stats ?? []).filter((s) => s.lastPlayedAt !== null)))
      .catch(() => {
        setGameStats([]);
        errorToast('Не удалось загрузить статистику игр.');
      });
  }, []);
  const recentActivity = [...(gameStats ?? [])]
    .sort((a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0))
    .map((s) => ({ stat: s, game: GAMES.find((g) => g.id === s.gameId) }))
    .filter((r): r is { stat: GameStat; game: NonNullable<typeof r.game> } => !!r.game);

  // Load the persisted profile (avatar/wallpaper/title) once on mount.
  useEffect(() => {
    void getProfile().then((p) => {
      if (!p) return;
      setAvatar(p.avatarIcon);
      setWallpaper(p.wallpaper);
      setTitleAchievement(p.titleAchievement ?? null);
    });
  }, []);

  // Blocked accounts — the only surface where they're visible again (they're hidden from the
  // regular friends list once blocked, but the underlying friendship edge isn't touched).
  const [blocked, setBlocked] = useState<social.BlockedAccount[]>([]);
  const refreshBlocked = () => void useSocialStore.getState().getBlocked().then(setBlocked);
  useEffect(refreshBlocked, []);
  const unblockAccount = async (accountId: string) => {
    await useSocialStore.getState().unblock(accountId);
    refreshBlocked();
  };

  // Telegram linking state
  const [tgLinked, setTgLinked] = useState<boolean | null>(null);
  const [tgId, setTgId] = useState<string | undefined>(undefined);
  const [tgModal, setTgModal] = useState<{ code: string; url: string } | null>(null);

  // Real unlocked achievements across EVERY game; the catalogs decorate them with name/icon/desc.
  const [unlocked, setUnlocked] = useState<{ gameId: string; achievementId: string }[]>([]);
  const refreshAchievements = () =>
    void getAchievements().then((res) => setUnlocked(res?.achievements ?? []));
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
      errorToast('Не удалось создать код привязки. Попробуйте позже.');
      return;
    }
    if (r.url) window.open(r.url, '_blank', 'noopener');
    setTgModal(r);
  };

  const avatarInputRef = useRef<HTMLInputElement>(null);
  const wallpaperInputRef = useRef<HTMLInputElement>(null);

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_IMAGE_BYTES) {
      errorToast(`Файл слишком большой (макс. ${Math.floor(MAX_IMAGE_BYTES / 1024 / 1024)} МБ).`);
      return;
    }
    const dataUrl = await readAsDataUrl(file);
    const saved = await apiSetAvatar(dataUrl);
    if (saved === null) {
      errorToast('Не удалось сохранить аватар. Попробуйте позже.');
      return;
    }
    setAvatar(saved);
  };

  const handleWallpaperChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_IMAGE_BYTES) {
      errorToast(`Файл слишком большой (макс. ${Math.floor(MAX_IMAGE_BYTES / 1024 / 1024)} МБ).`);
      return;
    }
    const dataUrl = await readAsDataUrl(file);
    const saved = await apiSetWallpaper(dataUrl);
    if (saved === null) {
      errorToast('Не удалось сохранить фон. Попробуйте позже.');
      return;
    }
    setWallpaper(saved);
  };

  /** Persist the title choice, then reflect it locally once the server confirms it. */
  const chooseTitle = async (ref: { gameId: string; achievementId: string } | null) => {
    const ok = await apiSetTitleAchievement(ref);
    if (!ok) {
      errorToast('Не удалось сохранить титул. Попробуйте позже.');
      return;
    }
    setTitleAchievement(ref);
  };

  const selectedAchiev = titleAchievement ? defOf(titleAchievement.gameId, titleAchievement.achievementId) : undefined;
  // Everything the player has unlocked that we have a catalog entry for — the title picker options.
  const unlockedDefs = unlocked
    .map((a) => defOf(a.gameId, a.achievementId))
    .filter((d): d is NonNullable<typeof d> => !!d);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto', background: 'var(--c-panel-solid)' }}>

      {/* Hidden file inputs */}
      <input type="file" ref={avatarInputRef} style={{ display: 'none' }} accept="image/*" onChange={handleAvatarChange} />
      <input type="file" ref={wallpaperInputRef} style={{ display: 'none' }} accept="image/*" onChange={handleWallpaperChange} />

      {/* Hero Section */}
      <div style={{
        position: 'relative',
        minHeight: 300,
        background: wallpaper ? `url(${wallpaper}) center/cover no-repeat` : 'linear-gradient(to bottom, var(--c-panel-hover), var(--c-panel-solid))',
        padding: '40px 10%',
        display: 'flex',
        alignItems: 'flex-end',
        gap: 32
      }}>
        {/* Dark overlay if wallpaper exists */}
        {wallpaper && <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, transparent 0%, var(--c-panel-solid) 100%)' }} />}

        {/* Avatar Container */}
        <div style={{ position: 'relative', zIndex: 10, cursor: 'pointer' }} onClick={() => avatarInputRef.current?.click()}>
          <div style={{
            width: 160,
            height: 160,
            background: avatar ? `url(${avatar}) center/cover` : 'var(--c-panel-hover)',
            borderRadius: 8,
            border: selectedAchiev ? `4px solid ${selectedAchiev.color}` : '2px solid var(--c-positive)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: avatar ? 0 : 48,
            color: 'var(--c-text-primary)'
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
              background: 'var(--c-panel-deep)',
              border: `2px solid ${selectedAchiev.color}`,
              color: 'var(--c-text-primary)',
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

          <div style={{ position: 'absolute', inset: 0, background: 'var(--c-overlay)', opacity: 0, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'opacity 0.2s', fontWeight: 600 }}
               onMouseOver={(e) => e.currentTarget.style.opacity = '1'}
               onMouseOut={(e) => e.currentTarget.style.opacity = '0'}>
            Изменить
          </div>
        </div>

        {/* User Info */}
        <div style={{ position: 'relative', zIndex: 10, paddingBottom: selectedAchiev ? 16 : 0 }}>
          <h1 style={{ fontSize: 36, fontWeight: 800, color: 'var(--c-text-primary)', margin: 0, textShadow: '0 2px 8px rgba(0,0,0,0.8)' }}>
            {me?.displayName || 'Гость'}
          </h1>
          <div style={{ color: 'var(--c-positive)', fontSize: '14px', fontWeight: 600, marginTop: 8, textShadow: '0 2px 4px rgba(0,0,0,0.8)' }}>
            В сети
          </div>

          <div style={{ display: 'flex', gap: 16, marginTop: 24 }}>
            <button
              onClick={() => wallpaperInputRef.current?.click()}
              className="hub-btn"
              style={{ backdropFilter: 'blur(4px)' }}
            >
              Загрузить фон
            </button>
            <button
              onClick={() => setIsChoosingAchievement(true)}
              className="hub-btn"
              style={{ backdropFilter: 'blur(4px)' }}
            >
              Выбрать титул
            </button>
            {tgLinked ? (
              <div
                title={tgId ? `Telegram chat ${tgId}` : undefined}
                style={{ background: 'rgba(70, 196, 106, 0.15)', color: 'var(--c-positive)', border: '1px solid var(--c-positive)', padding: '8px 16px', borderRadius: 4, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}
              >
                <span>✈</span> Telegram привязан ✓
              </div>
            ) : (
              <button
                onClick={() => void startTelegramLink()}
                style={{ background: 'var(--c-accent)', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 4, cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}
              >
                <span>✈</span> Привязать TG
              </button>
            )}
            <button
              disabled
              title="Скоро"
              style={{ background: 'var(--c-accent-muted)', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 4, cursor: 'not-allowed', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, opacity: 0.5 }}
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
          <div className="hub-card" style={{ padding: 24 }}>
            <h2 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--c-text-primary)', marginBottom: 16 }}>НЕДАВНЯЯ АКТИВНОСТЬ</h2>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {gameStats === null ? (
                <>
                  <div className="hub-skeleton" style={{ height: 64 }} />
                  <div className="hub-skeleton" style={{ height: 64 }} />
                  <div className="hub-skeleton" style={{ height: 64 }} />
                </>
              ) : recentActivity.length === 0 ? (
                <div style={{ color: 'var(--c-text-muted)', fontSize: '13px' }}>Ещё не играли ни в одну игру</div>
              ) : (
                recentActivity.map(({ stat, game }) => (
                  <div key={game.id} style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                    <div style={{ width: 64, height: 64, background: 'var(--c-panel-hover)', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32 }}>{game.emoji}</div>
                    <div>
                      <div style={{ color: 'var(--c-text-primary)', fontWeight: 600 }}>{game.name}</div>
                      <div style={{ color: 'var(--c-text-muted)', fontSize: '12px' }}>
                        Сыграно {formatPlaytime(stat.secondsPlayed, stat.lastPlayedAt !== null)} • Последний запуск: {formatLastPlayed(stat.lastPlayedAt).toLowerCase()}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {blocked.length > 0 && (
            <div className="hub-card" style={{ padding: 24 }}>
              <h2 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--c-text-primary)', marginBottom: 16 }}>ЗАБЛОКИРОВАННЫЕ</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {blocked.map((b) => (
                  <div key={b.accountId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <span style={{ color: 'var(--c-text-primary)', fontSize: '13px' }}>{b.displayName}</span>
                    <button
                      onClick={() => void unblockAccount(b.accountId)}
                      className="hub-btn"
                      style={{ padding: '4px 12px', fontSize: '12px' }}
                    >
                      Разблокировать
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Column (Achievements) */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* All achievements actually unlocked, across every game (the real list from the API). */}
          <div className="hub-card" style={{ padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--c-text-primary)' }}>ПОЛУЧЕННЫЕ ДОСТИЖЕНИЯ</h2>
              <span style={{ color: 'var(--c-text-muted)', fontSize: '14px' }}>{unlocked.length}</span>
            </div>
            {unlocked.length === 0 ? (
              <div style={{ color: 'var(--c-text-muted)', fontSize: 13 }}>Пока нет достижений — играйте, чтобы получить.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {unlocked.map((a) => {
                  const def = defOf(a.gameId, a.achievementId);
                  return (
                    <div key={`${a.gameId}:${a.achievementId}`} title={def?.description} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 10px', background: 'var(--c-panel-deep)', borderRadius: 8 }}>
                      <div style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--c-panel-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>
                        {def?.icon ?? '🏅'}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ color: def?.color ?? 'var(--c-text-primary)', fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{def?.name ?? a.achievementId}</div>
                        <div style={{ color: 'var(--c-text-muted)', fontSize: 12 }}>{gameLabel(a.gameId)}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

      </div>

      {/* Title Achievement Modal */}
      {isChoosingAchievement && (
        <div className="hub-modal-scrim">
          <div className="civa-fade-in" style={{ width: 500, background: 'var(--c-panel-solid)', border: '1px solid var(--c-panel-border)', borderRadius: 8, padding: 24 }}>
            <h2 style={{ color: 'var(--c-text-primary)', margin: '0 0 24px 0', fontSize: 20 }}>Выберите титульную ачивку</h2>
            <p style={{ color: 'var(--c-text-muted)', marginBottom: 24, fontSize: 14 }}>
              Выбранная ачивка будет отображаться в виде специальной рамки и значка поверх вашей аватарки во всех играх.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 400, overflowY: 'auto' }}>
              <div
                onClick={() => { void chooseTitle(null); setIsChoosingAchievement(false); }}
                style={{ background: !titleAchievement ? 'var(--c-panel-hover)' : 'var(--c-panel-deep)', padding: 16, borderRadius: 4, cursor: 'pointer', color: 'var(--c-text-primary)' }}
              >
                Без титула
              </div>

              {unlockedDefs.length === 0 && (
                <div style={{ color: 'var(--c-text-muted)', fontSize: 13, padding: '8px 4px' }}>
                  У вас пока нет разблокированных достижений для титула.
                </div>
              )}

              {unlockedDefs.map((def) => {
                const active = titleAchievement?.gameId === def.gameId && titleAchievement?.achievementId === def.achievementId;
                return (
                  <div
                    key={`${def.gameId}:${def.achievementId}`}
                    onClick={() => { void chooseTitle({ gameId: def.gameId, achievementId: def.achievementId }); setIsChoosingAchievement(false); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 16,
                      background: active ? 'var(--c-panel-hover)' : 'var(--c-panel-deep)',
                      padding: 16, borderRadius: 4, cursor: 'pointer',
                      border: active ? `1px solid ${def.color}` : '1px solid transparent',
                    }}
                  >
                    <div style={{ fontSize: 24 }}>{def.icon}</div>
                    <div>
                      <div style={{ color: def.color, fontWeight: 700 }}>{def.name}</div>
                      <div style={{ color: 'var(--c-text-muted)', fontSize: 12 }}>{def.description} · {gameLabel(def.gameId)}</div>
                    </div>
                  </div>
                );
              })}
            </div>

            <button
              onClick={() => setIsChoosingAchievement(false)}
              className="hub-btn"
              style={{ marginTop: 24, width: '100%', padding: '12px' }}
            >
              Закрыть
            </button>
          </div>
        </div>
      )}

      {/* Telegram link modal */}
      {tgModal && (
        <div className="hub-modal-scrim">
          <div className="civa-fade-in" style={{ width: 460, background: 'var(--c-panel-solid)', border: '1px solid var(--c-panel-border)', borderRadius: 8, padding: 32, textAlign: 'center' }}>
            <h2 style={{ color: 'var(--c-text-primary)', margin: '0 0 12px 0', fontSize: 22 }}>Привязка Telegram</h2>
            <p style={{ color: 'var(--c-text-muted)', marginBottom: 20, fontSize: 14, lineHeight: 1.5 }}>
              Открой бота в Telegram и нажми <b>Start</b> — аккаунт привяжется автоматически.
              Если бот не открылся, отправь ему команду:
            </p>
            <div style={{ background: 'var(--c-panel-deep)', border: '1px dashed var(--c-panel-border)', padding: 16, borderRadius: 4, color: 'var(--c-text-primary)', letterSpacing: 1, fontSize: 18, marginBottom: 20, fontFamily: 'var(--font-mono)' }}>
              /start {tgModal.code}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {tgModal.url && (
                <a href={tgModal.url} target="_blank" rel="noreferrer" style={{ background: 'var(--c-accent)', color: '#fff', padding: '12px', borderRadius: 4, textDecoration: 'none', fontWeight: 600 }}>
                  ✈ Открыть Telegram
                </a>
              )}
              <div style={{ color: 'var(--c-text-muted)', fontSize: 13 }}>Ожидаем подтверждения от бота…</div>
              <button onClick={() => setTgModal(null)} style={{ background: 'transparent', color: 'var(--c-text-muted)', border: 'none', padding: '8px', cursor: 'pointer', fontWeight: 600 }}>
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
