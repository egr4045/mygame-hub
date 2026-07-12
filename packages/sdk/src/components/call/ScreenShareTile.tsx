import { VideoTrack, type TrackReference } from '@livekit/components-react';
import { palette, containVideo } from './callStyles.js';

/** The large, letterboxed surface for a shared screen. `object-fit: contain` (not cover) so text
 *  stays readable and nothing is cropped. Rendered by CallStage in screenshare-priority layout. */
export const ScreenShareTile = ({
  trackRef,
  label,
  onClick,
  pinned,
}: {
  trackRef: TrackReference;
  label: string;
  onClick?: () => void;
  pinned?: boolean;
}): JSX.Element => (
  <div
    onClick={onClick}
    style={{
      position: 'relative',
      flex: 1,
      minHeight: 0,
      minWidth: 0,
      background: '#000',
      borderRadius: 10,
      overflow: 'hidden',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      outline: pinned ? `2px solid ${palette.blue}` : 'none',
      outlineOffset: -2,
      cursor: onClick ? 'pointer' : 'default',
    }}
  >
    <VideoTrack trackRef={trackRef} style={containVideo} />
    <div
      style={{
        position: 'absolute',
        left: 10,
        top: 10,
        background: 'rgba(0,0,0,0.6)',
        borderRadius: 6,
        padding: '3px 9px',
        color: '#fff',
        fontSize: 12,
        fontWeight: 600,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}
    >
      <span>🖥️</span>
      <span>{label}</span>
    </div>
  </div>
);
