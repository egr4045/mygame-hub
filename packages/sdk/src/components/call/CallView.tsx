import { useEffect, useRef, useState } from 'react';
import { RoomContext, RoomAudioRenderer } from '@livekit/components-react';
import { useChatStore } from '../../state/chatStore.js';
import { useCallStore, getCallRoom } from '../../state/callStore.js';
import { useSocialStore } from '../../state/socialStore.js';
import { getHandoff } from '../../authClient.js';
import { CallStage } from './CallStage.js';
import { ControlBar } from './ControlBar.js';
import { RingingView } from './RingingView.js';
import { ConnectionBanner } from './ConnectionBanner.js';
import { palette, chromeButton } from './callStyles.js';
import { mg, mgZ } from '../../theme/tokens.js';
import { useFloatingWindow } from '../../hooks/useFloatingWindow.js';
import { useViewport, getViewport } from '../../hooks/useViewport.js';
import { useIsMobile } from '../../hooks/useIsMobile.js';

const DOCK_W = 460;
const DOCK_H = 380;

/** Top-level call surface — mounted once, globally (a sibling of ChatWidget at the overlay and hub
 *  roots). The *connected* surface is driven by `callStore` (the portable media layer), so it also
 *  renders game-room calls and calls resumed after a navigation; the pre-connected ringing states
 *  come from `chatStore.activeCall` (conversation signaling). Renders nothing when idle.
 *
 *  Surface modes: `docked` (a floating, draggable PiP window) and `expanded` (full-viewport), plus
 *  true OS fullscreen via the Fullscreen API (falls back to `expanded` if the browser refuses).
 *  When the host game owns the video (`embedded`), no chrome is rendered at all — only the audio
 *  pipeline stays alive (the contract documented at the top of callStore.ts). */
export const CallView = (): JSX.Element | null => {
  const activeCall = useChatStore((s) => s.activeCall);
  const sessions = useChatStore((s) => s.sessions);
  const acceptCall = useChatStore((s) => s.acceptCall);
  const declineCall = useChatStore((s) => s.declineCall);
  const hangup = useChatStore((s) => s.hangup);
  const me = useSocialStore((s) => s.me);

  const mediaStatus = useCallStore((s) => s.status);
  const callKey = useCallStore((s) => s.callKey);
  const mediaKind = useCallStore((s) => s.kind);
  const mediaConversationId = useCallStore((s) => s.conversationId);
  const mediaLabel = useCallStore((s) => s.label);
  const mediaParticipants = useCallStore((s) => s.participants);
  const embedded = useCallStore((s) => s.embedded);
  const pendingInvite = useCallStore((s) => s.pendingInvite);
  const dismissInvite = useCallStore((s) => s.dismissInvite);

  const [surfaceMode, setSurfaceMode] = useState<'docked' | 'expanded'>('docked');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const isMobile = useIsMobile();
  const [pinnedKey, setPinnedKey] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Docked-window position: top-right by default (the chat widget owns the bottom-right corner).
  // Persisted across calls (useFloatingWindow, key 'callDock') — a window the user parked somewhere
  // stays there; only the surface mode resets per call.
  const vp = useViewport();
  const expandedSurface = isFullscreen || surfaceMode === 'expanded' || isMobile; // phones: always full-screen
  const { pos: dockPosition, handleProps: dockHandle } = useFloatingWindow({
    key: 'callDock',
    anchor: 'top-left',
    defaultPos: (v) => ({ x: Math.max(0, v.w - DOCK_W - 24), y: 80 }),
    size: () => ({ w: Math.min(DOCK_W, getViewport().w - 16), h: Math.min(DOCK_H, getViewport().h - 16) }),
    minVisible: 40,
    disabled: expandedSurface,
  });

  const currentKey = callKey ?? activeCall?.conversationId ?? null;
  useEffect(() => {
    setPinnedKey(null);
    setSurfaceMode('docked');
  }, [currentKey]);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const mediaLive = mediaStatus !== 'idle';
  if (!activeCall && !mediaLive) return null;

  const room = getCallRoom();
  const connected = mediaStatus === 'connected' && !!room;

  // The host game renders call video itself — keep only the audio pipeline (and its remote-volume
  // plumbing) mounted, zero chrome.
  if (embedded) {
    return connected ? (
      <RoomContext.Provider key={currentKey ?? 'embedded'} value={room}>
        <RoomAudioRenderer />
      </RoomContext.Provider>
    ) : null;
  }

  const conversationId = mediaConversationId ?? activeCall?.conversationId ?? null;
  const session = conversationId ? sessions.find((s) => s.id === conversationId) : undefined;
  const title = session?.name ?? mediaLabel ?? activeCall?.fromName ?? (mediaKind === 'game' ? 'Игровой звонок' : 'Звонок');
  // LiveKit identity is now per-device (`<accountId>#<device>`); the local tile is the exact local
  // identity, and names resolve on the base accountId (so a second device of mine still gets a name).
  const myIdentity = room ? room.localParticipant.identity : null;
  const myAccountId = me?.accountId ?? null;
  const baseOf = (identity: string): string => identity.split('#')[0] ?? identity;
  const nameFor = (identity: string): string => {
    if (identity === myIdentity) return me?.displayName ?? 'Вы';
    const acc = baseOf(identity);
    const name =
      (acc === myAccountId ? me?.displayName : undefined) ??
      session?.participants.find((p) => p.accountId === acc)?.displayName ??
      mediaParticipants.find((p) => p.accountId === acc)?.name ??
      acc;
    // Disambiguate when the same person is in from more than one device.
    const sameAccount = mediaParticipants.filter((p) => p.accountId === acc);
    if (sameAccount.length > 1) {
      const idx = sameAccount.findIndex((p) => p.id === identity);
      return idx >= 0 ? `${name} (${idx + 1})` : name;
    }
    return name;
  };

  const toggleFullscreen = () => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else el.requestFullscreen?.().catch(() => setSurfaceMode('expanded'));
  };

  const goToInvite = async () => {
    if (!pendingInvite) return;
    try {
      const pt = await getHandoff();
      const url = new URL(pendingInvite.url, window.location.href);
      if (pt) url.searchParams.set('pt', pt);
      url.searchParams.set('join', pendingInvite.room);
      // The call key rides along so resume() re-joins the same LiveKit room on the game's origin —
      // nobody else in the call ever reconnects.
      url.searchParams.set('call', `game:${pendingInvite.game}:${pendingInvite.room}`);
      window.location.href = url.toString();
    } catch {
      dismissInvite();
    }
  };

  const expanded = expandedSurface;
  const pos = dockPosition;
  const containerStyle = expanded
    ? {
        position: 'fixed' as const,
        inset: 0,
        zIndex: mgZ.call,
        pointerEvents: 'auto' as const,
        display: 'flex',
        flexDirection: 'column' as const,
        background: palette.stage,
        // Full-screen on phones: keep the top bar off the notch and the control bar above the
        // home indicator.
        paddingTop: 'env(safe-area-inset-top, 0px)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }
    : {
        position: 'fixed' as const,
        left: pos.x,
        top: pos.y,
        width: Math.min(DOCK_W, vp.w - 16),
        height: Math.min(DOCK_H, vp.h - 16),
        zIndex: mgZ.call,
        pointerEvents: 'auto' as const,
        display: 'flex',
        flexDirection: 'column' as const,
        background: palette.stage,
        borderRadius: mg.rLg,
        overflow: 'hidden',
        border: `1px solid ${palette.border}`,
        boxShadow: mg.shadowWindow,
      };

  const ringingStatus = activeCall
    ? activeCall.status === 'connected'
      ? ('connecting' as const)
      : activeCall.status
    : ('connecting' as const);

  const topBar = (
    <div
      onPointerDown={dockHandle.onPointerDown}
      style={{
        flexShrink: 0,
        height: 40,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '0 10px',
        background: palette.tileBgAlt,
        color: palette.text,
        ...dockHandle.style,
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        📞 {title}
      </span>
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
        {connected && (
          <>
            {expanded ? (
              <button onClick={() => setSurfaceMode('docked')} style={chromeButton} title="Свернуть" aria-label="Свернуть окно звонка">
                ⤡
              </button>
            ) : (
              <button onClick={() => setSurfaceMode('expanded')} style={chromeButton} title="Развернуть" aria-label="Развернуть окно звонка">
                ⤢
              </button>
            )}
            <button onClick={toggleFullscreen} style={chromeButton} title="На весь экран" aria-label="На весь экран">
              {isFullscreen ? '🡼' : '⛶'}
            </button>
          </>
        )}
      </div>
    </div>
  );

  const inviteBanner = pendingInvite && (
    <div
      style={{
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 12px',
        background: mg.positiveSoft,
        borderBottom: `1px solid ${palette.border}`,
        color: palette.text,
        fontSize: 13,
      }}
    >
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        🎮 {pendingInvite.fromName || 'Участник звонка'} зовёт в {pendingInvite.gameName}
      </span>
      <button
        onClick={() => void goToInvite()}
        style={{ ...chromeButton, background: mg.positive, fontWeight: 700 }}
        aria-label={`Перейти в ${pendingInvite.gameName}`}
      >
        Перейти
      </button>
      <button onClick={dismissInvite} style={chromeButton} aria-label="Скрыть приглашение">
        Скрыть
      </button>
    </div>
  );

  return (
    <div ref={containerRef} style={containerStyle}>
      {topBar}
      {inviteBanner}
      {connected ? (
        <RoomContext.Provider key={currentKey ?? 'call'} value={room}>
          <ConnectionBanner />
          <CallStage nameFor={nameFor} myIdentity={myIdentity} pinnedKey={pinnedKey} onPin={setPinnedKey} />
          <ControlBar />
          <RoomAudioRenderer />
        </RoomContext.Provider>
      ) : (
        <RingingView
          status={ringingStatus}
          type={activeCall?.type ?? 'audio'}
          name={title}
          identity={conversationId ?? currentKey ?? 'call'}
          onAccept={() => activeCall && void acceptCall(activeCall.conversationId)}
          onDecline={() => activeCall && declineCall(activeCall.conversationId)}
          onCancel={() => hangup()}
        />
      )}
    </div>
  );
};
