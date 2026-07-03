import { useState, useRef, useEffect } from 'react';
import { useChatStore } from '../state/chatStore.js';
import { useSocialStore } from '../state/socialStore.js';
import { useMenuStore } from '../state/menuStore.js';

/**
 * The platform chat widget: DMs and groups, shipped as part of `@mygame/sdk` so any game embedding
 * the SDK gets a working messenger "out of the box" via `mountOverlay()` — the hub renders the same
 * component directly in its own tree instead of through the Shadow-DOM overlay. When closed it's a
 * small launcher button (with an unread badge); when open it's the full draggable/resizable window.
 */
export const ChatWidget = (): JSX.Element => {
  const isOpen = useChatStore((s) => s.isOpen);
  const sessions = useChatStore((s) => s.sessions);
  const activeChatId = useChatStore((s) => s.activeChatId);
  const openChat = useChatStore((s) => s.openChat);
  const toggleChat = useChatStore((s) => s.toggleChat);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const createGroup = useChatStore((s) => s.createGroup);
  const openMenu = useMenuStore((s) => s.openMenu);

  const me = useSocialStore((s) => s.me);
  const friends = useSocialStore((s) => s.friends);
  const acceptedFriends = friends.filter((f) => f.status === 'accepted');

  const [inputText, setInputText] = useState('');

  // Call States: 'none', 'audio', 'video'
  const [callState, setCallState] = useState<'none' | 'audio' | 'video'>('none');
  const [micMuted, setMicMuted] = useState(false);
  const [camMuted, setCamMuted] = useState(false);

  // New-group creation form
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);

  // Dragging state
  const [position, setPosition] = useState({ x: window.innerWidth - 650, y: window.innerHeight - 500 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [size, setSize] = useState({ w: 600, h: 450 });

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        setPosition({ x: e.clientX - dragOffset.x, y: e.clientY - dragOffset.y });
      }
    };
    const handleMouseUp = () => setIsDragging(false);

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragOffset]);

  if (!isOpen) {
    const totalUnread = sessions.reduce((n, s) => n + (s.unreadCount ?? 0), 0);
    return (
      <button
        onClick={toggleChat}
        style={{
          position: 'fixed',
          bottom: 0,
          right: 360,
          zIndex: 1000,
          background: '#171a21',
          color: '#dcdedf',
          border: 'none',
          borderRadius: '8px 8px 0 0',
          padding: '12px 20px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontWeight: 700,
          fontSize: 14,
          boxShadow: '0 -4px 12px rgba(0,0,0,0.7)',
          pointerEvents: 'auto', // re-enable clicks through the SDK overlay's click-through host
        }}
      >
        <span>💬 Мессенджер</span>
        {totalUnread > 0 && (
          <span style={{ background: '#5c7e10', color: '#fff', borderRadius: 10, padding: '2px 8px', fontSize: 12, fontWeight: 800 }}>
            {totalUnread}
          </span>
        )}
      </button>
    );
  }

  const activeSession = sessions.find(s => s.id === activeChatId);

  const handleSend = () => {
    if (!inputText.trim() || !activeChatId || !me) return;
    sendMessage(activeChatId, inputText, me.accountId);
    setInputText('');
  };

  const toggleMember = (id: string) =>
    setSelectedMemberIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const submitGroup = () => {
    if (!groupName.trim() || selectedMemberIds.length === 0) return;
    createGroup(groupName.trim(), selectedMemberIds);
    setGroupName('');
    setSelectedMemberIds([]);
    setIsCreatingGroup(false);
  };

  return (
    <div
      className="civa-fade-in"
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        width: size.w,
        height: size.h,
        background: '#1b2838',
        border: '1px solid #3d4450',
        borderRadius: 8,
        boxShadow: '0 8px 32px rgba(0,0,0,0.8)',
        display: 'flex',
        overflow: 'hidden',
        zIndex: 1000,
        resize: 'both', // Enables native CSS resizing on bottom-right corner!
        pointerEvents: 'auto', // re-enable clicks through the SDK overlay's click-through host
      }}
    >
      {/* Sidebar: Dialogs */}
      <div style={{ width: 220, background: '#171a21', borderRight: '1px solid #3d4450', display: 'flex', flexDirection: 'column' }}>
        <div
          onMouseDown={(e) => {
            setIsDragging(true);
            setDragOffset({ x: e.clientX - position.x, y: e.clientY - position.y });
          }}
          style={{ padding: 16, borderBottom: '1px solid #3d4450', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'grab', background: '#23262e' }}
        >
          <div style={{ fontWeight: 700, fontSize: '14px', color: '#fff' }}>Мессенджер</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={() => setIsCreatingGroup(true)}
              title="Новая группа"
              style={{ background: 'none', border: 'none', color: '#8f98a0', cursor: 'pointer', fontSize: 16 }}
            >
              +
            </button>
            <button onClick={toggleChat} style={{ background: 'none', border: 'none', color: '#8f98a0', cursor: 'pointer', fontSize: 16 }}>×</button>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {sessions.map(s => (
            <div
              key={s.id}
              onClick={() => { openChat(s.id); setCallState('none'); }}
              style={{
                padding: '12px 16px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                background: s.id === activeChatId ? '#2a475e' : 'transparent',
                borderBottom: '1px solid rgba(255,255,255,0.05)'
              }}
              onMouseOver={e => { if(s.id !== activeChatId) e.currentTarget.style.background = '#23262e'; }}
              onMouseOut={e => { if(s.id !== activeChatId) e.currentTarget.style.background = 'transparent'; }}
            >
              <div style={{ width: 32, height: 32, borderRadius: s.type === 'group' ? 4 : '50%', background: '#3d4450', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>
                {s.avatar || (s.type === 'group' ? '👥' : '👤')}
              </div>
              <div style={{ fontSize: '13px', color: '#dcdedf', fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.name}
              </div>
              {!!s.unreadCount && s.id !== activeChatId && (
                <div style={{ background: '#5c7e10', color: '#fff', borderRadius: 10, padding: '1px 7px', fontSize: 11, fontWeight: 800 }}>
                  {s.unreadCount}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Main Chat Area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#1b2838' }}>
        {isCreatingGroup ? (
          /* --- NEW GROUP FORM --- */
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 16, gap: 12, overflowY: 'auto' }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#fff' }}>Новая группа</div>
            <input
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="Название группы"
              style={{ background: '#23262e', border: '1px solid #3d4450', borderRadius: 4, padding: '8px 12px', color: '#fff', fontSize: 13, outline: 'none' }}
            />
            <div style={{ fontSize: 12, color: '#8f98a0' }}>Участники ({acceptedFriends.length ? selectedMemberIds.length : 0}):</div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, overflowY: 'auto' }}>
              {acceptedFriends.length === 0 && (
                <div style={{ color: '#6c7784', fontSize: 12 }}>Нет друзей, кого можно добавить.</div>
              )}
              {acceptedFriends.map((f) => (
                <label key={f.accountId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', cursor: 'pointer', color: '#dcdedf', fontSize: 13 }}>
                  <input type="checkbox" checked={selectedMemberIds.includes(f.accountId)} onChange={() => toggleMember(f.accountId)} />
                  {f.displayName}
                </label>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setIsCreatingGroup(false)} style={{ flex: 1, background: '#3d4450', color: '#fff', border: 'none', padding: '8px', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}>
                Отмена
              </button>
              <button
                onClick={submitGroup}
                disabled={!groupName.trim() || selectedMemberIds.length === 0}
                style={{ flex: 1, background: '#1a9fff', color: '#fff', border: 'none', padding: '8px', borderRadius: 4, cursor: 'pointer', fontWeight: 600, opacity: !groupName.trim() || selectedMemberIds.length === 0 ? 0.5 : 1 }}
              >
                Создать
              </button>
            </div>
          </div>
        ) : activeSession ? (
          <>
            {/* Header */}
            <div style={{ height: 60, padding: '0 16px', borderBottom: '1px solid #3d4450', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#23262e' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 32, height: 32, borderRadius: activeSession.type === 'group' ? 4 : '50%', background: '#3d4450', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {activeSession.avatar || (activeSession.type === 'group' ? '👥' : '👤')}
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '14px', color: '#fff' }}>{activeSession.name}</div>
                  <div style={{ fontSize: '12px', color: '#8f98a0' }}>{activeSession.type === 'group' ? `${activeSession.participants.length} участников` : 'В сети'}</div>
                </div>
              </div>

              {/* Call Action Buttons */}
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => setCallState(callState === 'audio' ? 'none' : 'audio')}
                  style={{ background: callState === 'audio' ? '#5c7e10' : '#3d4450', border: 'none', width: 36, height: 36, borderRadius: '50%', color: '#fff', cursor: 'pointer' }}
                  title="Аудиозвонок"
                >
                  📞
                </button>
                <button
                  onClick={() => setCallState(callState === 'video' ? 'none' : 'video')}
                  style={{ background: callState === 'video' ? '#5c7e10' : '#3d4450', border: 'none', width: 36, height: 36, borderRadius: '50%', color: '#fff', cursor: 'pointer' }}
                  title="Видеозвонок"
                >
                  📹
                </button>
              </div>
            </div>

            {/* Content Area: Chat OR Call */}
            <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column' }}>

              {callState !== 'none' ? (
                /* --- CALL VIEW MOCK --- */
                <div style={{ flex: 1, background: '#000', display: 'flex', flexDirection: 'column' }}>
                  <div style={{ flex: 1, padding: 16, display: 'grid', gridTemplateColumns: activeSession.type === 'group' ? '1fr 1fr' : '1fr', gap: 16 }}>
                    {/* Remote User */}
                    <div style={{ background: '#1a1f29', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #5c7e10', position: 'relative', overflow: 'hidden' }}>
                      {callState === 'video' ? (
                        <div style={{ color: '#8f98a0' }}>[ Веб-камера {activeSession.name} ]</div>
                      ) : (
                        <div style={{ width: 80, height: 80, borderRadius: '50%', background: '#3d4450', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, boxShadow: '0 0 20px rgba(92,126,16,0.5)' }}>
                          👤
                        </div>
                      )}
                      <div style={{ position: 'absolute', bottom: 8, left: 8, background: 'rgba(0,0,0,0.6)', padding: '4px 8px', borderRadius: 4, fontSize: '12px' }}>{activeSession.name}</div>
                    </div>
                    {/* Local User (if group or video) */}
                    {(activeSession.type === 'group' || callState === 'video') && (
                       <div style={{ background: '#1a1f29', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #3d4450', position: 'relative', overflow: 'hidden' }}>
                       {callState === 'video' ? (
                         camMuted ? <div style={{ color: '#ff5c5c' }}>Камера выключена</div> : <div style={{ color: '#8f98a0' }}>[ Моя камера ]</div>
                       ) : (
                         <div style={{ width: 80, height: 80, borderRadius: '50%', background: '#3d4450', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32 }}>
                           👤
                         </div>
                       )}
                       <div style={{ position: 'absolute', bottom: 8, left: 8, background: 'rgba(0,0,0,0.6)', padding: '4px 8px', borderRadius: 4, fontSize: '12px' }}>Вы</div>
                     </div>
                    )}
                  </div>

                  {/* Call Controls */}
                  <div style={{ height: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, padding: '0 16px', background: 'rgba(23,26,33,0.8)' }}>
                    <button onClick={() => setMicMuted(!micMuted)} style={{ background: micMuted ? '#ff5c5c' : '#3d4450', border: 'none', width: 44, height: 44, borderRadius: '50%', color: '#fff', cursor: 'pointer', fontSize: 20 }}>
                      {micMuted ? '🔇' : '🎤'}
                    </button>
                    {callState === 'video' && (
                      <button onClick={() => setCamMuted(!camMuted)} style={{ background: camMuted ? '#ff5c5c' : '#3d4450', border: 'none', width: 44, height: 44, borderRadius: '50%', color: '#fff', cursor: 'pointer', fontSize: 20 }}>
                        {camMuted ? '🚫' : '📹'}
                      </button>
                    )}
                    <button onClick={() => setCallState('none')} style={{ background: '#ff5c5c', border: 'none', width: 44, height: 44, borderRadius: '50%', color: '#fff', cursor: 'pointer', fontSize: 20 }}>
                      📞
                    </button>
                  </div>
                </div>
              ) : (
                /* --- CHAT VIEW --- */
                <>
                  <div style={{ flex: 1, padding: '16px 16px 32px 16px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {activeSession.messages.map(m => {
                      const isMe = m.senderId === me?.accountId;
                      const isSys = m.senderId === 'system';
                      if (isSys) {
                        return <div key={m.id} style={{ textAlign: 'center', color: '#6c7784', fontSize: '12px', margin: '8px 0' }}>{m.text}</div>;
                      }

                      const showReadReceipt = isMe && m.status;
                      const checkmarks = m.status === 'read' ? '✔✔' : '✔';
                      const checkColor = m.status === 'read' ? '#54a5d4' : '#8f98a0';

                      return (
                        <div
                          key={m.id}
                          style={{ alignSelf: isMe ? 'flex-end' : 'flex-start', maxWidth: '75%', position: 'relative' }}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            openMenu(e.clientX, e.clientY, [
                              { label: '↩️ Ответить', action: () => alert('Ответить на сообщение') },
                              { label: '📋 Копировать', action: () => navigator.clipboard.writeText(m.text) },
                              ...(isMe ? [{ label: '✏️ Редактировать', action: () => alert('Редактировать') }] : []),
                              { separator: true, action: () => {} },
                              { label: '🗑️ Удалить', action: () => alert('Сообщение удалено'), danger: true }
                            ]);
                          }}
                        >
                          {!isMe && activeSession.type === 'group' && <div style={{ fontSize: '11px', color: '#8f98a0', marginBottom: 2 }}>{m.senderName}</div>}

                          <div style={{ background: isMe ? '#2a475e' : '#3d4450', padding: '10px 14px', borderRadius: isMe ? '12px 12px 0 12px' : '12px 12px 12px 0', fontSize: '13px', color: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.2)' }}>
                            <div style={{ lineHeight: 1.4 }}>{m.text}</div>
                          </div>

                          {/* Footer: Reactions & Timestamp */}
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: isMe ? 'flex-end' : 'flex-start', marginTop: 4, gap: 8 }}>
                            {m.reactions && Object.entries(m.reactions).map(([emoji, count]) => (
                              <div key={emoji} style={{ background: '#23262e', border: '1px solid #3d4450', borderRadius: 12, padding: '2px 8px', fontSize: '11px', color: '#dcdedf', cursor: 'pointer' }}>
                                {emoji} {count}
                              </div>
                            ))}
                            <div style={{ fontSize: '11px', color: '#6c7784', display: 'flex', alignItems: 'center', gap: 4 }}>
                              {m.timestamp}
                              {showReadReceipt && <span style={{ color: checkColor, fontWeight: 700, letterSpacing: -1 }}>{checkmarks}</span>}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Input */}
                  <div style={{ padding: '12px 16px', background: '#171a21', borderTop: '1px solid #3d4450', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <input
                      type="text"
                      placeholder="Написать сообщение..."
                      value={inputText}
                      onChange={e => setInputText(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleSend()}
                      style={{ flex: 1, background: '#23262e', border: '1px solid #3d4450', borderRadius: 20, padding: '10px 16px', color: '#fff', outline: 'none', fontSize: '13px' }}
                    />
                    <button
                      onClick={handleSend}
                      style={{ background: '#2AABEE', color: '#fff', border: 'none', width: 40, height: 40, borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                      ➤
                    </button>
                  </div>
                </>
              )}
            </div>
          </>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6c7784' }}>
            Выберите диалог из списка
          </div>
        )}
      </div>
    </div>
  );
};
