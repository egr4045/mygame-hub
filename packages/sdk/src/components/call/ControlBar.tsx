import { useState } from 'react';
import { useLocalParticipant } from '@livekit/components-react';
import { useChatStore } from '../../state/chatStore.js';
import { useCallStore } from '../../state/callStore.js';
import { controlButton, palette } from './callStyles.js';
import { DeviceMenu } from './DeviceMenu.js';

/** The in-call control bar. Button on/off state is derived from `useLocalParticipant` (the real
 *  track state) rather than optimistic local React state — so it can never drift from the actual
 *  mute/camera/screen-share status, which was the old bug. Media toggles go to `callStore` (the
 *  media owner); hangup goes through `chatStore` so conv-call signaling clears too (for game calls
 *  it degrades to a plain `callStore.leave()`). */
export const ControlBar = (): JSX.Element => {
  const { isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled } = useLocalParticipant();
  const setMic = useCallStore((s) => s.setMic);
  const setCam = useCallStore((s) => s.setCam);
  const setScreenShare = useCallStore((s) => s.setScreenShare);
  const hangup = useChatStore((s) => s.hangup);
  const [devicesOpen, setDevicesOpen] = useState(false);

  return (
    <div
      style={{
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14,
        padding: '12px 16px',
        background: palette.panel,
        position: 'relative',
      }}
    >
      <button
        onClick={() => void setMic(!isMicrophoneEnabled)}
        style={controlButton(isMicrophoneEnabled ? 'neutral' : 'danger')}
        title={isMicrophoneEnabled ? 'Выключить микрофон' : 'Включить микрофон'}
        aria-label={isMicrophoneEnabled ? 'Выключить микрофон' : 'Включить микрофон'}
        aria-pressed={isMicrophoneEnabled}
      >
        {isMicrophoneEnabled ? '🎤' : '🔇'}
      </button>
      <button
        onClick={() => void setCam(!isCameraEnabled)}
        style={controlButton(isCameraEnabled ? 'neutral' : 'danger')}
        title={isCameraEnabled ? 'Выключить камеру' : 'Включить камеру'}
        aria-label={isCameraEnabled ? 'Выключить камеру' : 'Включить камеру'}
        aria-pressed={isCameraEnabled}
      >
        {isCameraEnabled ? '📹' : '🚫'}
      </button>
      <button
        onClick={() => void setScreenShare(!isScreenShareEnabled)}
        style={controlButton(isScreenShareEnabled ? 'active' : 'neutral')}
        title={isScreenShareEnabled ? 'Остановить демонстрацию' : 'Демонстрация экрана'}
        aria-label={isScreenShareEnabled ? 'Остановить демонстрацию экрана' : 'Демонстрация экрана'}
        aria-pressed={isScreenShareEnabled}
      >
        🖥️
      </button>

      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setDevicesOpen((o) => !o)}
          style={controlButton(devicesOpen ? 'active' : 'neutral')}
          title="Устройства"
          aria-label="Устройства"
          aria-expanded={devicesOpen}
        >
          ⚙️
        </button>
        {devicesOpen && <DeviceMenu onClose={() => setDevicesOpen(false)} />}
      </div>

      <button onClick={() => hangup()} style={controlButton('danger')} title="Завершить звонок" aria-label="Завершить звонок">
        📞
      </button>
    </div>
  );
};
