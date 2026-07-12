import type { chat } from '@mygame/protocol';
import { controlButton, palette } from './callStyles.js';
import { initials, avatarColor } from './callLayout.js';

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
  const kindLabel = type === 'video' ? 'видео' : type === 'screen' ? 'демонстрация экрана' : 'аудио';
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
      </div>

      {status === 'ringing-in' ? (
        <div style={{ display: 'flex', gap: 28 }}>
          <button onClick={onAccept} style={controlButton('active')} title="Принять">
            ✓
          </button>
          <button onClick={onDecline} style={controlButton('danger')} title="Отклонить">
            ✕
          </button>
        </div>
      ) : (
        <button onClick={onCancel} style={controlButton('danger')} title="Отменить">
          📞
        </button>
      )}
    </div>
  );
};
