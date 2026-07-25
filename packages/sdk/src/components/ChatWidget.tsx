import { useEffect, useRef, useState } from 'react';
import { useChatStore, type ChatMessage, type ChatSession } from '../state/chatStore.js';
import { useSocialStore } from '../state/socialStore.js';
import { useMenuStore } from '../state/menuStore.js';
import { useToastStore } from '../state/toastStore.js';
import { useMissedCallsStore, type MissedCall } from '../state/missedCallsStore.js';
import { UserProfileModal } from './UserProfileModal.js';
import { useDroppable } from '@dnd-kit/core';
import ReactMarkdown from 'react-markdown';
import { config } from '../config.js';
import { freshAccessToken } from '../authClient.js';
import type { social } from '@mygame/protocol';
import { mg, mgZ } from '../theme/tokens.js';
import { btn, iconBtn, input as inputStyle, countBadge } from '../theme/primitives.js';
import { useFloatingWindow, useResizeHandle, loadStoredSize, clampSizeTo } from '../hooks/useFloatingWindow.js';
import { getViewport, useViewport } from '../hooks/useViewport.js';
import { useIsMobile } from '../hooks/useIsMobile.js';

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
        background: src ? mg.surfaceRaised : avatarBg(name),
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
  ...iconBtn(26),
  background: mg.surfaceRaised,
  color: mg.text,
  fontSize: 14,
  lineHeight: 1,
};

const MIN_SIZE = { w: MIN_W, h: MIN_H };

/** A session-list row that's also a drop target for `SocialDndProvider` — dragging a friend here
 *  (id `friend:<accountId>`) adds them to this conversation. Id convention: `chat:<sessionId>`. */
const DroppableChatSession = ({
  s,
  activeChatId,
  callCount,
  hasMissed,
  onClick,
}: {
  s: ChatSession;
  activeChatId: string | null;
  /** How many people are currently in this conversation's call (0 = none). */
  callCount: number;
  /** Unseen missed call in this conversation — renders a danger phone marker. */
  hasMissed: boolean;
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
        ...(isOver ? { background: mg.accentSoft } : active ? { background: mg.surfaceRaised } : {}),
        borderBottom: '1px solid rgba(255,255,255,0.05)',
      }}
    >
      <Avatar src={s.avatar} name={s.name} size={32} shape={s.type === 'group' ? 'square' : 'circle'} />

      <div style={{ fontSize: '13px', color: mg.text, fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {s.name}
      </div>
      {hasMissed && !active && (
        <span title="Пропущенный звонок" style={{ color: mg.danger, fontSize: 13, lineHeight: 1 }} aria-label="Пропущенный звонок">
          📵
        </span>
      )}
      {callCount > 0 && (
        <div title={`В звонке: ${callCount}`} style={{ display: 'flex', alignItems: 'center', gap: 3, color: mg.positive, fontSize: 11, fontWeight: 700 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: mg.positive, display: 'inline-block' }} />
          {callCount}
        </div>
      )}
      {!!s.unreadCount && !active && (
        <div style={countBadge('accent')}>
          {s.unreadCount}
        </div>
      )}
    </div>
  );
};

/** The "no conversation open" placeholder — also a drop target (id `chat:new`) for starting a new
 *  DM by dragging a friend here; `SocialDndProvider` special-cases this id to open-or-create a DM.
 *  The whole empty pane doubles as a window drag surface (`dragProps` from useFloatingWindow). */
const DroppableNewChatArea = ({
  dragProps,
}: {
  dragProps?: { onPointerDown: (e: React.PointerEvent<HTMLElement>) => void; style: React.CSSProperties } | undefined;
}): JSX.Element => {
  const { isOver, setNodeRef } = useDroppable({ id: 'chat:new' });
  return (
    <div
      ref={setNodeRef}
      onPointerDown={dragProps?.onPointerDown}
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: isOver ? mg.accent : mg.textMuted,
        background: isOver ? mg.accentSoft : 'transparent',
        ...(dragProps?.style ?? {}),
      }}
    >
      Выберите диалог из списка
    </div>
  );
};

export const ChatWidget = ({ hideLauncher = false }: { hideLauncher?: boolean } = {}): JSX.Element => {
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
  const callStates = useChatStore((s) => s.callStates);
  const acceptCall = useChatStore((s) => s.acceptCall);
  const openMenu = useMenuStore((s) => s.openMenu);
  const addToast = useToastStore((s) => s.addToast);

  // Call *starting* lives here (the header buttons); the call surface itself is rendered globally by
  // <CallView />, independent of which chat is open.
  const activeCall = useChatStore((s) => s.activeCall);
  const ring = useChatStore((s) => s.ring);
  const hangup = useChatStore((s) => s.hangup);
  const allMissed = useMissedCallsStore((s) => s.missed);

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

  const [size, setSize] = useState(() => loadStoredSize('chat', 'chat_size', { w: 600, h: 450 }, MIN_SIZE));
  const sizeRef = useRef(size);
  sizeRef.current = size;

  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** Follow new messages only while the user is already near the bottom (or just sent one). */
  const stickToBottomRef = useRef(true);
  /** Set right before a `loadOlder` prepend so the scroll position can be restored afterwards. */
  const prevScrollHeightRef = useRef<number | null>(null);

  const activeSession = sessions.find((s) => s.id === activeChatId);
  const activeMessages = activeSession?.messages;

  // Below the shared breakpoint the widget goes full-screen and stacks list↔chat; the viewport hook
  // (visualViewport-aware) drives the mobile height so the composer stays above the on-screen
  // keyboard. Size clamping on monitor changes keeps the desktop window inside the screen.
  const isMobile = useIsMobile();
  const vp = useViewport();
  useEffect(() => {
    setSize((s) => {
      const c = clampSizeTo(s, MIN_SIZE, getViewport());
      return c.w !== s.w || c.h !== s.h ? c : s;
    });
  }, [vp.w, vp.h]);

  // The floating-window engine: pointer drag (mouse+touch), viewport clamping, persisted position
  // (migrates the legacy 'chat_position' key on first load).
  const { pos: position, handleProps: dragHandle } = useFloatingWindow({
    key: 'chat',
    anchor: 'top-left',
    legacyKey: 'chat_position',
    defaultPos: (v, s) => ({ x: Math.max(8, v.w - s.w - 50), y: Math.max(8, v.h - s.h - 50) }),
    size: () => sizeRef.current,
    disabled: isMobile,
  });
  const { handleProps: resizeHandle, resizing } = useResizeHandle({
    key: 'chat',
    min: MIN_SIZE,
    size,
    onChange: setSize,
    disabled: isMobile,
  });

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

  // Mobile keyboard: the visual viewport shrinking (keyboard opening) must not scroll the newest
  // messages out from under the composer — re-stick to the bottom if we were there.
  useEffect(() => {
    if (!isMobile) return;
    const el = listRef.current;
    if (el && stickToBottomRef.current) el.scrollTo({ top: el.scrollHeight });
  }, [vp.h, isMobile]);

  if (!isOpen) {
    // When an external launcher owns the entry point (the unified "Друзья и чат" button / the mobile
    // app-bar chat icon), render nothing while collapsed instead of a second bottom button.
    if (hideLauncher) return <></>;
    const totalUnread = sessions.reduce((n, s) => n + (s.unreadCount ?? 0), 0);
    return (
      <button
        onClick={toggleChat}
        aria-label={totalUnread > 0 ? `Открыть мессенджер, непрочитанных: ${totalUnread}` : 'Открыть мессенджер'}
        style={{
          position: 'fixed',
          bottom: 0,
          right: window.innerWidth < 768 ? 16 : 360,
          zIndex: mgZ.launcher,
          background: mg.surfaceDeep,
          color: mg.text,
          fontFamily: mg.font,
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
          <span style={countBadge('accent')}>
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
      className="mygame-fade-in"
      style={
        isMobile
          ? {
              // Phones: full-screen, no drag/resize — the floating window is unusable at 375px.
              // Height follows the *visual* viewport (shrinks for the keyboard/browser chrome) and
              // the safe-area insets keep the header/composer off the notch and home indicator.
              position: 'fixed',
              left: 0,
              top: 0,
              width: '100%',
              height: vp.h,
              paddingTop: 'env(safe-area-inset-top, 0px)',
              background: mg.surface,
              color: mg.text,
              fontFamily: mg.font,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              zIndex: mgZ.widget,
              pointerEvents: 'auto',
            }
          : {
              position: 'fixed',
              left: position.x,
              top: position.y,
              width: size.w,
              height: size.h,
              minWidth: MIN_W,
              minHeight: MIN_H,
              background: mg.surface,
              color: mg.text,
              fontFamily: mg.font,
              border: `1px solid ${mg.border}`,
              borderRadius: mg.rLg,
              boxShadow: mg.shadowWindow,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              zIndex: mgZ.widget,
              pointerEvents: 'auto',
            }
      }
    >
      {connStatus !== 'connected' && (
        <div
          onPointerDown={dragHandle.onPointerDown}
          style={{ flexShrink: 0, background: connStatus === 'error' ? mg.dangerSoft : mg.surfaceRaised, color: mg.text, fontSize: 12, textAlign: 'center', padding: '4px 8px', ...dragHandle.style }}
        >
          {connStatus === 'error' ? 'Нет соединения с чатом' : 'Переподключение…'}
        </div>
      )}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
      {/* Mobile stacks list↔chat: the sidebar is full-width when no chat is open and hidden once one is. */}
      <div style={{ width: isMobile ? '100%' : 220, flexShrink: 0, background: mg.surfaceDeep, borderRight: isMobile ? 'none' : `1px solid ${mg.border}`, display: isMobile && activeChatId ? 'none' : 'flex', flexDirection: 'column' }}>
        <div
          onPointerDown={dragHandle.onPointerDown}
          title="Перетащите за эту полосу, чтобы переместить окно"
          style={{ padding: '10px 10px 10px 12px', borderBottom: `1px solid ${mg.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: mg.surfaceRaised, ...dragHandle.style }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span aria-hidden style={{ color: mg.textMuted, fontSize: 15, lineHeight: 1 }}>⠿</span>
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
            background: mg.accentSoft,
            color: mg.accent,
            border: `1px solid ${mg.accentSoft}`,
            borderRadius: mg.rMd,
            cursor: 'pointer',
            fontWeight: 600,
            fontSize: 13,
            transition: `background ${mg.motionFast}`,
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
              callCount={callStates[s.id]?.participantIds.length ?? 0}
              hasMissed={allMissed.some((mc) => mc.conversationId === s.id && !mc.seen)}
              onClick={() => { openChat(s.id); setIsAddingMembers(false); setIsViewingMembers(false); }}
            />
          ))}
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 0, display: isMobile && !activeChatId && !isCreatingGroup ? 'none' : 'flex', flexDirection: 'column', background: mg.surface }}>
        {isCreatingGroup ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 16, gap: 12, overflowY: 'auto' }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#fff' }}>Новая группа</div>
            <input
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder={selectedMemberIds.length ? `${suggestedGroupName()} (необязательно)` : 'Название группы (необязательно)'}
              style={inputStyle}
            />
            <div style={{ fontSize: 12, color: mg.textMuted }}>Участники ({acceptedFriends.length ? selectedMemberIds.length : 0}):</div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, overflowY: 'auto' }}>
              {acceptedFriends.length === 0 && (
                <div style={{ color: mg.textMuted, fontSize: 12 }}>Нет друзей, кого можно добавить.</div>
              )}
              {acceptedFriends.map((f) => {
                const isOnline = f.presence === 'online';
                const isInGame = isOnline && !!f.activity;
                return (
                  <label key={f.accountId} className="cw-hover-row" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 8px', cursor: 'pointer', color: mg.text, fontSize: 13, borderRadius: 4 }}>
                    <input type="checkbox" checked={selectedMemberIds.includes(f.accountId)} onChange={() => toggleMember(f.accountId)} />
                    <div style={{ padding: 2, borderRadius: 4, flexShrink: 0, background: isInGame ? mg.positive : (isOnline ? mg.accent : mg.surfaceRaised) }}>
                      <Avatar src={f.avatarIcon} name={f.displayName} size={28} shape="square" />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontWeight: 600, color: isInGame ? mg.positive : (isOnline ? mg.accent : mg.textMuted) }}>{f.displayName}</span>
                      <span style={{ fontSize: 11, color: isInGame ? mg.positive : mg.textMuted }}>{activityText(f)}</span>
                    </div>
                  </label>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setIsCreatingGroup(false)} style={{ ...btn('neutral'), flex: 1, padding: '8px' }}>
                Отмена
              </button>
              <button
                onClick={submitGroup}
                disabled={selectedMemberIds.length === 0}
                style={{ ...btn('primary'), flex: 1, padding: '8px', opacity: selectedMemberIds.length === 0 ? 0.5 : 1 }}
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
                    <div style={{ color: mg.textMuted, fontSize: 12 }}>Все друзья уже в группе.</div>
                  )}
                  {addable.map((f) => {
                    const isOnline = f.presence === 'online';
                    const isInGame = isOnline && !!f.activity;
                    return (
                      <label key={f.accountId} className="cw-hover-row" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 8px', cursor: 'pointer', color: mg.text, fontSize: 13, borderRadius: 4 }}>
                        <input type="checkbox" checked={addMemberIds.includes(f.accountId)} onChange={() => toggleAddMember(f.accountId)} />
                        <div style={{ width: 32, height: 32, background: isInGame ? mg.positive : (isOnline ? mg.accent : mg.surfaceRaised), borderRadius: 2, padding: 2, overflow: 'hidden' }}>
                          {f.avatarIcon ? (
                            <img src={f.avatarIcon} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          ) : (
                            <div style={{ width: '100%', height: '100%', background: mg.tileAlt }} />
                          )}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <span style={{ fontWeight: 600, color: isInGame ? mg.positive : (isOnline ? mg.accent : mg.textMuted) }}>{f.displayName}</span>
                          <span style={{ fontSize: 11, color: isInGame ? mg.positive : mg.textMuted }}>{activityText(f)}</span>
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
                style={{ ...btn('neutral'), flex: 1, padding: '8px' }}
              >
                Отмена
              </button>
              <button
                onClick={submitAddMembers}
                disabled={addMemberIds.length === 0}
                style={{ ...btn('primary'), flex: 1, padding: '8px', opacity: addMemberIds.length === 0 ? 0.5 : 1 }}
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
                  if (!isMe && !f)
                    items.push({
                      label: '➕ Добавить в друзья',
                      action: () =>
                        void addByCode(p.accountId).then((ack) =>
                          addToast({
                            type: 'system',
                            title: 'Друзья',
                            content: ack.error ?? `Запрос отправлен: ${p.displayName}`,
                            icon: ack.error ? '⚠️' : '➕',
                          }),
                        ),
                    });
                  openMenu(x, y, items);
                };

                return (
                  <div
                    key={p.accountId}
                    className="cw-hover-row"
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', color: mg.text, fontSize: 13, borderRadius: 4, cursor: 'pointer' }}
                    onContextMenu={(e) => { e.preventDefault(); openPersonMenu(e.clientX, e.clientY); }}
                  >
                    <Avatar src={f?.avatarIcon} name={p.displayName} size={28} />
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.displayName}
                      {isOwner && <span style={{ color: mg.textMuted, fontSize: 11 }}> (владелец)</span>}
                      {!isOwner && isAdmin && <span style={{ color: mg.textMuted, fontSize: 11 }}> (админ)</span>}
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); openPersonMenu(e.clientX, e.clientY); }}
                      title="Действия"
                      aria-label={`Действия с ${p.displayName}`}
                      style={{ background: 'none', border: 'none', color: mg.textMuted, cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '0 4px', flexShrink: 0 }}
                    >
                      ⋯
                    </button>
                  </div>
                );
              })}
            </div>
            <button
              onClick={() => setIsViewingMembers(false)}
              style={{ ...btn('neutral'), padding: '8px' }}
            >
              Закрыть
            </button>
          </div>
        ) : activeSession ? (
          <>
            <div
              onPointerDown={dragHandle.onPointerDown}
              title="Перетащите шапку, чтобы переместить окно"
              style={{ height: 60, flexShrink: 0, padding: '0 16px', borderBottom: `1px solid ${mg.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: mg.surfaceRaised, ...dragHandle.style }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                {isMobile && (
                  <button
                    onClick={() => useChatStore.setState({ activeChatId: null })}
                    title="К списку чатов"
                    aria-label="Назад к списку чатов"
                    style={{ background: 'none', border: 'none', color: mg.text, cursor: 'pointer', fontSize: 24, lineHeight: 1, minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, margin: '0 -8px 0 -12px' }}
                  >
                    ‹
                  </button>
                )}
                {activeSession.type === 'group' ? (
                  <Avatar src={activeSession.avatar} name={activeSession.name} size={32} shape="square" />
                ) : (
                  <Avatar src={dmPeer?.avatarIcon} name={activeSession.name} size={32} />
                )}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: '14px', color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeSession.name}</div>
                  <div style={{ fontSize: '12px', color: mg.textMuted }}>
                    {activeSession.type === 'group' ? `${activeSession.participants.length} участников` : activityText(dmPeer)}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                {activeSession.type === 'group' && (
                  <>
                    <button
                      onClick={() => setIsViewingMembers(true)}
                      style={{ background: mg.surfaceRaised, border: 'none', width: 36, height: 36, borderRadius: '50%', color: '#fff', cursor: 'pointer' }}
                      title="Участники"
                      aria-label="Участники группы"
                    >
                      👥
                    </button>
                    <button
                      onClick={() => setIsAddingMembers(true)}
                      style={{ background: mg.surfaceRaised, border: 'none', width: 36, height: 36, borderRadius: '50%', color: '#fff', cursor: 'pointer' }}
                      title="Добавить участника"
                      aria-label="Добавить участника"
                    >
                      ➕
                    </button>
                    <button
                      onClick={() => leaveGroup(activeSession.id)}
                      style={{ background: mg.surfaceRaised, border: 'none', width: 36, height: 36, borderRadius: '50%', color: '#fff', cursor: 'pointer' }}
                      title="Покинуть группу"
                      aria-label="Покинуть группу"
                    >
                      🚪
                    </button>
                  </>
                )}
                <button
                  onClick={() => (callForThisChat ? hangup() : ring(activeSession.id, 'audio'))}
                  style={{ background: callForThisChat?.type === 'audio' ? mg.positive : mg.surfaceRaised, border: 'none', width: 36, height: 36, borderRadius: '50%', color: '#fff', cursor: 'pointer' }}
                  title={callForThisChat ? 'Завершить звонок' : 'Аудиозвонок'}
                  aria-label={callForThisChat ? 'Завершить звонок' : 'Аудиозвонок'}
                >
                  📞
                </button>
                <button
                  onClick={() => (callForThisChat ? hangup() : ring(activeSession.id, 'video'))}
                  style={{ background: callForThisChat?.type === 'video' ? mg.positive : mg.surfaceRaised, border: 'none', width: 36, height: 36, borderRadius: '50%', color: '#fff', cursor: 'pointer' }}
                  title={callForThisChat ? 'Завершить звонок' : 'Видеозвонок'}
                  aria-label={callForThisChat ? 'Завершить звонок' : 'Видеозвонок'}
                >
                  📹
                </button>
              </div>
            </div>

            {(() => {
              // Discord-style: an ongoing call I'm not in → a join bar naming who's already there.
              const cs = callStates[activeSession.id];
              const inCall = !!me && (cs?.participantIds.includes(me.accountId) ?? false);
              if (!cs || cs.participantIds.length === 0 || inCall) return null;
              const names = cs.participantIds
                .map((id) => activeSession.participants.find((p) => p.accountId === id)?.displayName ?? 'участник')
                .slice(0, 3)
                .join(', ');
              return (
                <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', background: mg.positiveSoft, borderBottom: `1px solid ${mg.border}` }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: mg.positive, flexShrink: 0 }} />
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: mg.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    Идёт звонок · {names}{cs.participantIds.length > 3 ? ` и ещё ${cs.participantIds.length - 3}` : ''}
                  </span>
                  <button
                    onClick={() => void acceptCall(activeSession.id)}
                    style={{ ...btn('primary'), background: mg.positive, padding: '5px 12px', flexShrink: 0 }}
                  >
                    Присоединиться
                  </button>
                </div>
              );
            })()}

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
                      <div style={{ textAlign: 'center', color: mg.textMuted, fontSize: 12 }}>Загрузка истории…</div>
                    )}
                    {/* Timeline = server messages + locally-witnessed missed calls (derived at render,
                        so history replaces can't wipe them), merged chronologically. The server also
                        writes a durable «📵 Пропущенный звонок…» system row for ordinary misses —
                        local records within ±2 min of one are skipped to avoid a double row (busy-line
                        misses have no server row and always render). */}
                    {[
                      ...activeSession.messages.map((m) => ({ at: m.createdAt ?? 0, msg: m as ChatMessage, missed: null as MissedCall | null })),
                      ...allMissed
                        .filter((mc) => mc.conversationId === activeSession.id)
                        .filter(
                          (mc) =>
                            mc.busy ||
                            !activeSession.messages.some(
                              (m) =>
                                m.senderId === 'system' &&
                                m.text.startsWith('📵 Пропущенный звонок') &&
                                Math.abs((m.createdAt ?? 0) - mc.at) < 120_000,
                            ),
                        )
                        .map((mc) => ({ at: mc.at, msg: null as ChatMessage | null, missed: mc })),
                    ]
                      .sort((a, b) => a.at - b.at)
                      .map((row) => {
                      if (row.missed) {
                        const mc = row.missed;
                        const when = new Date(mc.at).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
                        return (
                          <div
                            key={`missed-${mc.at}`}
                            style={{ alignSelf: 'center', display: 'flex', alignItems: 'center', gap: 6, color: mg.danger, fontSize: 12, margin: '4px 0' }}
                          >
                            <span aria-hidden>📵</span>
                            Пропущенный звонок ({mc.type === 'video' ? 'видео' : 'аудио'}) · {when}
                          </div>
                        );
                      }
                      const m = row.msg!;
                      const isMe = m.senderId === me?.accountId;
                      const isSys = m.senderId === 'system';
                      if (isSys) {
                        return <div key={m.id} style={{ textAlign: 'center', color: mg.textMuted, fontSize: '12px', margin: '8px 0' }}>{m.text}</div>;
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
                          {!isMe && activeSession.type === 'group' && <div style={{ fontSize: '11px', color: mg.textMuted, marginBottom: 2 }}>{m.senderName}</div>}

                          <div style={{ background: isMe ? mg.bubbleOut : mg.bubbleIn, padding: '8px 12px', borderRadius: mg.rMd, color: '#fff', maxWidth: '85%', wordBreak: 'break-word' }}>
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
                                    <a key={a.id} href={`${config.chatUrl}${a.url}`} target="_blank" rel="noreferrer" style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13, display: 'block', marginBottom: m.text ? 6 : 0 }}>
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
                            <div style={{ fontSize: '11px', color: mg.textMuted }}>
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
                        <div style={{ fontSize: '12px', color: mg.textMuted, fontStyle: 'italic', alignSelf: 'flex-start' }}>
                          {text}
                        </div>
                      );
                    })()}
                  </div>

                  {(replyTo || editing) && (
                    <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', background: mg.surfaceDeep, borderTop: `1px solid ${mg.border}` }}>
                      <div style={{ flex: 1, minWidth: 0, borderLeft: `3px solid ${mg.accent}`, paddingLeft: 8 }}>
                        <div style={{ fontSize: 11, color: mg.accent, fontWeight: 700 }}>
                          {editing ? 'Редактирование' : `Ответ: ${replyTo!.senderName}`}
                        </div>
                        <div style={{ fontSize: 12, color: mg.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {(editing ?? replyTo)!.text || '📎 Вложение'}
                        </div>
                      </div>
                      <button
                        onClick={() => { setEditing(null); setReplyTo(null); if (editing) setInputText(''); }}
                        title="Отмена (Esc)"
                        aria-label="Отменить"
                        style={{ background: 'none', border: 'none', color: mg.textMuted, cursor: 'pointer', fontSize: 16, flexShrink: 0 }}
                      >
                        ×
                      </button>
                    </div>
                  )}

                  <div style={{ flexShrink: 0, padding: isMobile ? '12px 16px calc(12px + env(safe-area-inset-bottom, 0px))' : '12px 16px', background: mg.surfaceDeep, borderTop: replyTo || editing ? 'none' : `1px solid ${mg.border}`, display: 'flex', alignItems: 'center', gap: 10 }}>
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
                      style={{ background: 'none', border: 'none', color: mg.textMuted, cursor: 'pointer', fontSize: 18, flexShrink: 0 }}
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
                      style={{ ...inputStyle, flex: 1, minWidth: 0, background: mg.surfaceRaised, borderRadius: mg.rPill, padding: '10px 16px' }}
                    />
                    <button
                      onClick={handleSend}
                      title={editing ? 'Сохранить' : 'Отправить'}
                      aria-label={editing ? 'Сохранить изменения' : 'Отправить сообщение'}
                      style={{ background: mg.accent, color: '#fff', border: 'none', width: 40, height: 40, borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: `background ${mg.motionFast}` }}
                    >
                      {editing ? '✓' : '➤'}
                    </button>
                  </div>
            </div>
          </>
        ) : (
          <DroppableNewChatArea dragProps={isMobile ? undefined : dragHandle} />
        )}
      </div>
      </div>

      {/* Visible, touch-capable resize grip (replaces the invisible native CSS resize corner). */}
      {!isMobile && (
        <div
          onPointerDown={resizeHandle.onPointerDown}
          title="Потяните, чтобы изменить размер"
          aria-hidden
          style={{
            position: 'absolute',
            right: 0,
            bottom: 0,
            width: 18,
            height: 18,
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'flex-end',
            padding: 3,
            color: resizing ? mg.accent : mg.textMuted,
            opacity: 0.9,
            zIndex: 2,
            ...resizeHandle.style,
          }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <path d="M9 1v8H1" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M9 5v4H5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
      )}

      {viewingProfile && <UserProfileModal target={viewingProfile} onClose={() => setViewingProfile(null)} />}
    </div>
  );
};
