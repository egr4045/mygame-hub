/**
 * Mobile «Друзья» tab — the full social surface built on `useSocialStore` (no logic duplicated):
 * your friend code with copy, an add-by-code box, then incoming requests, online (in-game + idle)
 * and offline sections. Row actions reuse the shared stores — «Написать» opens the SDK ChatWidget
 * (`openChatWithUser`), «Позвать» rings (`ringUser`), and a «⋯» menu (the SDK ContextMenu) removes.
 */
import { useState } from 'react';
import type { social } from '@mygame/protocol';
import { useSocialStore, useChatStore, useToastStore, useMenuStore, loadSession } from '@mygame/sdk';

/** Clipboard copy with an execCommand fallback for contexts where navigator.clipboard is blocked. */
const copyText = (text: string, onOk: () => void, onFail: () => void): void => {
  const fallback = (): void => {
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
      ok ? onOk() : onFail();
    } catch {
      onFail();
    }
  };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(onOk, fallback);
  else fallback();
};

const activityText = (f: social.Friend): string => {
  if (f.presence === 'offline') return 'Не в сети';
  if (f.activity) return `Играет в ${f.activity.gameName}`;
  return 'В сети';
};

const Avatar = ({ f }: { f: social.Friend }): JSX.Element => {
  const online = f.presence === 'online';
  const inGame = online && !!f.activity;
  const ring = inGame ? 'var(--c-positive)' : online ? 'var(--c-accent)' : 'var(--c-panel-border)';
  return (
    <div
      style={{
        width: 44,
        height: 44,
        flex: '0 0 auto',
        borderRadius: 'var(--r-md)',
        background: 'var(--c-panel-hover)',
        border: `2px solid ${ring}`,
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 800,
        fontSize: 18,
        color: 'var(--c-text-primary)',
      }}
    >
      {f.avatarIcon ? (
        <img src={f.avatarIcon} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        (f.displayName[0] ?? '?').toUpperCase()
      )}
    </div>
  );
};

const iconBtnStyle: React.CSSProperties = {
  width: 44,
  height: 44,
  flex: '0 0 auto',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 'var(--r-sm)',
  fontSize: 20,
  background: 'var(--c-panel-hover)',
  color: 'var(--c-text-primary)',
};

export const MobileFriendsTab = (): JSX.Element => {
  const me = useSocialStore((s) => s.me);
  const friends = useSocialStore((s) => s.friends);
  const status = useSocialStore((s) => s.status);
  const { addByCode, accept, decline, removeFriend } = useSocialStore.getState();
  const openChatWithUser = useChatStore((s) => s.openChatWithUser);
  const ringUser = useChatStore((s) => s.ringUser);
  const openMenu = useMenuStore((s) => s.openMenu);
  const addToast = useToastStore((s) => s.addToast);

  const [code, setCode] = useState('');
  const [copied, setCopied] = useState(false);

  const myCode = loadSession()?.friendCode ?? me?.accountId?.slice(0, 8) ?? '…';

  const incoming = friends.filter((f) => f.status === 'incoming');
  const outgoing = friends.filter((f) => f.status === 'outgoing');
  const accepted = friends.filter((f) => f.status === 'accepted');
  const online = accepted.filter((f) => f.presence === 'online');
  const offline = accepted.filter((f) => f.presence === 'offline');

  const submitAdd = (): void => {
    const c = code.trim();
    if (!c) return;
    setCode('');
    void addByCode(c).then((ack) =>
      addToast({
        type: 'system',
        title: ack.error ? 'Не добавлено' : 'Заявка отправлена',
        content: ack.error ?? `Запрос в друзья отправлен по коду ${c.toUpperCase()}`,
        icon: ack.error ? '⚠️' : '✉️',
      }),
    );
  };

  const copyCode = (): void => {
    copyText(
      myCode,
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      },
      () => addToast({ type: 'system', title: 'Не удалось скопировать', content: myCode, icon: '⚠️' }),
    );
  };

  const openFriendMenu = (e: React.MouseEvent, f: social.Friend): void => {
    openMenu(e.clientX, e.clientY, [
      { label: '💬 Написать', action: () => openChatWithUser(f.accountId, f.displayName) },
      { label: '📞 Позвать', action: () => ringUser(f.accountId, f.displayName, 'audio'), disabled: f.presence !== 'online' },
      { separator: true, action: () => {} },
      { label: '🗑️ Удалить из друзей', action: () => removeFriend(f.accountId), danger: true },
    ]);
  };

  const FriendRow = ({ f }: { f: social.Friend }): JSX.Element => (
    <div className="hub-card" style={{ padding: 10, display: 'flex', alignItems: 'center', gap: 12 }}>
      <Avatar f={f} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 15,
            fontWeight: 700,
            color: 'var(--c-text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {f.displayName}
          {f.titleAchievement && <span title="Есть титул"> 🏅</span>}
        </div>
        <div style={{ fontSize: 12, color: f.activity ? 'var(--c-positive)' : 'var(--c-text-muted)' }}>{activityText(f)}</div>
      </div>
      <button onClick={() => openChatWithUser(f.accountId, f.displayName)} aria-label="Написать" style={iconBtnStyle}>
        💬
      </button>
      <button onClick={(e) => openFriendMenu(e, f)} aria-label="Ещё" style={iconBtnStyle}>
        ⋯
      </button>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--c-text-primary)', margin: 0 }}>Друзья</h1>

      {/* Your friend code */}
      <div className="hub-card" style={{ padding: 16 }}>
        <div className="mhub-section-title" style={{ margin: 0 }}>
          Ваш код друга
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
          <div
            style={{
              flex: 1,
              fontSize: 20,
              fontWeight: 800,
              letterSpacing: 2,
              color: 'var(--c-accent)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {myCode}
          </div>
          <button onClick={copyCode} className="hub-btn" style={{ padding: '10px 16px', minHeight: 44 }}>
            {copied ? '✓ Скопировано' : 'Копировать'}
          </button>
        </div>
      </div>

      {/* Add a friend */}
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={code}
          placeholder="Код друга"
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submitAdd()}
          className="hub-input"
          style={{ flex: 1, padding: '12px 14px', fontSize: 15, minHeight: 48 }}
        />
        <button onClick={submitAdd} disabled={!code.trim()} className="hub-btn hub-btn-primary" style={{ padding: '0 18px', minHeight: 48 }}>
          Добавить
        </button>
      </div>

      {status !== 'connected' && (
        <div style={{ fontSize: 13, color: 'var(--c-text-muted)', textAlign: 'center' }}>Подключение к сети друзей…</div>
      )}

      {/* Incoming requests */}
      {incoming.length > 0 && (
        <div>
          <div className="mhub-section-title">Заявки ({incoming.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {incoming.map((f) => (
              <div key={f.accountId} className="hub-card" style={{ padding: 10, display: 'flex', alignItems: 'center', gap: 12 }}>
                <Avatar f={f} />
                <div style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 700, color: 'var(--c-text-primary)' }}>{f.displayName}</div>
                <button onClick={() => accept(f.accountId)} className="hub-btn hub-btn-primary" style={{ padding: '10px 14px', minHeight: 44 }}>
                  Принять
                </button>
                <button onClick={() => decline(f.accountId)} className="hub-btn" style={{ padding: '10px 14px', minHeight: 44 }}>
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Online */}
      {online.length > 0 && (
        <div>
          <div className="mhub-section-title">В сети ({online.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {online.map((f) => (
              <FriendRow key={f.accountId} f={f} />
            ))}
          </div>
        </div>
      )}

      {/* Offline */}
      {offline.length > 0 && (
        <div>
          <div className="mhub-section-title">Не в сети ({offline.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {offline.map((f) => (
              <FriendRow key={f.accountId} f={f} />
            ))}
          </div>
        </div>
      )}

      {/* Outgoing */}
      {outgoing.length > 0 && (
        <div>
          <div className="mhub-section-title">Отправленные ({outgoing.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {outgoing.map((f) => (
              <div key={f.accountId} className="hub-card" style={{ padding: 10, display: 'flex', alignItems: 'center', gap: 12 }}>
                <Avatar f={f} />
                <div style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 600, color: 'var(--c-text-muted)' }}>{f.displayName}</div>
                <button onClick={() => decline(f.accountId)} className="hub-btn" style={{ padding: '10px 14px', minHeight: 44 }}>
                  Отменить
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {accepted.length === 0 && incoming.length === 0 && outgoing.length === 0 && status === 'connected' && (
        <div className="hub-card" style={{ padding: 20, textAlign: 'center', color: 'var(--c-text-muted)', fontSize: 14 }}>
          У вас пока нет друзей. Поделитесь своим кодом или добавьте друга по коду выше.
        </div>
      )}
    </div>
  );
};
