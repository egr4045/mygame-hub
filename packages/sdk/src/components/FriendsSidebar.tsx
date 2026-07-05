import { useState, type CSSProperties } from 'react';
import type { social } from '@mygame/protocol';
import { useSocialStore } from '../state/socialStore.js';
import { useMenuStore } from '../state/menuStore.js';
import { useChatStore } from '../state/chatStore.js';

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

export const FriendsSidebar = ({ inOverlay = false }: { inOverlay?: boolean }): JSX.Element => {
  const me = useSocialStore((s) => s.me);
  const openMenu = useMenuStore((s) => s.openMenu);
  const openChatWithUser = useChatStore((s) => s.openChatWithUser);
  const friends = useSocialStore((s) => s.friends);
  const status = useSocialStore((s) => s.status);
  const { addByCode, accept, decline, removeFriend } = useSocialStore.getState();
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState(false);

  const incoming = friends.filter((f) => f.status === 'incoming');
  const accepted = friends.filter((f) => f.status === 'accepted');

  const inGame = accepted.filter(f => f.presence === 'online' && f.activity);
  const online = accepted.filter(f => f.presence === 'online' && !f.activity);
  const offline = accepted.filter(f => f.presence === 'offline');

  const add = () => {
    if (code.trim()) {
      addByCode(code);
      setCode('');
    }
  };

  const copyCode = () => {
    if (!me) return;
    void navigator.clipboard?.writeText(me.accountId).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  const handleFriendContext = (e: React.MouseEvent, f: social.Friend) => {
    e.preventDefault();
    e.stopPropagation();
    openMenu(e.clientX, e.clientY, [
      { label: '👤 Посмотреть профиль', action: () => alert(`Открыт профиль ${f.displayName}`) },
      { label: '💬 Написать сообщение', action: () => openChatWithUser(f.accountId, f.displayName) },
      { separator: true, action: () => {} },
      { label: '🎮 Пригласить в игру', action: () => alert('Приглашение отправлено!') },
      { label: '🚀 Присоединиться к игре', action: () => alert('Присоединяемся...'), disabled: !f.presence },
      { label: '🎤 Позвонить', action: () => alert('Звонок...') },
      { separator: true, action: () => {} },
      { label: '🚫 Заблокировать', action: () => alert('Пользователь заблокирован'), danger: true },
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
          <div style={{ fontSize: '12px', color: status === 'connected' ? '#5c7e10' : '#8f98a0', display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: status === 'connected' ? '#5c7e10' : '#8f98a0' }} />
            {status === 'connected' ? 'В сети' : 'Подключение...'}
          </div>
        </div>
      </div>

      {/* Add Friend block */}
      <div style={{ padding: '8px 12px', display: 'flex', gap: 6, borderBottom: '1px solid #23262e' }}>
        <input
          value={code}
          placeholder="Код друга"
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          style={inputStyle}
        />
        <button onClick={add} style={smallBtn}>Добавить</button>
      </div>

      {/* Lists */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 4px' }}>
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
      </div>

      {/* Footer / Your code */}
      <div style={{ padding: 12, background: '#171a21', fontSize: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: '#8f98a0' }}>Ваш код: {me?.accountId?.slice(0, 8) ?? '...'}</span>
        <button onClick={copyCode} style={{...smallBtn, padding: '4px 8px'}}>{copied ? 'Скопировано' : 'Копировать'}</button>
      </div>
    </div>
  );
};

const FriendRow = ({ f, onContextMenu }: { f: social.Friend, onContextMenu: (e: React.MouseEvent) => void }) => {
  const isOnline = f.presence === 'online';
  const isInGame = isOnline && f.activity;

  return (
    <div
      onContextMenu={onContextMenu}
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '6px 8px',
        cursor: 'pointer',
        gap: 12
      }}
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
