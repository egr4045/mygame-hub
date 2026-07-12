import { useState } from 'react';
import { useLocalParticipant } from '@livekit/components-react';
import { useChatStore } from '../../state/chatStore.js';
import { useCallStore } from '../../state/callStore.js';
import { controlButton, controlItem, controlCaption, palette } from './callStyles.js';
import { DeviceMenu } from './DeviceMenu.js';

/* ── Inline SVG icons ──────────────────────────────────────────────────────────
 * Small, dependency-free glyphs drawn with `currentColor` so they inherit the button's
 * text color (white). ~22px, viewBox 0 0 24 24. Mic/cam render a diagonal slash when muted
 * so the off-state is obvious even before the danger-red background registers. */

const SLASH = <line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />;

const svgProps = {
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false,
};

const MicIcon = ({ muted }: { muted: boolean }): JSX.Element => (
  <svg {...svgProps}>
    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" y1="19" x2="12" y2="22" />
    {muted && SLASH}
  </svg>
);

const CameraIcon = ({ muted }: { muted: boolean }): JSX.Element => (
  <svg {...svgProps}>
    <path d="m22 8-6 4 6 4V8Z" />
    <rect x="2" y="6" width="14" height="12" rx="2" />
    {muted && SLASH}
  </svg>
);

/** Monitor with an up-arrow inside = "share this screen". */
const ScreenIcon = (): JSX.Element => (
  <svg {...svgProps}>
    <rect x="2" y="3" width="20" height="14" rx="2" />
    <line x1="8" y1="21" x2="16" y2="21" />
    <line x1="12" y1="17" x2="12" y2="21" />
    <path d="M12 12V6" />
    <path d="m9 9 3-3 3 3" />
  </svg>
);

const GearIcon = (): JSX.Element => (
  <svg {...svgProps}>
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

/** A filled phone handset rotated 135° so it points down — the universal "end call" glyph. */
const HangupIcon = (): JSX.Element => (
  <svg width={22} height={22} viewBox="0 0 24 24" aria-hidden focusable={false}>
    <g transform="rotate(135 12 12)">
      <path
        fill="currentColor"
        d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"
      />
    </g>
  </svg>
);

/** The in-call control bar. Button on/off state is derived from `useLocalParticipant` (the real
 *  track state) rather than optimistic local React state — so it can never drift from the actual
 *  mute/camera/screen-share status, which was the old bug. Media toggles go to `callStore` (the
 *  media owner); hangup goes through `chatStore` so conv-call signaling clears too (for game calls
 *  it degrades to a plain `callStore.leave()`).
 *
 *  Each control is an icon + tiny caption. Off-states (mic/cam muted) are triple-encoded — slashed
 *  icon, red `danger` button, red caption — so it's never ambiguous whether a device is live. */
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
        alignItems: 'flex-start',
        justifyContent: 'center',
        gap: 12,
        padding: '12px 16px',
        background: palette.panel,
        position: 'relative',
      }}
    >
      <div style={controlItem}>
        <button
          onClick={() => void setMic(!isMicrophoneEnabled)}
          style={controlButton(isMicrophoneEnabled ? 'neutral' : 'danger')}
          title={isMicrophoneEnabled ? 'Выключить микрофон' : 'Включить микрофон'}
          aria-label={isMicrophoneEnabled ? 'Выключить микрофон' : 'Включить микрофон'}
          aria-pressed={isMicrophoneEnabled}
        >
          <MicIcon muted={!isMicrophoneEnabled} />
        </button>
        <span style={controlCaption(isMicrophoneEnabled ? 'subtle' : 'danger')}>
          {isMicrophoneEnabled ? 'Микрофон' : 'Выкл'}
        </span>
      </div>

      <div style={controlItem}>
        <button
          onClick={() => void setCam(!isCameraEnabled)}
          style={controlButton(isCameraEnabled ? 'neutral' : 'danger')}
          title={isCameraEnabled ? 'Выключить камеру' : 'Включить камеру'}
          aria-label={isCameraEnabled ? 'Выключить камеру' : 'Включить камеру'}
          aria-pressed={isCameraEnabled}
        >
          <CameraIcon muted={!isCameraEnabled} />
        </button>
        <span style={controlCaption(isCameraEnabled ? 'subtle' : 'danger')}>
          {isCameraEnabled ? 'Камера' : 'Выкл'}
        </span>
      </div>

      <div style={controlItem}>
        <button
          onClick={() => void setScreenShare(!isScreenShareEnabled)}
          style={controlButton(isScreenShareEnabled ? 'active' : 'neutral')}
          title={isScreenShareEnabled ? 'Остановить демонстрацию' : 'Демонстрация экрана'}
          aria-label={isScreenShareEnabled ? 'Остановить демонстрацию экрана' : 'Демонстрация экрана'}
          aria-pressed={isScreenShareEnabled}
        >
          <ScreenIcon />
        </button>
        <span style={controlCaption(isScreenShareEnabled ? 'active' : 'subtle')}>Экран</span>
      </div>

      <div style={{ ...controlItem, position: 'relative' }}>
        <button
          onClick={() => setDevicesOpen((o) => !o)}
          style={controlButton(devicesOpen ? 'active' : 'neutral')}
          title="Устройства"
          aria-label="Устройства"
          aria-expanded={devicesOpen}
        >
          <GearIcon />
        </button>
        <span style={controlCaption(devicesOpen ? 'active' : 'subtle')}>Устройства</span>
        {devicesOpen && <DeviceMenu onClose={() => setDevicesOpen(false)} />}
      </div>

      <div style={controlItem}>
        <button
          onClick={() => hangup()}
          style={controlButton('danger')}
          title="Завершить звонок"
          aria-label="Завершить звонок"
        >
          <HangupIcon />
        </button>
        <span style={controlCaption('danger')}>Завершить</span>
      </div>
    </div>
  );
};
