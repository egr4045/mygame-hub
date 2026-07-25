import { useMediaDeviceSelect } from '@livekit/components-react';
import { palette } from './callStyles.js';

/** localStorage keys for the default devices — read by `createCallRoom` (callStore) so every call
 *  opens with them. Written both here (in-call switch) and by the PermissionsModal device pickers.
 *  Speaker persists too: LiveKit applies it as the room's `audioOutput` sinkId on the next call. */
export const DEVICE_KEYS = { mic: 'mygame:call:mic', cam: 'mygame:call:cam', speaker: 'mygame:call:speaker' } as const;

const persist = (key: string, id: string): void => {
  try {
    localStorage.setItem(key, id);
  } catch {
    /* private mode / storage disabled — non-fatal */
  }
};

const Section = ({
  title,
  kind,
  persistKey,
}: {
  title: string;
  kind: MediaDeviceKind;
  persistKey?: string;
}): JSX.Element => {
  const { devices, activeDeviceId, setActiveMediaDevice } = useMediaDeviceSelect({ kind });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ color: palette.subtle, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {title}
      </div>
      {devices.length === 0 && <div style={{ color: palette.subtle, fontSize: 12 }}>Нет устройств</div>}
      {devices.map((d) => {
        const active = d.deviceId === activeDeviceId;
        return (
          <button
            key={d.deviceId}
            onClick={() => {
              void setActiveMediaDevice(d.deviceId);
              if (persistKey) persist(persistKey, d.deviceId);
            }}
            style={{
              textAlign: 'left',
              background: active ? palette.accent : 'transparent',
              color: active ? '#fff' : palette.text,
              border: 'none',
              borderRadius: 6,
              padding: '6px 8px',
              cursor: 'pointer',
              fontSize: 12,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: 260,
            }}
          >
            {active ? '✓ ' : ''}
            {d.label || `${title} ${d.deviceId.slice(0, 6)}`}
          </button>
        );
      })}
    </div>
  );
};

/** Popover with mic / camera / speaker pickers. Rendered above the ⚙️ control-bar button. Selecting a
 *  device switches it live via LiveKit's `switchActiveDevice` (mic/cam re-capture, speaker sets
 *  sinkId on the room's audio elements). */
export const DeviceMenu = ({ onClose }: { onClose: () => void }): JSX.Element => (
  <>
    {/* click-catcher to dismiss */}
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1 }} />
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        bottom: 60,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 2,
        width: 300,
        maxHeight: 340,
        overflowY: 'auto',
        background: palette.tileBgAlt,
        border: `1px solid ${palette.border}`,
        borderRadius: 10,
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        boxShadow: '0 8px 24px rgba(0,0,0,0.55)',
      }}
    >
      <Section title="Микрофон" kind="audioinput" persistKey={DEVICE_KEYS.mic} />
      <Section title="Камера" kind="videoinput" persistKey={DEVICE_KEYS.cam} />
      <Section title="Динамик" kind="audiooutput" persistKey={DEVICE_KEYS.speaker} />
    </div>
  </>
);
