import { useState, useRef, useEffect } from 'react';
import { RoomEvent, type RemoteTrack, type RemoteParticipant } from 'livekit-client';
import { useChatStore, getCallRoom, type ChatSession } from '../state/chatStore.js';
import { useSocialStore } from '../state/socialStore.js';
import { useMenuStore } from '../state/menuStore.js';
import { useDroppable } from '@dnd-kit/core';
import ReactMarkdown from 'react-markdown';
import type { social } from '@mygame/protocol';

const activityText = (f?: Omit<social.Friend, 'status'>): string => {
  if (!f) return 'Неизвестно';
  if (f.presence === 'offline') return 'Не в сети';
  if (f.activity) return `Играет в ${f.activity.gameName}`;
  return 'В сети';
};

/** A session-list row that's also a drop target for `SocialDndProvider` — dragging a friend here
 *  (id `friend:<accountId>`) adds them to this conversation. Id convention: `chat:<sessionId>`. */
const DroppableChatSession = ({
  s,
  activeChatId,
  onClick,
}: {
  s: ChatSession;
  activeChatId: string | null;
  onClick: () => void;
}): JSX.Element => {
  const { isOver, setNodeRef } = useDroppable({ id: `chat:${s.id}` });
  const active = s.id === activeChatId;
  return (
    <div
      ref={setNodeRef}
      onClick={onClick}
      style={{
        padding: '12px 16px',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        background: isOver ? 'rgba(42,171,238,0.2)' : active ? '#2a475e' : 'transparent',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
      }}
      onMouseOver={(e) => { if (!active) e.currentTarget.style.background = '#23262e'; }}
      onMouseOut={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
    >
      <div style={{ width: 32, height: 32, borderRadius: s.type === 'group' ? 4 : '50%', background: '#3d4450', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>
        {s.avatar || (s.type === 'group' ? '👥' : '👤')}
      </div>
      <div style={{ fontSize: '13px', color: '#dcdedf', fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {s.name}
      </div>
      {!!s.unreadCount && !active && (
        <div style={{ background: '#5c7e10', color: '#fff', borderRadius: 10, padding: '1px 7px', fontSize: 11, fontWeight: 800 }}>
          {s.unreadCount}
        </div>
      )}
    </div>
  );
};

/** The "no conversation open" placeholder — also a drop target (id `chat:new`) for starting a new
 *  DM by dragging a friend here; `SocialDndProvider` special-cases this id to open-or-create a DM. */
const DroppableNewChatArea = (): JSX.Element => {
  const { isOver, setNodeRef } = useDroppable({ id: 'chat:new' });
  return (
    <div
      ref={setNodeRef}
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: isOver ? '#2AABEE' : '#6c7784',
        background: isOver ? 'rgba(42,171,238,0.1)' : 'transparent',
      }}
    >
      Выберите диалог из списка
    </div>
  );
};

export const ChatWidget = (): JSX.Element => {
  const isOpen = useChatStore((s) => s.isOpen);
  const sessions = useChatStore((s) => s.sessions);
  const activeChatId = useChatStore((s) => s.activeChatId);
  const openChat = useChatStore((s) => s.openChat);
  const toggleChat = useChatStore((s) => s.toggleChat);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const createGroup = useChatStore((s) => s.createGroup);
  const addMembers = useChatStore((s) => s.addMembers);
  const leaveGroup = useChatStore((s) => s.leaveGroup);
  const removeMember = useChatStore((s) => s.removeMember);
  const sendTyping = useChatStore((s) => s.sendTyping);
  const typing = useChatStore((s) => s.typing);
  const openMenu = useMenuStore((s) => s.openMenu);

  const activeCall = useChatStore((s) => s.activeCall);
  const ring = useChatStore((s) => s.ring);
  const acceptCall = useChatStore((s) => s.acceptCall);
  const declineCall = useChatStore((s) => s.declineCall);
  const hangup = useChatStore((s) => s.hangup);
  const toggleMic = useChatStore((s) => s.toggleMic);
  const toggleCam = useChatStore((s) => s.toggleCam);

  const me = useSocialStore((s) => s.me);
  const friends = useSocialStore((s) => s.friends);
  const acceptedFriends = friends.filter((f) => f.status === 'accepted');
  const openChatWithUser = useChatStore((s) => s.openChatWithUser);
  const { addByCode } = useSocialStore.getState();
  const [viewingProfile, setViewingProfile] = useState<Omit<social.Friend, 'status'> | null>(null);

  const [inputText, setInputText] = useState('');

  const remoteTilesRef = useRef<HTMLDivElement>(null);
  const localTileRef = useRef<HTMLDivElement>(null);
  const [micMuted, setMicMuted] = useState(false);
  const [camMuted, setCamMuted] = useState(false);

  useEffect(() => {
    if (activeCall?.status !== 'connected') return;
    const room = getCallRoom();
    if (!room) return;

    const tileFor = (identity: string): HTMLDivElement => {
      const grid = remoteTilesRef.current!;
      let tile = grid.querySelector<HTMLDivElement>(`[data-participant="${identity}"]`);
      if (!tile) {
        tile = document.createElement('div');
        tile.dataset.participant = identity;
        tile.style.cssText =
          'background:#1a1f29;border-radius:8px;position:relative;overflow:hidden;border:2px solid #5c7e10;min-height:120px;';
        grid.appendChild(tile);
      }
      return tile;
    };

    const onSubscribed = (track: RemoteTrack, _pub: unknown, participant: RemoteParticipant) => {
      const el = track.attach();
      el.style.cssText = 'width:100%;height:100%;object-fit:cover;';
      tileFor(participant.identity).appendChild(el);
    };
    const onUnsubscribed = (track: RemoteTrack) => {
      track.detach().forEach((el) => el.remove());
    };
    const onParticipantLeft = (participant: RemoteParticipant) => {
      remoteTilesRef.current?.querySelector(`[data-participant="${participant.identity}"]`)?.remove();
    };

    room.on(RoomEvent.TrackSubscribed, onSubscribed);
    room.on(RoomEvent.TrackUnsubscribed, onUnsubscribed);
    room.on(RoomEvent.ParticipantDisconnected, onParticipantLeft);

    room.remoteParticipants.forEach((p) => {
      p.trackPublications.forEach((pub) => {
        if (pub.track) onSubscribed(pub.track, pub, p);
      });
    });

    const attachLocal = () => {
      const container = localTileRef.current;
      if (!container) return;
      container.innerHTML = '';
      room.localParticipant.videoTrackPublications.forEach((pub) => {
        if (!pub.track) return;
        const el = pub.track.attach();
        el.style.cssText = 'width:100%;height:100%;object-fit:cover;';
        container.appendChild(el);
      });
    };
    attachLocal();
    room.on(RoomEvent.LocalTrackPublished, attachLocal);
    room.on(RoomEvent.LocalTrackUnpublished, attachLocal);

    return () => {
      room.off(RoomEvent.TrackSubscribed, onSubscribed);
      room.off(RoomEvent.TrackUnsubscribed, onUnsubscribed);
      room.off(RoomEvent.ParticipantDisconnected, onParticipantLeft);
      room.off(RoomEvent.LocalTrackPublished, attachLocal);
      room.off(RoomEvent.LocalTrackUnpublished, attachLocal);
    };
  }, [activeCall?.status]);

  useEffect(() => {
    if (activeCall?.status !== 'connected') {
      setMicMuted(false);
      setCamMuted(false);
    }
  }, [activeCall?.status]);

  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [isAddingMembers, setIsAddingMembers] = useState(false);
  const [addMemberIds, setAddMemberIds] = useState<string[]>([]);
  const [isViewingMembers, setIsViewingMembers] = useState(false);

  const [position, setPosition] = useState(() => {
    const saved = localStorage.getItem('chat_position');
    return saved ? JSON.parse(saved) : { x: window.innerWidth - 650, y: window.innerHeight - 500 };
  });
  const [size, setSize] = useState(() => {
    const saved = localStorage.getItem('chat_size');
    return saved ? JSON.parse(saved) : { w: 600, h: 450 };
  });

  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        const newPos = { x: e.clientX - dragOffset.x, y: e.clientY - dragOffset.y };
        setPosition(newPos);
        localStorage.setItem('chat_position', JSON.stringify(newPos));
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
          pointerEvents: 'auto',
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
  const callForThisChat = activeSession && activeCall?.conversationId === activeSession.id ? activeCall : null;

  const handleSend = () => {
    if (!inputText.trim() || !activeChatId || !me) return;
    sendMessage(activeChatId, inputText, me.accountId);
    setInputText('');
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputText(e.target.value);
    if (activeChatId) sendTyping(activeChatId);
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

  const toggleAddMember = (id: string) =>
    setAddMemberIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const submitAddMembers = () => {
    if (!activeChatId || addMemberIds.length === 0) return;
    addMembers(activeChatId, addMemberIds);
    setAddMemberIds([]);
    setIsAddingMembers(false);
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
        resize: 'both',
        pointerEvents: 'auto',
      }}
      onMouseUp={(e) => {
        // Handle resize by storing size on mouseup when not dragging
        if (!isDragging && e.currentTarget) {
          const newSize = { w: e.currentTarget.offsetWidth, h: e.currentTarget.offsetHeight };
          if (newSize.w !== size.w || newSize.h !== size.h) {
            setSize(newSize);
            localStorage.setItem('chat_size', JSON.stringify(newSize));
          }
        }
      }}
    >
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
            <DroppableChatSession
              key={s.id}
              s={s}
              activeChatId={activeChatId}
              onClick={() => { openChat(s.id); setIsAddingMembers(false); setIsViewingMembers(false); }}
            />
          ))}
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#1b2838' }}>
        {isCreatingGroup ? (
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
              {acceptedFriends.map((f) => {
                const isOnline = f.presence === 'online';
                const isInGame = isOnline && !!f.activity;
                return (
                  <label key={f.accountId} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 8px', cursor: 'pointer', color: '#dcdedf', fontSize: 13, borderRadius: 4 }}
                    onMouseOver={(e) => e.currentTarget.style.background = '#23262e'}
                    onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    <input type="checkbox" checked={selectedMemberIds.includes(f.accountId)} onChange={() => toggleMember(f.accountId)} />
                    <div style={{ width: 32, height: 32, background: isInGame ? '#5c7e10' : (isOnline ? '#54a5d4' : '#3d4450'), borderRadius: 2, padding: 2, overflow: 'hidden' }}>
                      {f.avatarIcon ? (
                        <img src={f.avatarIcon} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <div style={{ width: '100%', height: '100%', background: '#1a1f29' }} />
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontWeight: 600, color: isInGame ? '#a3d928' : (isOnline ? '#54a5d4' : '#8f98a0') }}>{f.displayName}</span>
                      <span style={{ fontSize: 11, color: isInGame ? '#a3d928' : '#8f98a0' }}>{activityText(f)}</span>
                    </div>
                  </label>
                );
              })}
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
        ) : isAddingMembers && activeSession ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 16, gap: 12, overflowY: 'auto' }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#fff' }}>Добавить в «{activeSession.name}»</div>
            {(() => {
              const addable = acceptedFriends.filter(
                (f) => !activeSession.participants.some((p) => p.accountId === f.accountId),
              );
              return (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, overflowY: 'auto' }}>
                  {addable.length === 0 && (
                    <div style={{ color: '#6c7784', fontSize: 12 }}>Все друзья уже в группе.</div>
                  )}
                  {addable.map((f) => {
                    const isOnline = f.presence === 'online';
                    const isInGame = isOnline && !!f.activity;
                    return (
                      <label key={f.accountId} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 8px', cursor: 'pointer', color: '#dcdedf', fontSize: 13, borderRadius: 4 }}
                        onMouseOver={(e) => e.currentTarget.style.background = '#23262e'}
                        onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
                      >
                        <input type="checkbox" checked={addMemberIds.includes(f.accountId)} onChange={() => toggleAddMember(f.accountId)} />
                        <div style={{ width: 32, height: 32, background: isInGame ? '#5c7e10' : (isOnline ? '#54a5d4' : '#3d4450'), borderRadius: 2, padding: 2, overflow: 'hidden' }}>
                          {f.avatarIcon ? (
                            <img src={f.avatarIcon} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          ) : (
                            <div style={{ width: '100%', height: '100%', background: '#1a1f29' }} />
                          )}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <span style={{ fontWeight: 600, color: isInGame ? '#a3d928' : (isOnline ? '#54a5d4' : '#8f98a0') }}>{f.displayName}</span>
                          <span style={{ fontSize: 11, color: isInGame ? '#a3d928' : '#8f98a0' }}>{activityText(f)}</span>
                        </div>
                      </label>
                    );
                  })}
                </div>
              );
            })()}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => { setIsAddingMembers(false); setAddMemberIds([]); }}
                style={{ flex: 1, background: '#3d4450', color: '#fff', border: 'none', padding: '8px', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}
              >
                Отмена
              </button>
              <button
                onClick={submitAddMembers}
                disabled={addMemberIds.length === 0}
                style={{ flex: 1, background: '#1a9fff', color: '#fff', border: 'none', padding: '8px', borderRadius: 4, cursor: 'pointer', fontWeight: 600, opacity: addMemberIds.length === 0 ? 0.5 : 1 }}
              >
                Добавить
              </button>
            </div>
          </div>
        ) : isViewingMembers && activeSession ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 16, gap: 12, overflowY: 'auto' }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#fff' }}>Участники «{activeSession.name}»</div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, overflowY: 'auto' }}>
              {activeSession.participants.map((p) => {
                const isOwner = p.accountId === activeSession.ownerId;
                const canKick = me?.accountId === activeSession.ownerId && !isOwner && p.accountId !== me?.accountId;
                const f = friends.find(fr => fr.accountId === p.accountId);
                
                return (
                  <div 
                    key={p.accountId} 
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', color: '#dcdedf', fontSize: 13, borderRadius: 4, cursor: 'pointer' }}
                    onMouseOver={(e) => e.currentTarget.style.background = '#23262e'}
                    onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      openMenu(e.clientX, e.clientY, [
                        { label: '💬 Написать сообщение', action: () => openChatWithUser(p.accountId, p.displayName) },
                        { label: '👤 Посмотреть профиль', action: () => {
                           if (f) setViewingProfile(f);
                           else setViewingProfile({ accountId: p.accountId, displayName: p.displayName, avatarIcon: null, titleAchievement: null, presence: 'offline', activity: null });
                        } },
                        { separator: true, action: () => {} },
                        ...(f ? [] : [{ label: '➕ Добавить в друзья', action: () => addByCode(p.accountId) }]),
                        { label: '🔗 Скопировать ID', action: () => navigator.clipboard.writeText(p.accountId) },
                      ]);
                    }}
                  >
                    <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#3d4450', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                      {f?.avatarIcon ? <img src={f.avatarIcon} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '👤'}
                    </div>
                    <span style={{ flex: 1 }}>
                      {p.displayName}
                      {isOwner && <span style={{ color: '#8f98a0', fontSize: 11 }}> (владелец)</span>}
                    </span>
                    {canKick && (
                      <button
                        onClick={(e) => { e.stopPropagation(); removeMember(activeSession.id, p.accountId); }}
                        title="Исключить из группы"
                        style={{ background: '#3d4450', border: 'none', borderRadius: 4, color: '#ff5c5c', cursor: 'pointer', padding: '2px 8px', fontSize: 13 }}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            <button
              onClick={() => setIsViewingMembers(false)}
              style={{ background: '#3d4450', color: '#fff', border: 'none', padding: '8px', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}
            >
              Закрыть
            </button>
          </div>
        ) : activeSession ? (
          <>
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

              <div style={{ display: 'flex', gap: 8 }}>
                {activeSession.type === 'group' && (
                  <>
                    <button
                      onClick={() => setIsViewingMembers(true)}
                      style={{ background: '#3d4450', border: 'none', width: 36, height: 36, borderRadius: '50%', color: '#fff', cursor: 'pointer' }}
                      title="Участники"
                    >
                      👥
                    </button>
                    <button
                      onClick={() => setIsAddingMembers(true)}
                      style={{ background: '#3d4450', border: 'none', width: 36, height: 36, borderRadius: '50%', color: '#fff', cursor: 'pointer' }}
                      title="Добавить участника"
                    >
                      ➕
                    </button>
                    <button
                      onClick={() => leaveGroup(activeSession.id)}
                      style={{ background: '#3d4450', border: 'none', width: 36, height: 36, borderRadius: '50%', color: '#fff', cursor: 'pointer' }}
                      title="Покинуть группу"
                    >
                      🚪
                    </button>
                  </>
                )}
                <button
                  onClick={() => (callForThisChat ? hangup() : ring(activeSession.id, 'audio'))}
                  style={{ background: callForThisChat?.type === 'audio' ? '#5c7e10' : '#3d4450', border: 'none', width: 36, height: 36, borderRadius: '50%', color: '#fff', cursor: 'pointer' }}
                  title="Аудиозвонок"
                >
                  📞
                </button>
                <button
                  onClick={() => (callForThisChat ? hangup() : ring(activeSession.id, 'video'))}
                  style={{ background: callForThisChat?.type === 'video' ? '#5c7e10' : '#3d4450', border: 'none', width: 36, height: 36, borderRadius: '50%', color: '#fff', cursor: 'pointer' }}
                  title="Видеозвонок"
                >
                  📹
                </button>
                <button
                  onClick={() => (callForThisChat ? hangup() : ring(activeSession.id, 'screen'))}
                  style={{ background: callForThisChat?.type === 'screen' ? '#5c7e10' : '#3d4450', border: 'none', width: 36, height: 36, borderRadius: '50%', color: '#fff', cursor: 'pointer' }}
                  title="Демонстрация экрана"
                >
                  🖥️
                </button>
              </div>
            </div>

            <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column' }}>

              {callForThisChat ? (
                <div style={{ flex: 1, background: '#000', display: 'flex', flexDirection: 'column' }}>
                  {callForThisChat.status === 'ringing-out' && (
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, color: '#dcdedf' }}>
                      <div style={{ width: 80, height: 80, borderRadius: '50%', background: '#3d4450', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, boxShadow: '0 0 20px rgba(92,126,16,0.5)' }}>👤</div>
                      <div>Звоним «{activeSession.name}»…</div>
                    </div>
                  )}
                  {callForThisChat.status === 'ringing-in' && (
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, color: '#dcdedf' }}>
                      <div>{callForThisChat.fromName ?? activeSession.name} звонит ({callForThisChat.type === 'video' ? 'видео' : 'аудио'})…</div>
                      <div style={{ display: 'flex', gap: 16 }}>
                        <button onClick={() => void acceptCall(activeSession.id)} style={{ background: '#5c7e10', border: 'none', borderRadius: '50%', width: 48, height: 48, color: '#fff', cursor: 'pointer', fontSize: 20 }}>✓</button>
                        <button onClick={() => declineCall(activeSession.id)} style={{ background: '#ff5c5c', border: 'none', borderRadius: '50%', width: 48, height: 48, color: '#fff', cursor: 'pointer', fontSize: 20 }}>✕</button>
                      </div>
                    </div>
                  )}
                  {callForThisChat.status === 'connecting' && (
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8f98a0' }}>Подключение…</div>
                  )}
                  {callForThisChat.status === 'connected' && (
                    <>
                      <div ref={remoteTilesRef} style={{ flex: 1, padding: 16, display: 'grid', gridTemplateColumns: activeSession.type === 'group' ? '1fr 1fr' : '1fr', gap: 16, gridAutoRows: '1fr' }} />
                      {callForThisChat.type === 'video' && (
                        <div ref={localTileRef} style={{ position: 'absolute', bottom: 76, right: 16, width: 120, height: 90, background: '#1a1f29', borderRadius: 8, border: '1px solid #3d4450', overflow: 'hidden' }} />
                      )}
                      <div style={{ height: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, padding: '0 16px', background: 'rgba(23,26,33,0.8)' }}>
                        <button
                          onClick={() => { setMicMuted(!micMuted); void toggleMic(); }}
                          style={{ background: micMuted ? '#ff5c5c' : '#3d4450', border: 'none', width: 44, height: 44, borderRadius: '50%', color: '#fff', cursor: 'pointer', fontSize: 20 }}
                        >
                          {micMuted ? '🔇' : '🎤'}
                        </button>
                        <button
                          onClick={() => { setCamMuted(!camMuted); void toggleCam(); }}
                          style={{ background: camMuted ? '#ff5c5c' : '#3d4450', border: 'none', width: 44, height: 44, borderRadius: '50%', color: '#fff', cursor: 'pointer', fontSize: 20 }}
                        >
                          {camMuted ? '🚫' : '📹'}
                        </button>
                        <button onClick={() => hangup()} style={{ background: '#ff5c5c', border: 'none', width: 44, height: 44, borderRadius: '50%', color: '#fff', cursor: 'pointer', fontSize: 20 }}>
                          📞
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <>
                  <div
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={async (e) => {
                      e.preventDefault();
                      const file = e.dataTransfer.files?.[0];
                      if (!file) return;
                      // Simple upload logic via standard fetch API to our /chat/upload service
                      const formData = new FormData();
                      formData.append('file', file);
                      try {
                        const token = localStorage.getItem('mygame:auth');
                        const res = await fetch('http://localhost:3004/chat/upload', {
                          method: 'POST',
                          headers: { authorization: `Bearer ${token}` },
                          body: formData
                        });
                        const data = await res.json();
                        if (data.url && me) {
                          useChatStore.getState().sendMessage(activeSession.id, `Вложение: [${file.name}](${data.url})`, me.accountId);
                        }
                      } catch (err) {
                        console.error('File upload failed', err);
                      }
                    }}
                    style={{ flex: 1, padding: '16px 16px 32px 16px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}
                  >
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
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: isMe ? 'flex-end' : 'flex-start',
                            alignSelf: isMe ? 'flex-end' : 'flex-start',
                            maxWidth: '100%',
                          }}
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

                          <div style={{ background: isMe ? '#2AABEE' : '#3d4450', padding: '8px 12px', borderRadius: 8, color: '#fff', maxWidth: '85%', wordBreak: 'break-word' }}>
                            <div className="chat-markdown" style={{ lineHeight: 1.4, margin: 0 }}>
                              <ReactMarkdown>{m.text}</ReactMarkdown>
                            </div>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: isMe ? 'flex-end' : 'flex-start', marginTop: 4, gap: 8 }}>
                            {m.reactions && Object.entries(m.reactions).map(([emoji, count]) => (
                              <div key={emoji} style={{ background: '#23262e', border: '1px solid #3d4450', borderRadius: 12, padding: '2px 8px', fontSize: '11px', color: '#dcdedf', cursor: 'pointer' }}>
                                {emoji} {count}
                              </div>
                            ))}
                            <div style={{ fontSize: '11px', color: '#6c7784' }}>{m.timestamp} {isMe && (m.status === 'read' ? '✓✓' : '✓')}</div>
                          </div>
                        </div>
                      );
                    })}

                    {/* Typing Indicators */}
                    {(() => {
                      const sessionTyping = typing[activeSession.id];
                      if (!sessionTyping) return null;
                      const now = Date.now();
                      const typingUsers = Object.entries(sessionTyping)
                        .filter(([userId, ts]) => userId !== me?.accountId && (now - ts < 3000))
                        .map(([userId]) => {
                          const participant = activeSession.participants.find(p => p.accountId === userId);
                          return participant?.displayName || 'Кто-то';
                        });

                      if (typingUsers.length === 0) return null;
                      
                      const text = typingUsers.length > 2 
                        ? `${typingUsers.slice(0, 2).join(', ')} и еще ${typingUsers.length - 2} печатают...`
                        : `${typingUsers.join(', ')} ${typingUsers.length === 1 ? 'печатает...' : 'печатают...'}`;

                      return (
                        <div style={{ fontSize: '12px', color: '#8f98a0', fontStyle: 'italic', alignSelf: 'flex-start' }}>
                          {text}
                        </div>
                      );
                    })()}
                  </div>

                  <div style={{ padding: '12px 16px', background: '#171a21', borderTop: '1px solid #3d4450', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <input
                      type="text"
                      placeholder="Написать сообщение..."
                      value={inputText}
                      onChange={handleInputChange}
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
          <DroppableNewChatArea />
        )}
      </div>

      {viewingProfile && (
        <div
          onClick={() => setViewingProfile(null)}
          style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#1b2838', border: '1px solid #3d4450', borderRadius: 8, padding: 24, width: 280, textAlign: 'center' }}>
            <div style={{ width: 80, height: 80, borderRadius: '50%', margin: '0 auto 12px', overflow: 'hidden', background: '#3d4450', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32 }}>
              {viewingProfile.avatarIcon ? (
                <img src={viewingProfile.avatarIcon} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : '👤'}
            </div>
            <div style={{ fontWeight: 700, fontSize: 16, color: '#fff' }}>{viewingProfile.displayName}</div>
            <div style={{ fontSize: 12, color: '#8f98a0', marginTop: 4 }}>{activityText(viewingProfile)}</div>
            {viewingProfile.titleAchievement && (
              <div style={{ fontSize: 12, color: '#dcdedf', marginTop: 8 }}>🏅 Есть титул</div>
            )}
            <button onClick={() => setViewingProfile(null)} style={{ padding: '6px 10px', borderRadius: 2, background: '#3d4450', color: '#dcdedf', fontWeight: 600, fontSize: '13px', border: 'none', cursor: 'pointer', marginTop: 16, width: '100%' }}>Закрыть</button>
          </div>
        </div>
      )}
    </div>
  );
};
