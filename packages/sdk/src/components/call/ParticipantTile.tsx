import { Track, ConnectionQuality, type Participant } from 'livekit-client';
import {
  VideoTrack,
  useIsSpeaking,
  useIsMuted,
  useConnectionQualityIndicator,
  type TrackReference,
} from '@livekit/components-react';
import { palette, tileBase, coverVideo } from './callStyles.js';
import { initials, avatarColor } from './callLayout.js';

/** One participant in the call grid/spotlight: their camera (or an avatar fallback when the camera
 *  is off), a name label, a mic-muted badge, an active-speaker ring, and a connection-quality dot.
 *  Fully reactive — driven by LiveKit hooks, so labels/badges/rings update from real track events
 *  (unlike the old imperative DOM tiles which could carry no per-participant state). */
export const ParticipantTile = ({
  participant,
  cameraRef,
  name,
  isLocal,
  pinned,
  onClick,
}: {
  participant: Participant;
  cameraRef?: TrackReference | undefined;
  name: string;
  isLocal: boolean;
  pinned?: boolean;
  onClick?: () => void;
}): JSX.Element => {
  const speaking = useIsSpeaking(participant);
  const camMuted = useIsMuted(cameraRef ?? { participant, source: Track.Source.Camera });
  const micMuted = useIsMuted({ participant, source: Track.Source.Microphone });
  const { quality } = useConnectionQualityIndicator({ participant });
  const showVideo = !!cameraRef && !camMuted;

  const qualityColor =
    quality === ConnectionQuality.Poor
      ? palette.warning
      : quality === ConnectionQuality.Lost
        ? palette.danger
        : quality === ConnectionQuality.Excellent || quality === ConnectionQuality.Good
          ? palette.speaking
          : null;

  return (
    <div
      onClick={onClick}
      title={onClick ? (pinned ? 'Открепить' : 'Закрепить') : undefined}
      style={{
        ...tileBase,
        cursor: onClick ? 'pointer' : 'default',
        boxShadow: speaking ? `0 0 0 3px ${palette.speaking}, 0 0 14px rgba(59,165,93,0.45)` : 'none',
        outline: pinned ? `2px solid ${palette.blue}` : 'none',
        outlineOffset: -2,
        transition: 'box-shadow 120ms ease',
      }}
    >
      {showVideo ? (
        <VideoTrack
          trackRef={cameraRef}
          style={{ ...coverVideo, transform: isLocal ? 'scaleX(-1)' : undefined }}
        />
      ) : (
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: '50%',
            background: avatarColor(participant.identity),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontSize: 26,
            fontWeight: 700,
            letterSpacing: 0.5,
          }}
        >
          {initials(name)}
        </div>
      )}

      {/* name + mic badge */}
      <div
        style={{
          position: 'absolute',
          left: 8,
          bottom: 8,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          maxWidth: 'calc(100% - 16px)',
          background: 'rgba(0,0,0,0.55)',
          borderRadius: 6,
          padding: '3px 8px',
        }}
      >
        {micMuted && <span style={{ fontSize: 12 }}>🔇</span>}
        <span
          style={{
            color: '#fff',
            fontSize: 12,
            fontWeight: 600,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {isLocal ? `${name} (Вы)` : name}
        </span>
      </div>

      {qualityColor && (
        <span
          title="Качество связи"
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            width: 9,
            height: 9,
            borderRadius: '50%',
            background: qualityColor,
            boxShadow: '0 0 0 2px rgba(0,0,0,0.35)',
          }}
        />
      )}
    </div>
  );
};
