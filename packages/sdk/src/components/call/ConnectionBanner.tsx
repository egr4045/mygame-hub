import { ConnectionState } from 'livekit-client';
import { useConnectionState } from '@livekit/components-react';

/** A thin banner shown while LiveKit is auto-reconnecting a dropped call. Must be rendered inside
 *  CallView's `RoomContext.Provider`. Terminal failure (give-up) is handled in chatStore's
 *  `RoomEvent.Disconnected` handler, which tears the call down with an error. */
export const ConnectionBanner = (): JSX.Element | null => {
  const state = useConnectionState();
  if (state !== ConnectionState.Reconnecting && state !== ConnectionState.SignalReconnecting) return null;
  return (
    <div
      style={{
        flexShrink: 0,
        background: '#f0b232',
        color: '#1b1b1b',
        fontSize: 13,
        fontWeight: 700,
        textAlign: 'center',
        padding: '6px 12px',
      }}
    >
      Переподключение…
    </div>
  );
};
