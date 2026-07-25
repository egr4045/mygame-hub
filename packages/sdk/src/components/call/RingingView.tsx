import { useEffect, useState } from 'react';
import type { chat } from '@mygame/protocol';
import { controlButton, palette } from './callStyles.js';
import { initials, avatarColor } from './callLayout.js';
import { isAudioReady, installGestureUnlock } from '../../sound.js';
import { mg } from '../../theme/tokens.js';

type Status = 'ringing-out' | 'ringing-in' | 'connecting';

/** Pre-connected states: dialing out, incoming ring (accept/decline), and the brief connecting spinner.
 *  Media hasn't started, so this needs no RoomContext. */
export const RingingView = ({
  status,
  type,
  name,
  identity,
  onAccept,
  onDecline,
  onCancel,
}: {
  status: Status;
  type: chat.CallType;
  name: string;
  identity: string;
  onAccept: () => void;
  onDecline: () => void;
  onCancel: () => void;
}): JSX.Element => {
  // 'screen' is a deprecated call type the store already coerces to 'video' before it gets here.
  const kindLabel = type === 'video' ? 'видео' : 'аудио';

  // Autoplay policy: on a fresh tab the ringtone can be silently suspended until a user gesture.
  // Surface that as a tappable chip — the tap itself is the unlocking gesture.
  const [audioReady, setAudioReady] = useState(isAudioReady);
  useEffect(() => {
    if (audioReady) return undefined;
    installGestureUnlock();
    const t = setInterval(() => {
      if (isAudioReady()) setAudioReady(true);
    }, 500);
    return () => clearInterval(t);
  }, [audioReady]);

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 20,
        color: palette.text,
        padding: 24,
      }}
    >
      <div
        style={{
          width: 96,
          height: 96,
          borderRadius: '50%',
          background: avatarColor(identity),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 34,
          fontWeight: 700,
          color: '#fff',
          animation: status === 'ringing-in' ? 'mygame-call-pulse 1.4s ease-out infinite' : undefined,
        }}
      >
        {initials(name)}
      </div>

      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>{name}</div>
        <div style={{ color: palette.subtle, fontSize: 13, marginTop: 4 }}>
          {status === 'ringing-out' && `Звоним… (${kindLabel})`}
          {status === 'ringing-in' && `Входящий звонок (${kindLabel})`}
          {status === 'connecting' && 'Подключение…'}
        </div>
        {status === 'ringing-in' && !audioReady && (
          <button
            onClick={() => setAudioReady(isAudioReady())}
            style={{
              marginTop: 10,
              background: mg.warning,
              color: mg.textInverse,
              border: 'none',
              borderRadius: mg.rPill,
              padding: '4px 12px',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            🔇 Включить звук
          </button>
        )}
      </div>

      {status === 'ringing-in' ? (
        <div style={{ display: 'flex', gap: 28 }}>
          <button onClick={onAccept} style={controlButton('active')} title="Принять" aria-label="Принять звонок">
            ✓
          </button>
          <button onClick={onDecline} style={controlButton('danger')} title="Отклонить" aria-label="Отклонить звонок">
            ✕
          </button>
        </div>
      ) : (
        <button onClick={onCancel} style={controlButton('danger')} title="Отменить" aria-label="Отменить звонок">
          📞
        </button>
      )}
    </div>
  );
};
