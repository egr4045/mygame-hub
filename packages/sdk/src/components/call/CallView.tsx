import { useEffect, useRef, useState } from 'react';
import { RoomContext, RoomAudioRenderer } from '@livekit/components-react';
import { useChatStore } from '../../state/chatStore.js';
import { getCallRoom } from '../../state/callStore.js';
import { useSocialStore } from '../../state/socialStore.js';
import { CallStage } from './CallStage.js';
import { ControlBar } from './ControlBar.js';
import { RingingView } from './RingingView.js';
import { ConnectionBanner } from './ConnectionBanner.js';
import { palette, chromeButton } from './callStyles.js';

/** Top-level call surface — mounted once, globally (a sibling of ChatWidget at the overlay and hub
 *  roots), driven solely by `activeCall`. It is independent of which chat is open, so the call stays
 *  put while you browse other conversations. Renders nothing when there's no call.
 *
 *  Surface modes: `docked` (a floating PiP window) and `expanded` (full-viewport), plus true OS
 *  fullscreen via the Fullscreen API (falls back to `expanded` if the browser refuses). The media is
 *  rendered inside a `RoomContext.Provider` over the singleton room so all the LiveKit hooks work. */
export const CallView = (): JSX.Element | null => {
  const activeCall = useChatStore((s) => s.activeCall);
  const sessions = useChatStore((s) => s.sessions);
  const acceptCall = useChatStore((s) => s.acceptCall);
  const declineCall = useChatStore((s) => s.declineCall);
  const hangup = useChatStore((s) => s.hangup);
  const me = useSocialStore((s) => s.me);

  const [surfaceMode, setSurfaceMode] = useState<'docked' | 'expanded'>('docked');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [pinnedKey, setPinnedKey] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const conversationId = activeCall?.conversationId ?? null;
  useEffect(() => {
    setPinnedKey(null);
    setSurfaceMode('docked');
  }, [conversationId]);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  if (!activeCall) return null;

  const session = sessions.find((s) => s.id === activeCall.conversationId);
  const title = session?.name ?? activeCall.fromName ?? 'Звонок';
  const myIdentity = me?.accountId ?? null;
  const nameFor = (identity: string): string => {
    if (identity === myIdentity) return me?.displayName ?? 'Вы';
    return session?.participants.find((p) => p.accountId === identity)?.displayName ?? identity;
  };

  const toggleFullscreen = () => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else el.requestFullscreen?.().catch(() => setSurfaceMode('expanded'));
  };

  const expanded = isFullscreen || surfaceMode === 'expanded';
  const containerStyle = expanded
    ? {
        position: 'fixed' as const,
        inset: 0,
        zIndex: 1600,
        pointerEvents: 'auto' as const,
        display: 'flex',
        flexDirection: 'column' as const,
        background: palette.stage,
      }
    : {
        position: 'fixed' as const,
        right: 24,
        bottom: 24,
        width: 460,
        height: 380,
        zIndex: 1600,
        pointerEvents: 'auto' as const,
        display: 'flex',
        flexDirection: 'column' as const,
        background: palette.stage,
        borderRadius: 12,
        overflow: 'hidden',
        border: `1px solid ${palette.border}`,
        boxShadow: '0 16px 48px rgba(0,0,0,0.6)',
      };

  const connected = activeCall.status === 'connected';
  const room = connected ? getCallRoom() : null;

  const topBar = (
    <div
      style={{
        flexShrink: 0,
        height: 40,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '0 10px',
        background: palette.tileBgAlt,
        color: palette.text,
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        📞 {title}
      </span>
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
        {connected && (
          <>
            {expanded ? (
              <button onClick={() => setSurfaceMode('docked')} style={chromeButton} title="Свернуть">
                ⤡
              </button>
            ) : (
              <button onClick={() => setSurfaceMode('expanded')} style={chromeButton} title="Развернуть">
                ⤢
              </button>
            )}
            <button onClick={toggleFullscreen} style={chromeButton} title="На весь экран">
              {isFullscreen ? '🡼' : '⛶'}
            </button>
          </>
        )}
      </div>
    </div>
  );

  return (
    <div ref={containerRef} style={containerStyle}>
      {topBar}
      {connected && room ? (
        <RoomContext.Provider key={activeCall.conversationId} value={room}>
          <ConnectionBanner />
          <CallStage nameFor={nameFor} myIdentity={myIdentity} pinnedKey={pinnedKey} onPin={setPinnedKey} />
          <ControlBar />
          <RoomAudioRenderer />
        </RoomContext.Provider>
      ) : (
        <RingingView
          status={activeCall.status === 'connected' ? 'connecting' : activeCall.status}
          type={activeCall.type}
          name={title}
          identity={activeCall.conversationId}
          onAccept={() => void acceptCall(activeCall.conversationId)}
          onDecline={() => declineCall(activeCall.conversationId)}
          onCancel={() => hangup()}
        />
      )}
    </div>
  );
};
