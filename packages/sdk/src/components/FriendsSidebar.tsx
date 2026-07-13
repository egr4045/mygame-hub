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

const inputStyle: CSSProperties = {
  flex: 1,
  padding: '6px 10px',
  borderRadius: 2,
  background: '#23262e',
  color: '#dcdedf',
  border: '1px solid #101214',
  fontSize: '13px',
  minWidth: 0,
};

const smallBtn: CSSProperties = {
  padding: '6px 10px',
  borderRadius: 2,
  background: '#3d4450',
  color: '#dcdedf',
  fontWeight: 600,
  fontSize: '13px',
  border: 'none',
  cursor: 'pointer',
};

const sectionLabel: CSSProperties = {
  fontSize: '11px',
  color: '#6c7784',
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
  self: { label: 'это вы', color: '#8f98a0' },
  friend: { label: '✓ в друзьях', color: '#5c7e10' },
  outgoing: { label: 'заявка отправлена', color: '#8f98a0' },
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
      background: '#1b2838',
      color: '#dcdedf',
      ...(inOverlay ? {} : {
        position: 'absolute', right: 16, bottom: 16, width: 300, height: 500, borderRadius: 4, boxShadow: '0 4px 16px rgba(0,0,0,0.5)', zIndex: 100
      })
    }}>
      {/* Header */}
      <div style={{ padding: 12, background: '#171a21', display: 'flex', alignItems: 'center' }}>
        <div style={{ width: 40, height: 40, background: '#3d4450', borderRadius: 4, marginRight: 12, overflow: 'hidden' }}>
          {me?.avatarIcon && (
            <img src={me.avatarIcon} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          )}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: '15px' }}>{me?.displayName || 'Загрузка...'}</div>
          <div style={{ fontSize: '12px', color: status === 'connected' ? (myActivity ? '#a3d928' : '#5c7e10') : '#8f98a0', display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: status === 'connected' ? (myActivity ? '#a3d928' : '#5c7e10') : '#8f98a0' }} />
            {status === 'connected' ? (myActivity ? `Играет в ${myActivity.gameName}` : 'В сети') : 'Подключение...'}
          </div>
        </div>
      </div>

      {/* Find friends — search by nick OR code (exact code ranked first). */}
      <div style={{ padding: '8px 12px', display: 'flex', gap: 6, borderBottom: '1px solid #23262e' }}>
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
          <button onClick={() => setCode('')} style={{ ...smallBtn, padding: '6px 9px' }} aria-label="Очистить">
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
                <button onClick={() => accept(f.accountId)} style={{...smallBtn, background: '#5c7e10', padding: '2px 8px'}}>✓</button>
                <button onClick={() => decline(f.accountId)} style={{...smallBtn, padding: '2px 8px'}}>✕</button>
              </div>
            ))}
          </>
        )}

        {outgoing.length > 0 && (
          <>
            <div style={sectionLabel}>ОТПРАВЛЕННЫЕ</div>
            {outgoing.map(f => (
              <div key={f.accountId} style={{ padding: '4px 8px', display: 'flex', gap: 8 }}>
                <span style={{flex: 1, fontSize: '13px', color: '#8f98a0'}}>{f.displayName}</span>
                <button onClick={() => decline(f.accountId)} style={{...smallBtn, padding: '2px 8px'}}>Отменить</button>
              </div>
            ))}
          </>
        )}
        </>
        )}
      </div>

      {/* Footer / Your code */}
      <div style={{ padding: 12, background: '#171a21', fontSize: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: '#8f98a0' }}>Ваш код: <strong style={{ color: '#dcdedf', letterSpacing: 1 }}>{myFriendCode}</strong></span>
        <button onClick={copyCode} style={{...smallBtn, padding: '4px 8px'}}>{copied ? 'Скопировано' : 'Копировать'}</button>
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
    background: isDragging ? '#23262e' : 'transparent',
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
      onMouseOver={(e) => e.currentTarget.style.background = '#23262e'}
      onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
    >
      <div style={{ width: 32, height: 32, background: isInGame ? '#5c7e10' : (isOnline ? '#54a5d4' : '#3d4450'), borderRadius: 2, padding: 2, overflow: 'hidden' }}>
        {f.avatarIcon ? (
          <img src={f.avatarIcon} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{ width: '100%', height: '100%', background: '#1a1f29' }} />
        )}
      </div>
      <div>
        <div style={{ fontSize: '13px', fontWeight: 600, color: isInGame ? '#a3d928' : (isOnline ? '#54a5d4' : '#8f98a0'), display: 'flex', alignItems: 'center', gap: 4 }}>
          {f.displayName}
          {/* Generic "has an equipped title" indicator -- resolving it to a name/icon needs a
              per-game display catalog the SDK deliberately doesn't own (see ARCHITECTURE.md). */}
          {f.titleAchievement && <span title="Есть титул">🏅</span>}
        </div>
        <div style={{ fontSize: '11px', color: isInGame ? '#a3d928' : '#8f98a0' }}>
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
    return <div style={{ padding: 16, textAlign: 'center', color: '#8f98a0', fontSize: 13 }}>Поиск…</div>;
  if (results.length === 0)
    return <div style={{ padding: 16, textAlign: 'center', color: '#8f98a0', fontSize: 13 }}>Никого не найдено</div>;

  return (
    <>
      {results.map((r) => {
        const badge = RELATION_BADGE[r.relation];
        return (
          <div
            key={r.accountId}
            onClick={() => onOpen(r)}
            style={{ padding: 8, display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', borderRadius: 4 }}
            onMouseOver={(e) => (e.currentTarget.style.background = '#23262e')}
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
              <div style={{ fontSize: 13, fontWeight: 600, color: '#dcdedf', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.displayName}
              </div>
              {r.friendCode && (
                <div style={{ fontSize: 11, color: '#6c7784', fontFamily: 'monospace', letterSpacing: 0.5 }}>{r.friendCode}</div>
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
                style={{ ...smallBtn, background: '#2AABEE', padding: '5px 10px', whiteSpace: 'nowrap' }}
              >
                ＋ Добавить
              </button>
            ) : r.relation === 'incoming' ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  accept(r.accountId);
                }}
                style={{ ...smallBtn, background: '#5c7e10', padding: '5px 10px', whiteSpace: 'nowrap' }}
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
