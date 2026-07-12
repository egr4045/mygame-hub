import { useEffect, useRef, useState } from 'react';
import { useChatStore, type ChatMessage, type ChatSession } from '../state/chatStore.js';
import { useSocialStore } from '../state/socialStore.js';
import { useMenuStore } from '../state/menuStore.js';
import { useToastStore } from '../state/toastStore.js';
import { useDroppable } from '@dnd-kit/core';
import ReactMarkdown from 'react-markdown';
import { config } from '../config.js';
import { freshAccessToken } from '../authClient.js';
import type { social } from '@mygame/protocol';

const activityText = (f?: Omit<social.Friend, 'status'>): string => {
  if (!f) return 'Неизвестно';
  if (f.presence === 'offline') return 'Не в сети';
  if (f.activity) return `Играет в ${f.activity.gameName}`;
  return 'В сети';
};

/** First 1–2 letters for an avatar placeholder. */
const initials = (name: string): string =>
  (name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('') || '?';

/** Deterministic pleasant background from a name, so placeholders aren't all one flat colour. */
const avatarBg = (name: string): string => {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return `hsl(${h} 45% 42%)`;
};

/** Avatar that always shows *something* — the image, or initials on a coloured disc/square (never a
 *  blank box). `shape` is 'circle' for people, 'square' for groups. */
const Avatar = ({
  src,
  name,
  size,
  shape = 'circle',
}: {
  src?: string | null | undefined;
  name: string;
  size: number;
  shape?: 'circle' | 'square';
}): JSX.Element => {
  const radius = shape === 'circle' ? '50%' : Math.max(4, size * 0.18);
  return (
    <div
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: radius,
        overflow: 'hidden',
        background: src ? '#3d4450' : avatarBg(name),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fff',
        fontWeight: 700,
        fontSize: Math.round(size * 0.4),
        lineHeight: 1,
      }}
    >
      {src ? <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initials(name)}
    </div>
  );
};

const MIN_W = 380;
const MIN_H = 320;
/** Client-side upload guard — mirrors the chat service's default CHAT_UPLOAD_MAX_BYTES (50 MB). */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/** Small round icon button used in the window headers (close, etc.). */
const headerIconBtn: React.CSSProperties = {
  background: '#3d4450',
  border: 'none',
  color: '#dcdedf',
  cursor: 'pointer',
  fontSize: 14,
  lineHeight: 1,
  width: 26,
  height: 26,
  borderRadius: '50%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
};

const clampSize = (s: { w: number; h: number }): { w: number; h: number } => ({
  w: Math.min(Math.max(MIN_W, s.w), window.innerWidth),
  h: Math.min(Math.max(MIN_H, s.h), window.innerHeight),
});

/** Keep the window reachable: at least the header strip stays inside the viewport, so a position
 *  persisted on a big monitor can't strand the widget off-screen on a smaller one. */
const clampPos = (p: { x: number; y: number }, s: { w: number; h: number }): { x: number; y: number } => ({
  x: Math.max(0, Math.min(p.x, Math.max(0, window.innerWidth - Math.min(s.w, window.innerWidth)))),
  y: Math.max(0, Math.min(p.y, Math.max(0, window.innerHeight - 48))),
});

const loadJson = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
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
      className={active ? undefined : 'cw-hover-row'}
      style={{
        padding: '12px 16px',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        ...(isOver ? { background: 'rgba(42,171,238,0.2)' } : active ? { background: '#2a475e' } : {}),
        borderBottom: '1px solid rgba(255,255,255,0.05)',
      }}
    >
      <Avatar src={s.avatar} name={s.name} size={32} shape={s.type === 'group' ? 'square' : 'circle'} />

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
        color: isOver ? '#2AABEE' : '#8f98a0',
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
  const connStatus = useChatStore((s) => s.status);
  const chatError = useChatStore((s) => s.error);
  const clearError = useChatStore((s) => s.clearError);
  const openChat = useChatStore((s) => s.openChat);
  const toggleChat = useChatStore((s) => s.toggleChat);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const editMessage = useChatStore((s) => s.editMessage);
  const deleteMessage = useChatStore((s) => s.deleteMessage);
  const loadOlder = useChatStore((s) => s.loadOlder);
  const createGroup = useChatStore((s) => s.createGroup);
  const addMembers = useChatStore((s) => s.addMembers);
  const leaveGroup = useChatStore((s) => s.leaveGroup);
  const removeMember = useChatStore((s) => s.removeMember);
  const setGroupRole = useChatStore((s) => s.setGroupRole);
  const sendTyping = useChatStore((s) => s.sendTyping);
  const typing = useChatStore((s) => s.typing);
  const openMenu = useMenuStore((s) => s.openMenu);
  const addToast = useToastStore((s) => s.addToast);

  // Call *starting* lives here (the header buttons); the call surface itself is rendered globally by
  // <CallView />, independent of which chat is open.
  const activeCall = useChatStore((s) => s.activeCall);
  const ring = useChatStore((s) => s.ring);
  const hangup = useChatStore((s) => s.hangup);

  const me = useSocialStore((s) => s.me);
  const friends = useSocialStore((s) => s.friends);
  const acceptedFriends = friends.filter((f) => f.status === 'accepted');
  const openChatWithUser = useChatStore((s) => s.openChatWithUser);
  const { addByCode } = useSocialStore.getState();
  const [viewingProfile, setViewingProfile] = useState<Omit<social.Friend, 'status'> | null>(null);

  const [inputText, setInputText] = useState('');
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);

  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [isAddingMembers, setIsAddingMembers] = useState(false);
  const [addMemberIds, setAddMemberIds] = useState<string[]>([]);
  const [isViewingMembers, setIsViewingMembers] = useState(false);

  const [position, setPosition] = useState(() => {
    const size = loadJson('chat_size', { w: 600, h: 450 });
    return clampPos(loadJson('chat_position', { x: window.innerWidth - 650, y: window.innerHeight - 500 }), clampSize(size));
  });
  const [size, setSize] = useState(() => clampSize(loadJson('chat_size', { w: 600, h: 450 })));
  const sizeRef = useRef(size);
  sizeRef.current = size;

  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** Follow new messages only while the user is already near the bottom (or just sent one). */
  const stickToBottomRef = useRef(true);
  /** Set right before a `loadOlder` prepend so the scroll position can be restored afterwards. */
  const prevScrollHeightRef = useRef<number | null>(null);

  const activeSession = sessions.find((s) => s.id === activeChatId);
  const activeMessages = activeSession?.messages;

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        const newPos = clampPos({ x: e.clientX - dragOffset.x, y: e.clientY - dragOffset.y }, sizeRef.current);
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

  // A monitor change (or window shrink) must never strand the widget off-screen.
  useEffect(() => {
    const onResize = () => {
      setSize((s) => {
        const c = clampSize(s);
        return c.w !== s.w || c.h !== s.h ? c : s;
      });
      setPosition((p) => {
        const c = clampPos(p, sizeRef.current);
        return c.x !== p.x || c.y !== p.y ? c : p;
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Surface store errors (failed send/edit/upload acks, socket errors) instead of dropping them.
  useEffect(() => {
    if (!chatError) return;
    addToast({ type: 'system', title: 'Чат', content: chatError, icon: '⚠️' });
    clearError();
  }, [chatError, addToast, clearError]);

  // Esc: cancel edit → cancel reply → close profile → close the widget (in that order).
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (editing) setEditing(null);
      else if (replyTo) setReplyTo(null);
      else if (viewingProfile) setViewingProfile(null);
      else toggleChat();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, editing, replyTo, viewingProfile, toggleChat]);

  // Opening/switching a conversation: jump to the newest message, focus the input, drop stale
  // compose state from the previous conversation.
  useEffect(() => {
    setReplyTo(null);
    setEditing(null);
    stickToBottomRef.current = true;
    prevScrollHeightRef.current = null;
    const el = listRef.current;
    if (el) requestAnimationFrame(() => el.scrollTo({ top: el.scrollHeight }));
    inputRef.current?.focus();
  }, [activeChatId, isOpen]);

  // New messages: restore position after a history prepend; otherwise follow the bottom while the
  // user is already there.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (prevScrollHeightRef.current !== null) {
      el.scrollTop = el.scrollHeight - prevScrollHeightRef.current + el.scrollTop;
      prevScrollHeightRef.current = null;
      return;
    }
    if (stickToBottomRef.current) el.scrollTo({ top: el.scrollHeight });
  }, [activeMessages]);

  if (!isOpen) {
    const totalUnread = sessions.reduce((n, s) => n + (s.unreadCount ?? 0), 0);
    return (
      <button
        onClick={toggleChat}
        aria-label={totalUnread > 0 ? `Открыть мессенджер, непрочитанных: ${totalUnread}` : 'Открыть мессенджер'}
        style={{
          position: 'fixed',
          bottom: 0,
          right: window.innerWidth < 768 ? 16 : 360,
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

  const callForThisChat = activeSession && activeCall?.conversationId === activeSession.id ? activeCall : null;

  const handleSend = () => {
    if (!activeChatId) return;
    const text = inputText.trim();
    if (editing) {
      if (!text) return;
      if (text !== editing.text) editMessage(activeChatId, editing.id, text);
      setEditing(null);
      setInputText('');
      return;
    }
    if (!text) return;
    sendMessage(activeChatId, text, replyTo ? { replyToId: replyTo.id } : undefined);
    setReplyTo(null);
    setInputText('');
    stickToBottomRef.current = true;
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputText(e.target.value);
    if (activeChatId && !editing) sendTyping(activeChatId);
  };

  /** Start dragging the window from a header bar — but not when the press lands on a button/input
   *  inside that bar (so the call/close/action controls stay clickable). */
  const startDrag = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, input, a')) return;
    setIsDragging(true);
    setDragOffset({ x: e.clientX - position.x, y: e.clientY - position.y });
  };

  /** Upload one image and send it as a structured attachment (the server rejects non-images and
   *  oversize files — surface those as toasts instead of a silent console error). The size guard
   *  mirrors the server default (CHAT_UPLOAD_MAX_BYTES) so we don't stream a doomed 50 MB+ body. */
  const uploadFile = async (file: File) => {
    if (!activeSession) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      addToast({
        type: 'system',
        title: 'Файл слишком большой',
        content: `Максимум ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} МБ`,
        icon: '⚠️',
      });
      return;
    }
    try {
      const token = await freshAccessToken();
      if (!token) throw new Error('сессия истекла — войдите заново');
      const res = await fetch(
        `${config.chatUrl}/chat/upload?conversationId=${encodeURIComponent(activeSession.id)}`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': file.type || 'application/octet-stream',
            'x-file-name': encodeURIComponent(file.name),
          },
          body: file,
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? `ошибка ${res.status}`);
      }
      const data = (await res.json()) as { id: string; url: string; type: string };
      sendMessage(activeSession.id, inputText.trim(), {
        attachments: [{ id: data.id, url: data.url, type: data.type, name: file.name }],
        ...(replyTo ? { replyToId: replyTo.id } : {}),
      });
      setInputText('');
      setReplyTo(null);
      stickToBottomRef.current = true;
    } catch (err) {
      addToast({
        type: 'system',
        title: 'Файл не отправлен',
        content: err instanceof Error ? err.message : String(err),
        icon: '⚠️',
      });
    }
  };

  const scrollToMessage = (id: string) => {
    const el = listRef.current?.querySelector(`[data-msg-id="${CSS.escape(id)}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const startReply = (m: ChatMessage) => {
    setEditing(null);
    setReplyTo(m);
    inputRef.current?.focus();
  };

  const startEdit = (m: ChatMessage) => {
    setReplyTo(null);
    setEditing(m);
    setInputText(m.text);
    inputRef.current?.focus();
  };

  const toggleMember = (id: string) =>
    setSelectedMemberIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  /** Name is optional — default to the members' names (server derives the same fallback if we send
   *  an empty name, but filling it here makes the suggestion visible/editable). */
  const suggestedGroupName = (): string => {
    const names = selectedMemberIds
      .map((id) => acceptedFriends.find((f) => f.accountId === id)?.displayName)
      .filter(Boolean) as string[];
    if (me?.displayName) names.unshift(me.displayName);
    return names.slice(0, 3).join(', ') + (names.length > 3 ? ` и ещё ${names.length - 3}` : '');
  };

  const submitGroup = () => {
    if (selectedMemberIds.length === 0) return;
    createGroup(groupName.trim() || suggestedGroupName(), selectedMemberIds);
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

  const canModerate =
    !!activeSession &&
    activeSession.type === 'group' &&
    !!me &&
    (activeSession.ownerId === me.accountId || (activeSession.admins?.includes(me.accountId) ?? false));

  const dmPeer =
    activeSession?.type === 'dm'
      ? friends.find((f) => activeSession.participants.some((p) => p.accountId === f.accountId && p.accountId !== me?.accountId))
      : undefined;

  return (
    <div
      className="civa-fade-in"
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        width: size.w,
        height: size.h,
        minWidth: MIN_W,
        minHeight: MIN_H,
        maxWidth: '100vw',
        maxHeight: '100vh',
        background: '#1b2838',
        border: '1px solid #3d4450',
        borderRadius: 8,
        boxShadow: '0 8px 32px rgba(0,0,0,0.8)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        zIndex: 1000,
        resize: 'both',
        pointerEvents: 'auto',
      }}
      onMouseUp={(e) => {
        // Handle resize by storing size on mouseup when not dragging
        if (!isDragging && e.currentTarget) {
          const newSize = clampSize({ w: e.currentTarget.offsetWidth, h: e.currentTarget.offsetHeight });
          if (newSize.w !== size.w || newSize.h !== size.h) {
            setSize(newSize);
            localStorage.setItem('chat_size', JSON.stringify(newSize));
          }
        }
      }}
    >
      {connStatus !== 'connected' && (
        <div style={{ flexShrink: 0, background: connStatus === 'error' ? '#6e2b2b' : '#3d4450', color: '#fff', fontSize: 12, textAlign: 'center', padding: '4px 8px' }}>
          {connStatus === 'error' ? 'Нет соединения с чатом' : 'Переподключение…'}
        </div>
      )}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
      <div style={{ width: 220, flexShrink: 0, background: '#171a21', borderRight: '1px solid #3d4450', display: 'flex', flexDirection: 'column' }}>
        <div
          onMouseDown={startDrag}
          title="Перетащите за эту полосу, чтобы переместить окно"
          style={{ padding: '10px 10px 10px 12px', borderBottom: '1px solid #3d4450', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'grab', background: '#23262e', userSelect: 'none' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span aria-hidden style={{ color: '#5a6673', fontSize: 15, lineHeight: 1 }}>⠿</span>
            <span style={{ fontWeight: 700, fontSize: '14px', color: '#fff' }}>Мессенджер</span>
          </div>
          <button
            onClick={toggleChat}
            title="Свернуть"
            aria-label="Свернуть мессенджер"
            style={headerIconBtn}
          >
            ✕
          </button>
        </div>
        <button
          onClick={() => setIsCreatingGroup(true)}
          title="Создать групповой чат"
          style={{
            margin: '8px',
            padding: '8px 12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            background: 'rgba(42,171,238,0.12)',
            color: '#2AABEE',
            border: '1px solid rgba(42,171,238,0.35)',
            borderRadius: 6,
            cursor: 'pointer',
            fontWeight: 600,
            fontSize: 13,
          }}
        >
          <span aria-hidden style={{ fontSize: 15 }}>👥</span> Новая группа
        </button>
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

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: '#1b2838' }}>
        {isCreatingGroup ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 16, gap: 12, overflowY: 'auto' }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#fff' }}>Новая группа</div>
            <input
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder={selectedMemberIds.length ? `${suggestedGroupName()} (необязательно)` : 'Название группы (необязательно)'}
              style={{ background: '#23262e', border: '1px solid #3d4450', borderRadius: 4, padding: '8px 12px', color: '#fff', fontSize: 13, outline: 'none' }}
            />
            <div style={{ fontSize: 12, color: '#8f98a0' }}>Участники ({acceptedFriends.length ? selectedMemberIds.length : 0}):</div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, overflowY: 'auto' }}>
              {acceptedFriends.length === 0 && (
                <div style={{ color: '#8f98a0', fontSize: 12 }}>Нет друзей, кого можно добавить.</div>
              )}
              {acceptedFriends.map((f) => {
                const isOnline = f.presence === 'online';
                const isInGame = isOnline && !!f.activity;
                return (
                  <label key={f.accountId} className="cw-hover-row" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 8px', cursor: 'pointer', color: '#dcdedf', fontSize: 13, borderRadius: 4 }}>
                    <input type="checkbox" checked={selectedMemberIds.includes(f.accountId)} onChange={() => toggleMember(f.accountId)} />
                    <div style={{ padding: 2, borderRadius: 4, flexShrink: 0, background: isInGame ? '#5c7e10' : (isOnline ? '#54a5d4' : '#3d4450') }}>
                      <Avatar src={f.avatarIcon} name={f.displayName} size={28} shape="square" />
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
                disabled={selectedMemberIds.length === 0}
                style={{ flex: 1, background: '#1a9fff', color: '#fff', border: 'none', padding: '8px', borderRadius: 4, cursor: 'pointer', fontWeight: 600, opacity: selectedMemberIds.length === 0 ? 0.5 : 1 }}
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
                    <div style={{ color: '#8f98a0', fontSize: 12 }}>Все друзья уже в группе.</div>
                  )}
                  {addable.map((f) => {
                    const isOnline = f.presence === 'online';
                    const isInGame = isOnline && !!f.activity;
                    return (
                      <label key={f.accountId} className="cw-hover-row" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 8px', cursor: 'pointer', color: '#dcdedf', fontSize: 13, borderRadius: 4 }}>
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
                const isMe = p.accountId === me?.accountId;
                const iAmOwner = me?.accountId === activeSession.ownerId;
                const isAdmin = activeSession.admins?.includes(p.accountId) ?? false;
                const f = friends.find(fr => fr.accountId === p.accountId);

                // Right-click OR the ⋯ button opens the same menu (right-click alone isn't discoverable).
                const openPersonMenu = (x: number, y: number) => {
                  const items: { label?: string; action: () => void; separator?: boolean; danger?: boolean }[] = [];
                  if (!isMe) items.push({ label: '💬 Написать в ЛС', action: () => openChatWithUser(p.accountId, p.displayName) });
                  items.push({
                    label: '👤 Профиль',
                    action: () =>
                      setViewingProfile(
                        f ?? { accountId: p.accountId, displayName: p.displayName, avatarIcon: null, titleAchievement: null, presence: 'offline', activity: null },
                      ),
                  });
                  if (iAmOwner && !isMe && !isOwner) {
                    items.push({ separator: true, action: () => {} });
                    items.push(
                      isAdmin
                        ? { label: '⬇️ Снять администратора', action: () => setGroupRole(activeSession.id, p.accountId, 'member') }
                        : { label: '⭐ Сделать администратором', action: () => setGroupRole(activeSession.id, p.accountId, 'admin') },
                    );
                    items.push({ label: '🚪 Исключить из группы', action: () => removeMember(activeSession.id, p.accountId), danger: true });
                  }
                  if (!isMe && !f) items.push({ label: '➕ Добавить в друзья', action: () => addByCode(p.accountId) });
                  openMenu(x, y, items);
                };

                return (
                  <div
                    key={p.accountId}
                    className="cw-hover-row"
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', color: '#dcdedf', fontSize: 13, borderRadius: 4, cursor: 'pointer' }}
                    onContextMenu={(e) => { e.preventDefault(); openPersonMenu(e.clientX, e.clientY); }}
                  >
                    <Avatar src={f?.avatarIcon} name={p.displayName} size={28} />
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.displayName}
                      {isOwner && <span style={{ color: '#8f98a0', fontSize: 11 }}> (владелец)</span>}
                      {!isOwner && isAdmin && <span style={{ color: '#8f98a0', fontSize: 11 }}> (админ)</span>}
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); openPersonMenu(e.clientX, e.clientY); }}
                      title="Действия"
                      aria-label={`Действия с ${p.displayName}`}
                      style={{ background: 'none', border: 'none', color: '#8f98a0', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '0 4px', flexShrink: 0 }}
                    >
                      ⋯
                    </button>
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
            <div
              onMouseDown={startDrag}
              title="Перетащите шапку, чтобы переместить окно"
              style={{ height: 60, flexShrink: 0, padding: '0 16px', borderBottom: '1px solid #3d4450', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#23262e', cursor: 'grab', userSelect: 'none' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                {activeSession.type === 'group' ? (
                  <Avatar src={activeSession.avatar} name={activeSession.name} size={32} shape="square" />
                ) : (
                  <Avatar src={dmPeer?.avatarIcon} name={activeSession.name} size={32} />
                )}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: '14px', color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeSession.name}</div>
                  <div style={{ fontSize: '12px', color: '#8f98a0' }}>
                    {activeSession.type === 'group' ? `${activeSession.participants.length} участников` : activityText(dmPeer)}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                {activeSession.type === 'group' && (
                  <>
                    <button
                      onClick={() => setIsViewingMembers(true)}
                      style={{ background: '#3d4450', border: 'none', width: 36, height: 36, borderRadius: '50%', color: '#fff', cursor: 'pointer' }}
                      title="Участники"
                      aria-label="Участники группы"
                    >
                      👥
                    </button>
                    <button
                      onClick={() => setIsAddingMembers(true)}
                      style={{ background: '#3d4450', border: 'none', width: 36, height: 36, borderRadius: '50%', color: '#fff', cursor: 'pointer' }}
                      title="Добавить участника"
                      aria-label="Добавить участника"
                    >
                      ➕
                    </button>
                    <button
                      onClick={() => leaveGroup(activeSession.id)}
                      style={{ background: '#3d4450', border: 'none', width: 36, height: 36, borderRadius: '50%', color: '#fff', cursor: 'pointer' }}
                      title="Покинуть группу"
                      aria-label="Покинуть группу"
                    >
                      🚪
                    </button>
                  </>
                )}
                <button
                  onClick={() => (callForThisChat ? hangup() : ring(activeSession.id, 'audio'))}
                  style={{ background: callForThisChat?.type === 'audio' ? '#5c7e10' : '#3d4450', border: 'none', width: 36, height: 36, borderRadius: '50%', color: '#fff', cursor: 'pointer' }}
                  title={callForThisChat ? 'Завершить звонок' : 'Аудиозвонок'}
                  aria-label={callForThisChat ? 'Завершить звонок' : 'Аудиозвонок'}
                >
                  📞
                </button>
                <button
                  onClick={() => (callForThisChat ? hangup() : ring(activeSession.id, 'video'))}
                  style={{ background: callForThisChat?.type === 'video' ? '#5c7e10' : '#3d4450', border: 'none', width: 36, height: 36, borderRadius: '50%', color: '#fff', cursor: 'pointer' }}
                  title={callForThisChat ? 'Завершить звонок' : 'Видеозвонок'}
                  aria-label={callForThisChat ? 'Завершить звонок' : 'Видеозвонок'}
                >
                  📹
                </button>
              </div>
            </div>

            <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                  <div
                    ref={listRef}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const file = e.dataTransfer.files?.[0];
                      if (file) void uploadFile(file);
                    }}
                    onScroll={(e) => {
                      const el = e.currentTarget;
                      stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
                      if (el.scrollTop < 40 && activeSession.hasMore && !activeSession.loadingOlder) {
                        prevScrollHeightRef.current = el.scrollHeight;
                        loadOlder(activeSession.id);
                      }
                    }}
                    style={{ flex: 1, padding: '16px 16px 32px 16px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}
                  >
                    {activeSession.loadingOlder && (
                      <div style={{ textAlign: 'center', color: '#8f98a0', fontSize: 12 }}>Загрузка истории…</div>
                    )}
                    {activeSession.messages.map(m => {
                      const isMe = m.senderId === me?.accountId;
                      const isSys = m.senderId === 'system';
                      if (isSys) {
                        return <div key={m.id} style={{ textAlign: 'center', color: '#8f98a0', fontSize: '12px', margin: '8px 0' }}>{m.text}</div>;
                      }

                      const isDeleted = !!m.deletedAt;
                      const replySource = m.replyToId ? activeSession.messages.find((x) => x.id === m.replyToId) : undefined;

                      return (
                        <div
                          key={m.id}
                          data-msg-id={m.id}
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
                            if (isDeleted) return;
                            const canDeleteThis = isMe || canModerate;
                            openMenu(e.clientX, e.clientY, [
                              { label: '↩️ Ответить', action: () => startReply(m) },
                              { label: '📋 Копировать', action: () => void navigator.clipboard?.writeText(m.text) },
                              ...(isMe ? [{ label: '✏️ Редактировать', action: () => startEdit(m) }] : []),
                              ...(canDeleteThis
                                ? [
                                    { separator: true, action: () => {} },
                                    { label: '🗑️ Удалить', action: () => deleteMessage(activeSession.id, m.id), danger: true },
                                  ]
                                : []),
                            ]);
                          }}
                        >
                          {!isMe && activeSession.type === 'group' && <div style={{ fontSize: '11px', color: '#8f98a0', marginBottom: 2 }}>{m.senderName}</div>}

                          <div style={{ background: isMe ? '#2AABEE' : '#3d4450', padding: '8px 12px', borderRadius: 8, color: '#fff', maxWidth: '85%', wordBreak: 'break-word' }}>
                            {replySource && !isDeleted && (
                              <div
                                onClick={() => scrollToMessage(replySource.id)}
                                style={{
                                  borderLeft: '3px solid rgba(255,255,255,0.5)',
                                  padding: '2px 8px',
                                  marginBottom: 6,
                                  cursor: 'pointer',
                                  opacity: 0.85,
                                }}
                              >
                                <div style={{ fontSize: 11, fontWeight: 700 }}>{replySource.senderName}</div>
                                <div style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260 }}>
                                  {replySource.deletedAt ? 'Сообщение удалено' : replySource.text || '📎 Вложение'}
                                </div>
                              </div>
                            )}
                            {m.replyToId && !replySource && !isDeleted && (
                              <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 6 }}>↩️ Ответ на сообщение</div>
                            )}
                            {isDeleted ? (
                              <div style={{ fontStyle: 'italic', color: 'rgba(255,255,255,0.6)', fontSize: 13 }}>Сообщение удалено</div>
                            ) : (
                              <>
                                {m.attachments?.map((a) =>
                                  a.type.startsWith('image/') ? (
                                    <a key={a.id} href={`${config.chatUrl}${a.url}`} target="_blank" rel="noreferrer">
                                      <img
                                        src={`${config.chatUrl}${a.url}`}
                                        alt={a.name}
                                        style={{ maxWidth: '100%', maxHeight: 240, borderRadius: 6, display: 'block', marginBottom: m.text ? 6 : 0 }}
                                      />
                                    </a>
                                  ) : (
                                    <a key={a.id} href={`${config.chatUrl}${a.url}`} target="_blank" rel="noreferrer" style={{ color: '#cfe8ff', fontSize: 13, display: 'block', marginBottom: m.text ? 6 : 0 }}>
                                      📎 {a.name}
                                    </a>
                                  ),
                                )}
                                {m.text && (
                                  <div className="chat-markdown" style={{ lineHeight: 1.4, margin: 0 }}>
                                    <ReactMarkdown>{m.text}</ReactMarkdown>
                                  </div>
                                )}
                              </>
                            )}
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: isMe ? 'flex-end' : 'flex-start', marginTop: 4, gap: 8 }}>
                            <div style={{ fontSize: '11px', color: '#8f98a0' }}>
                              {m.timestamp}
                              {m.editedAt && !isDeleted ? ' (изменено)' : ''}
                              {isMe && !isDeleted ? (m.status === 'read' ? ' ✓✓' : ' ✓') : ''}
                            </div>
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
                        .filter(([userId, ts]) => userId !== me?.accountId && (now - ts < 4000))
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

                  {(replyTo || editing) && (
                    <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', background: '#20242c', borderTop: '1px solid #3d4450' }}>
                      <div style={{ flex: 1, minWidth: 0, borderLeft: '3px solid #2AABEE', paddingLeft: 8 }}>
                        <div style={{ fontSize: 11, color: '#2AABEE', fontWeight: 700 }}>
                          {editing ? 'Редактирование' : `Ответ: ${replyTo!.senderName}`}
                        </div>
                        <div style={{ fontSize: 12, color: '#b8c2cc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {(editing ?? replyTo)!.text || '📎 Вложение'}
                        </div>
                      </div>
                      <button
                        onClick={() => { setEditing(null); setReplyTo(null); if (editing) setInputText(''); }}
                        title="Отмена (Esc)"
                        aria-label="Отменить"
                        style={{ background: 'none', border: 'none', color: '#8f98a0', cursor: 'pointer', fontSize: 16, flexShrink: 0 }}
                      >
                        ×
                      </button>
                    </div>
                  )}

                  <div style={{ flexShrink: 0, padding: '12px 16px', background: '#171a21', borderTop: replyTo || editing ? 'none' : '1px solid #3d4450', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void uploadFile(file);
                        e.target.value = '';
                      }}
                    />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      title="Прикрепить изображение"
                      aria-label="Прикрепить изображение"
                      style={{ background: 'none', border: 'none', color: '#8f98a0', cursor: 'pointer', fontSize: 18, flexShrink: 0 }}
                    >
                      📎
                    </button>
                    <input
                      ref={inputRef}
                      type="text"
                      placeholder={editing ? 'Новый текст сообщения…' : 'Написать сообщение...'}
                      value={inputText}
                      onChange={handleInputChange}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.nativeEvent.isComposing) handleSend();
                      }}
                      style={{ flex: 1, minWidth: 0, background: '#23262e', border: '1px solid #3d4450', borderRadius: 20, padding: '10px 16px', color: '#fff', outline: 'none', fontSize: '13px' }}
                    />
                    <button
                      onClick={handleSend}
                      title={editing ? 'Сохранить' : 'Отправить'}
                      aria-label={editing ? 'Сохранить изменения' : 'Отправить сообщение'}
                      style={{ background: '#2AABEE', color: '#fff', border: 'none', width: 40, height: 40, borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                    >
                      {editing ? '✓' : '➤'}
                    </button>
                  </div>
            </div>
          </>
        ) : (
          <DroppableNewChatArea />
        )}
      </div>
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
