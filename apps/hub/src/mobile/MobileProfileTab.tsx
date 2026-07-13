/**
 * Mobile «Профиль» tab — a stacked, trimmed version of the desktop ProfileView built from the same
 * data/actions (no logic duplicated): avatar upload (`setAvatar`), name + friend code, a playtime /
 * achievements summary (`getGameStats`, `getAchievements`), and settings entries (rename via
 * `changeDisplayName`, Telegram link status/link, logout). The desktop-only «Связь с автором» nav
 * tab is folded in here as a collapsible feedback section (`createThread`).
 */
import { useEffect, useRef, useState } from 'react';
import type { GameStat } from '@mygame/protocol';
import {
  getProfile,
  setAvatar as apiSetAvatar,
  getGameStats,
  getAchievements,
  getTelegramStatus,
  createTelegramLinkCode,
  changeDisplayName,
  createSuggestion,
  useSocialStore,
  useChatStore,
  useToastStore,
  loadSession,
} from '@mygame/sdk';
import { usePlatformStore } from '../platform/platformStore.js';
import { useAchievementCatalogs } from '../platform/achievementsCatalog.js';
import { formatPlaytime } from '../platform/statsFormat.js';

/** Server body cap headroom (matches ProfileView) — reject oversized images before the round-trip. */
const MAX_IMAGE_BYTES = 2_500_000;

const readAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

const StatTile = ({ value, label }: { value: string; label: string }): JSX.Element => (
  <div className="hub-card" style={{ flex: 1, padding: 14, textAlign: 'center' }}>
    <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--c-text-primary)' }}>{value}</div>
    <div style={{ fontSize: 11, color: 'var(--c-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 }}>
      {label}
    </div>
  </div>
);

const Collapsible = ({ title, children }: { title: string; children: React.ReactNode }): JSX.Element => {
  const [open, setOpen] = useState(false);
  return (
    <div className="hub-card" style={{ overflow: 'hidden' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%',
          minHeight: 52,
          padding: '0 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: 15,
          fontWeight: 700,
          color: 'var(--c-text-primary)',
          background: 'none',
        }}
      >
        <span>{title}</span>
        <span style={{ color: 'var(--c-text-muted)' }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && <div style={{ padding: '0 16px 16px' }}>{children}</div>}
    </div>
  );
};

const ContactAuthorSection = (): JSX.Element => {
  const addToast = useToastStore((s) => s.addToast);
  const [idea, setIdea] = useState('');
  const [sending, setSending] = useState(false);

  const submit = async (): Promise<void> => {
    const text = idea.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const created = await createSuggestion(text);
      addToast(
        created
          ? { type: 'system', title: 'Идея отправлена', content: 'Спасибо! Автор увидит её и ответит.', icon: '💡' }
          : { type: 'system', title: 'Не удалось отправить', content: 'Попробуйте ещё раз позже.', icon: '⚠️' },
      );
      if (created) setIdea('');
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <textarea
        className="hub-input"
        placeholder="Опишите свою идею для новой игры или механики…"
        value={idea}
        onChange={(e) => setIdea(e.target.value)}
        style={{ width: '100%', height: 90, padding: 12, resize: 'vertical', fontSize: 14 }}
      />
      <button
        onClick={() => void submit()}
        disabled={!idea.trim() || sending}
        className="hub-btn hub-btn-primary"
        style={{ padding: '12px', minHeight: 48 }}
      >
        {sending ? 'Отправка…' : 'Отправить автору'}
      </button>
      <a
        href="https://t.me/egr4045"
        target="_blank"
        rel="noreferrer"
        className="hub-btn"
        style={{ padding: '12px', minHeight: 48, textAlign: 'center', textDecoration: 'none', display: 'block' }}
      >
        ✈ Telegram автора
      </a>
    </div>
  );
};

export const MobileProfileTab = (): JSX.Element => {
  const account = usePlatformStore((s) => s.account);
  const logout = usePlatformStore((s) => s.logout);
  const renameAccount = usePlatformStore((s) => s.renameAccount);
  const addToast = useToastStore((s) => s.addToast);

  const [avatar, setAvatar] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const [gameStats, setGameStats] = useState<GameStat[] | null>(null);
  const [unlockedCount, setUnlockedCount] = useState<number | null>(null);

  const [tgLinked, setTgLinked] = useState<boolean | null>(null);

  const [showRename, setShowRename] = useState(false);
  const [newName, setNewName] = useState('');
  const [nameBusy, setNameBusy] = useState(false);

  const [showLogout, setShowLogout] = useState(false);

  const myCode = loadSession()?.friendCode ?? account?.accountId?.slice(0, 8) ?? '…';

  // Total catalog size across every game, for the "N/total" achievements tile.
  const { byGame: catalogsByGame } = useAchievementCatalogs();
  const totalAchievements = [...catalogsByGame.values()].reduce((n, defs) => n + defs.length, 0);

  useEffect(() => {
    void getProfile().then((p) => p && setAvatar(p.avatarIcon));
    void getGameStats().then((res) => setGameStats(res?.stats ?? []));
    void getAchievements().then((res) => setUnlockedCount((res?.achievements ?? []).length));
    void getTelegramStatus().then((s) => s && setTgLinked(s.linked));
  }, []);

  const totalSeconds = (gameStats ?? []).reduce((sum, s) => sum + s.secondsPlayed, 0);
  const gamesPlayed = (gameStats ?? []).filter((s) => s.lastPlayedAt !== null).length;

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_IMAGE_BYTES) {
      addToast({ type: 'system', title: 'Профиль', content: 'Файл слишком большой (макс. 2 МБ).', icon: '⚠️' });
      return;
    }
    const dataUrl = await readAsDataUrl(file);
    const saved = await apiSetAvatar(dataUrl);
    if (saved === null) {
      addToast({ type: 'system', title: 'Профиль', content: 'Не удалось сохранить аватар.', icon: '⚠️' });
      return;
    }
    setAvatar(saved);
  };

  const submitName = async (): Promise<void> => {
    const name = newName.trim();
    if (!name || nameBusy) return;
    setNameBusy(true);
    const ok = await changeDisplayName(name);
    if (ok) {
      renameAccount(name);
      // Fresh JWTs carry the new name — reconnect so friends/chat pick it up immediately.
      useSocialStore.getState().disconnect();
      useChatStore.getState().disconnect();
      void useSocialStore.getState().connect();
      void useChatStore.getState().connect();
      setNewName('');
      setShowRename(false);
    }
    addToast(
      ok
        ? { type: 'system', title: 'Имя изменено', content: name, icon: '✓' }
        : { type: 'system', title: 'Не удалось', content: 'Имя уже занято.', icon: '⚠️' },
    );
    setNameBusy(false);
  };

  const startTelegramLink = async (): Promise<void> => {
    const r = await createTelegramLinkCode();
    if (!r) {
      addToast({ type: 'system', title: 'Telegram', content: 'Не удалось создать код. Попробуйте позже.', icon: '⚠️' });
      return;
    }
    if (r.url) window.open(r.url, '_blank', 'noopener');
    addToast({ type: 'system', title: 'Привязка Telegram', content: 'Откройте бота и нажмите Start.', icon: '✈' });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <input type="file" ref={avatarInputRef} style={{ display: 'none' }} accept="image/*" onChange={(e) => void handleAvatarChange(e)} />

      {/* Identity */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div
          onClick={() => avatarInputRef.current?.click()}
          style={{
            width: 84,
            height: 84,
            flex: '0 0 auto',
            borderRadius: 'var(--r-lg)',
            background: avatar ? `url(${avatar}) center/cover` : 'var(--c-panel-hover)',
            border: '2px solid var(--c-positive)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 34,
            fontWeight: 800,
            color: 'var(--c-text-primary)',
            cursor: 'pointer',
          }}
        >
          {!avatar && (account?.displayName?.[0]?.toUpperCase() || '?')}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--c-text-primary)', overflowWrap: 'anywhere' }}>
            {account?.displayName || 'Гость'}
          </div>
          <div style={{ fontSize: 13, color: 'var(--c-text-muted)', marginTop: 4 }}>
            Код друга: <strong style={{ color: 'var(--c-accent)', letterSpacing: 1 }}>{myCode}</strong>
          </div>
          <button onClick={() => avatarInputRef.current?.click()} className="hub-btn" style={{ marginTop: 8, padding: '6px 12px' }}>
            Сменить аватар
          </button>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 10 }}>
        <StatTile value={gameStats === null ? '…' : formatPlaytime(totalSeconds)} label="В играх" />
        <StatTile value={gameStats === null ? '…' : String(gamesPlayed)} label="Игр" />
        <StatTile
          value={unlockedCount === null ? '…' : totalAchievements > 0 ? `${unlockedCount}/${totalAchievements}` : String(unlockedCount)}
          label="Ачивки"
        />
      </div>

      {/* Settings */}
      <div>
        <div className="mhub-section-title">Настройки</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* Rename */}
          <div className="hub-card" style={{ padding: showRename ? 16 : 0 }}>
            {!showRename ? (
              <button
                onClick={() => setShowRename(true)}
                style={{ width: '100%', minHeight: 52, padding: '0 16px', textAlign: 'left', fontSize: 15, color: 'var(--c-text-primary)' }}
              >
                ✏️ Изменить имя
              </button>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <input
                  value={newName}
                  placeholder="Новое имя"
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void submitName()}
                  className="hub-input"
                  style={{ padding: '12px 14px', fontSize: 15, minHeight: 48 }}
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => void submitName()}
                    disabled={!newName.trim() || nameBusy}
                    className="hub-btn hub-btn-primary"
                    style={{ flex: 1, padding: '12px', minHeight: 48 }}
                  >
                    {nameBusy ? 'Сохраняем…' : 'Сохранить'}
                  </button>
                  <button onClick={() => setShowRename(false)} className="hub-btn" style={{ padding: '12px 16px', minHeight: 48 }}>
                    Отмена
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Telegram */}
          <div className="hub-card" style={{ padding: '0 16px', minHeight: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <span style={{ fontSize: 15, color: 'var(--c-text-primary)' }}>✈ Telegram</span>
            {tgLinked === null ? (
              <span style={{ fontSize: 13, color: 'var(--c-text-muted)' }}>…</span>
            ) : tgLinked ? (
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--c-positive)' }}>Привязан ✓</span>
            ) : (
              <button onClick={() => void startTelegramLink()} className="hub-btn hub-btn-primary" style={{ padding: '8px 14px', minHeight: 40 }}>
                Привязать
              </button>
            )}
          </div>

          {/* Logout */}
          <div className="hub-card">
            <button
              onClick={() => setShowLogout(true)}
              style={{ width: '100%', minHeight: 52, padding: '0 16px', textAlign: 'left', fontSize: 15, fontWeight: 700, color: 'var(--c-negative)' }}
            >
              🚪 Выйти из аккаунта
            </button>
          </div>
        </div>
      </div>

      {/* Contact author (folded-in desktop nav tab) */}
      <div>
        <div className="mhub-section-title">Связь с автором</div>
        <Collapsible title="💡 Предложить идею">
          <ContactAuthorSection />
        </Collapsible>
      </div>

      {showLogout && (
        <div className="hub-modal-scrim" style={{ zIndex: 1000 }} onClick={() => setShowLogout(false)}>
          <div
            className="civa-fade-in hub-card"
            onClick={(e) => e.stopPropagation()}
            style={{ width: '90%', maxWidth: 360, background: 'var(--c-panel-solid)', padding: 24, textAlign: 'center' }}
          >
            <h2 style={{ color: 'var(--c-text-primary)', margin: '0 0 12px', fontSize: 18 }}>Выход из аккаунта</h2>
            <p style={{ color: 'var(--c-text-muted)', marginBottom: 20, fontSize: 14 }}>Вы действительно хотите выйти?</p>
            <div style={{ display: 'flex', gap: 12 }}>
              <button onClick={() => setShowLogout(false)} className="hub-btn" style={{ flex: 1, padding: '12px', minHeight: 48 }}>
                Отмена
              </button>
              <button onClick={logout} className="hub-btn hub-btn-danger" style={{ flex: 1, padding: '12px', minHeight: 48 }}>
                Выйти
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
