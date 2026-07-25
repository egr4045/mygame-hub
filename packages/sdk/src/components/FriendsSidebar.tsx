import { useState, type CSSProperties } from 'react';
import type { social } from '@mygame/protocol';
import { useSocialStore } from '../state/socialStore.js';
import { useMenuStore } from '../state/menuStore.js';
import { useChatStore } from '../state/chatStore.js';
import { useToastStore } from '../state/toastStore.js';
import { useFriendSearch } from '../state/useFriendSearch.js';
import { UserProfileModal, type ProfileTarget } from './UserProfileModal.js';
import { loadSession } from '../authClient.js';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { mg } from '../theme/tokens.js';
import { btn, input } from '../theme/primitives.js';

const inputStyle: CSSProperties = {
  ...input,
  flex: 1,
  minWidth: 0,
};

const sectionLabel: CSSProperties = {
  fontSize: '11px',
  color: mg.textMuted,
  textTransform: 'uppercase',
  fontWeight: 700,
  letterSpacing: 0.5,
  marginTop: 8,
  padding: '0 8px',
};

const activityText = (f: social.Friend): string => {
  if (f.presence === 'offline') return 'Не в сети';
  if (f.activity) return `Играет в ${f.activity.gameName}`;
  return 'В сети';
};

/** 1–2 letters for an avatar placeholder in search results. */
const initials = (name: string): string =>
  (name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('') || '?';

/** Deterministic pleasant colour from a name (search-result avatar placeholders). */
const avatarBg = (name: string): string => {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return `hsl(${h} 45% 42%)`;
};

/** Non-actionable relation labels for a search row (actionable ones render as buttons instead). */
const RELATION_BADGE: Partial<Record<social.SearchRelation, { label: string; color: string }>> = {
  self: { label: 'это вы', color: mg.textMuted },
  friend: { label: '✓ в друзьях', color: mg.positive },
  outgoing: { label: 'заявка отправлена', color: mg.textMuted },
};

export const FriendsSidebar = ({
  inOverlay = false,
  onJoinActivity,
}: {
  inOverlay?: boolean;
  /** Navigate into a friend's joinable activity. Only the hub can do this (it owns the game
   *  registry/orchestrator) — omitted when this widget renders inside an actual game via the SDK
   *  overlay, which hides the "Присоединиться" menu item entirely rather than show a dead action. */
  onJoinActivity?: ((f: social.Friend) => void) | undefined;
}): JSX.Element => {
  const me = useSocialStore((s) => s.me);
  const openMenu = useMenuStore((s) => s.openMenu);
  const openChatWithUser = useChatStore((s) => s.openChatWithUser);
  const ringUser = useChatStore((s) => s.ringUser);
  const friends = useSocialStore((s) => s.friends);
  const status = useSocialStore((s) => s.status);
  const myActivity = useSocialStore((s) => s.myActivity);
  const { addByCode, accept, decline, removeFriend, inviteFriend, block } = useSocialStore.getState();
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [viewingProfile, setViewingProfile] = useState<ProfileTarget | null>(null);
  const addToast = useToastStore((s) => s.addToast);
  const { results, loading } = useFriendSearch(code);
  const searching = code.trim().length >= 2;

  const incoming = friends.filter((f) => f.status === 'incoming');
  const outgoing = friends.filter((f) => f.status === 'outgoing');
  const accepted = friends.filter((f) => f.status === 'accepted');

  const inGame = accepted.filter(f => f.presence === 'online' && f.activity);
  const online = accepted.filter(f => f.presence === 'online' && !f.activity);
  const offline = accepted.filter(f => f.presence === 'offline');

  // Your dictatable friend code (from the stored session); falls back to a shortened id only if an
  // older server didn't mint one.
  const myFriendCode = loadSession()?.friendCode ?? me?.accountId?.slice(0, 8) ?? '...';

  const add = () => {
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

  const copyCode = () => {
    void navigator.clipboard?.writeText(myFriendCode).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  const handleFriendContext = (e: React.MouseEvent, f: social.Friend) => {
    e.preventDefault();
    e.stopPropagation();
    openMenu(e.clientX, e.clientY, [
      { label: '👤 Посмотреть профиль', action: () => setViewingProfile(f) },
      { label: '💬 Написать сообщение', action: () => openChatWithUser(f.accountId, f.displayName) },
      { separator: true, action: () => {} },
      // Only meaningful once *I* have a joinable activity (set via mygame.social.setActivity from
      // inside a game) — the hub itself never has one, so this is naturally inert there.
      {
        label: '🎮 Пригласить в игру',
        action: () =>
          myActivity?.room &&
          inviteFriend(f.accountId, { game: myActivity.game, gameName: myActivity.gameName, room: myActivity.room, role: 'player' }),
        disabled: !myActivity?.room,
      },
      // Only the hub can navigate into another game — omit entirely when no handler was threaded in.
      ...(onJoinActivity
        ? [{
            label: '🚀 Присоединиться к игре',
            action: () => onJoinActivity(f),
            disabled: !f.activity?.joinable,
          }]
        : []),
      { label: '🎤 Позвонить', action: () => ringUser(f.accountId, f.displayName, 'audio'), disabled: f.presence !== 'online' },
      { separator: true, action: () => {} },
      { label: '🚫 Заблокировать', action: () => void block(f.accountId), danger: true },
      { label: '🗑️ Удалить из друзей', action: () => removeFriend(f.accountId), danger: true }
    ]);
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      width: '100%',
      height: '100%',
      background: mg.surface,
      color: mg.text,
      ...(inOverlay ? {} : {
        position: 'absolute', right: 16, bottom: 16, width: 300, height: 500, borderRadius: mg.rSm, boxShadow: mg.shadowMd, zIndex: 100
      })
    }}>
      {/* Header */}
      <div style={{ padding: 12, background: mg.surfaceDeep, display: 'flex', alignItems: 'center' }}>
        <div style={{ width: 40, height: 40, background: mg.surfaceRaised, borderRadius: mg.rSm, marginRight: 12, overflow: 'hidden' }}>
          {me?.avatarIcon && (
            <img src={me.avatarIcon} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          )}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: '15px' }}>{me?.displayName || 'Загрузка...'}</div>
          <div style={{ fontSize: '12px', color: status === 'connected' ? mg.positive : mg.textMuted, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: status === 'connected' ? mg.positive : mg.surfaceRaised }} />
            {status === 'connected' ? (myActivity ? `Играет в ${myActivity.gameName}` : 'В сети') : 'Подключение...'}
          </div>
        </div>
      </div>

      {/* Find friends — search by nick OR code (exact code ranked first). */}
      <div style={{ padding: '8px 12px', display: 'flex', gap: 6, borderBottom: `1px solid ${mg.border}` }}>
        <input
          value={code}
          placeholder="🔍 Ник или код друга"
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') results[0] ? setViewingProfile(results[0]) : add();
            else if (e.key === 'Escape') setCode('');
          }}
          style={inputStyle}
          aria-label="Поиск друзей по нику или коду"
        />
        {code && (
          <button onClick={() => setCode('')} style={{ ...btn('neutral'), padding: '6px 9px' }} aria-label="Очистить">
            ✕
          </button>
        )}
      </div>

      {/* Lists — search results while typing, otherwise your friend sections. */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 4px' }}>
        {searching ? (
          <SearchResults results={results} loading={loading} onOpen={setViewingProfile} />
        ) : (
        <>
        {inGame.length > 0 && (
          <>
            <div style={sectionLabel}>В ИГРЕ ({inGame.length})</div>
            {inGame.map(f => (
              <FriendRow key={f.accountId} f={f} onContextMenu={(e) => handleFriendContext(e, f)} />
            ))}
          </>
        )}

        {online.length > 0 && (
          <>
            <div style={sectionLabel}>В СЕТИ ({online.length})</div>
            {online.map(f => (
              <FriendRow key={f.accountId} f={f} onContextMenu={(e) => handleFriendContext(e, f)} />
            ))}
          </>
        )}

        {offline.length > 0 && (
          <>
            <div style={sectionLabel}>НЕ В СЕТИ ({offline.length})</div>
            {offline.map(f => (
              <FriendRow key={f.accountId} f={f} onContextMenu={(e) => handleFriendContext(e, f)} />
            ))}
          </>
        )}

        {incoming.length > 0 && (
          <>
            <div style={sectionLabel}>ЗАЯВКИ</div>
            {incoming.map(f => (
              <div key={f.accountId} style={{ padding: '4px 8px', display: 'flex', gap: 8 }}>
                <span style={{flex: 1, fontSize: '13px'}}>{f.displayName}</span>
                <button onClick={() => accept(f.accountId)} style={{...btn('primary'), padding: '2px 8px'}}>✓</button>
                <button onClick={() => decline(f.accountId)} style={{...btn('danger'), padding: '2px 8px'}}>✕</button>
              </div>
            ))}
          </>
        )}

        {outgoing.length > 0 && (
          <>
            <div style={sectionLabel}>ОТПРАВЛЕННЫЕ</div>
            {outgoing.map(f => (
              <div key={f.accountId} style={{ padding: '4px 8px', display: 'flex', gap: 8 }}>
                <span style={{flex: 1, fontSize: '13px', color: mg.textMuted}}>{f.displayName}</span>
                <button onClick={() => decline(f.accountId)} style={{...btn('danger'), padding: '2px 8px'}}>Отменить</button>
              </div>
            ))}
          </>
        )}
        </>
        )}
      </div>

      {/* Footer / Your code */}
      <div style={{ padding: 12, background: mg.surfaceDeep, fontSize: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: mg.textMuted }}>Ваш код: <strong style={{ color: mg.text, letterSpacing: 1 }}>{myFriendCode}</strong></span>
        <button onClick={copyCode} style={{...btn('neutral'), padding: '4px 8px'}}>{copied ? 'Скопировано' : 'Копировать'}</button>
      </div>

      {viewingProfile && <UserProfileModal target={viewingProfile} onClose={() => setViewingProfile(null)} />}
    </div>
  );
};

const FriendRow = ({ f, onContextMenu }: { f: social.Friend, onContextMenu: (e: React.MouseEvent) => void }) => {
  const isOnline = f.presence === 'online';
  const isInGame = isOnline && f.activity;

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `friend:${f.accountId}`,
  });

  const style = {
    display: 'flex',
    alignItems: 'center',
    padding: '6px 8px',
    cursor: 'grab',
    gap: 12,
    background: isDragging ? mg.rowHover : 'transparent',
    opacity: isDragging ? 0.5 : 1,
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    zIndex: isDragging ? 9999 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onContextMenu={onContextMenu}
      style={style}
      onMouseOver={(e) => e.currentTarget.style.background = mg.rowHover}
      onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
    >
      <div style={{ width: 32, height: 32, background: isInGame ? mg.positive : (isOnline ? mg.accent : mg.surfaceRaised), borderRadius: mg.rSm, padding: 2, overflow: 'hidden' }}>
        {f.avatarIcon ? (
          <img src={f.avatarIcon} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{ width: '100%', height: '100%', background: mg.surfaceDeep }} />
        )}
      </div>
      <div>
        <div style={{ fontSize: '13px', fontWeight: 600, color: isInGame ? mg.positive : (isOnline ? mg.accent : mg.textMuted), display: 'flex', alignItems: 'center', gap: 4 }}>
          {f.displayName}
          {/* Generic "has an equipped title" indicator -- resolving it to a name/icon needs a
              per-game display catalog the SDK deliberately doesn't own (see ARCHITECTURE.md). */}
          {f.titleAchievement && <span title="Есть титул">🏅</span>}
        </div>
        <div style={{ fontSize: '11px', color: isInGame ? mg.positive : mg.textMuted }}>
          {activityText(f)}
        </div>
      </div>
    </div>
  );
};

/** Live search results (people to add) — avatar + name + code so a friend is recognisable at a
 *  glance, with a relation-aware action. Clicking the row opens the full profile card. */
const SearchResults = ({
  results,
  loading,
  onOpen,
}: {
  results: social.SearchResult[];
  loading: boolean;
  onOpen: (r: social.SearchResult) => void;
}): JSX.Element => {
  const { addByCode, accept } = useSocialStore.getState();
  const addToast = useToastStore((s) => s.addToast);

  if (loading && results.length === 0)
    return <div style={{ padding: 16, textAlign: 'center', color: mg.textMuted, fontSize: 13 }}>Поиск…</div>;
  if (results.length === 0)
    return <div style={{ padding: 16, textAlign: 'center', color: mg.textMuted, fontSize: 13 }}>Никого не найдено</div>;

  return (
    <>
      {results.map((r) => {
        const badge = RELATION_BADGE[r.relation];
        return (
          <div
            key={r.accountId}
            onClick={() => onOpen(r)}
            style={{ padding: 8, display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', borderRadius: mg.rSm }}
            onMouseOver={(e) => (e.currentTarget.style.background = mg.rowHover)}
            onMouseOut={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <div
              style={{
                width: 34,
                height: 34,
                flexShrink: 0,
                borderRadius: '50%',
                overflow: 'hidden',
                background: avatarBg(r.displayName),
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                fontWeight: 700,
                fontSize: 14,
              }}
            >
              {r.avatarIcon ? (
                <img src={r.avatarIcon} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                initials(r.displayName)
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: mg.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.displayName}
              </div>
              {r.friendCode && (
                <div style={{ fontSize: 11, color: mg.textMuted, fontFamily: 'monospace', letterSpacing: 0.5 }}>{r.friendCode}</div>
              )}
            </div>
            {r.relation === 'none' ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void addByCode(r.accountId).then((ack) =>
                    addToast({ type: 'system', title: 'Друзья', content: ack.error ?? `Запрос отправлен: ${r.displayName}`, icon: ack.error ? '⚠️' : '➕' }),
                  );
                }}
                style={{ ...btn('primary'), padding: '5px 10px', whiteSpace: 'nowrap' }}
              >
                ＋ Добавить
              </button>
            ) : r.relation === 'incoming' ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  accept(r.accountId);
                }}
                style={{ ...btn('primary'), padding: '5px 10px', whiteSpace: 'nowrap' }}
              >
                ✓ Принять
              </button>
            ) : badge ? (
              <span style={{ fontSize: 11, color: badge.color, whiteSpace: 'nowrap' }}>{badge.label}</span>
            ) : null}
          </div>
        );
      })}
    </>
  );
};
