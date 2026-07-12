import { Track } from 'livekit-client';
import { useParticipants, useTracks } from '@livekit/components-react';
import { ParticipantTile } from './ParticipantTile.js';
import { ScreenShareTile } from './ScreenShareTile.js';
import { gridColumns } from './callLayout.js';
import { palette } from './callStyles.js';

/** Renders the connected-call media. Layout precedence: a pinned tile or any active screen share is
 *  spotlighted (large) with the remaining camera tiles in a filmstrip; otherwise everyone sits in a
 *  square-ish grid. Pure presentation over LiveKit hooks — must be rendered inside CallView's
 *  `RoomContext.Provider`. */
export const CallStage = ({
  nameFor,
  myIdentity,
  pinnedKey,
  onPin,
}: {
  nameFor: (identity: string) => string;
  myIdentity: string | null;
  pinnedKey: string | null;
  onPin: (key: string | null) => void;
}): JSX.Element => {
  const participants = useParticipants();
  const cameraTracks = useTracks([Track.Source.Camera]);
  const screenTracks = useTracks([Track.Source.ScreenShare]);

  const cameraFor = (identity: string) => cameraTracks.find((t) => t.participant.identity === identity);

  // Resolve the spotlight: an explicit pin wins, else auto-spotlight the first shared screen.
  const screenKeys = screenTracks.map((t) => `screen:${t.participant.identity}`);
  const pinValid =
    pinnedKey != null &&
    (screenKeys.includes(pinnedKey) || participants.some((p) => `cam:${p.identity}` === pinnedKey));
  const spotlightKey = pinValid ? pinnedKey : screenKeys[0] ?? null;

  const camTile = (identity: string, key: string) => {
    const p = participants.find((x) => x.identity === identity);
    if (!p) return null;
    return (
      <ParticipantTile
        key={key}
        participant={p}
        cameraRef={cameraFor(identity)}
        name={nameFor(identity)}
        isLocal={identity === myIdentity}
        pinned={key === spotlightKey}
        onClick={() => onPin(key === pinnedKey ? null : key)}
      />
    );
  };

  // --- Grid (no spotlight) -------------------------------------------------
  if (!spotlightKey) {
    const cols = gridColumns(participants.length);
    return (
      <div
        style={{
          flex: 1,
          minHeight: 0,
          padding: 14,
          display: 'grid',
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gridAutoRows: '1fr',
          gap: 12,
        }}
      >
        {participants.map((p) => camTile(p.identity, `cam:${p.identity}`))}
      </div>
    );
  }

  // --- Spotlight + filmstrip ----------------------------------------------
  const spotlightScreen = screenTracks.find((t) => `screen:${t.participant.identity}` === spotlightKey);
  const filmstrip = participants.filter((p) => `cam:${p.identity}` !== spotlightKey);

  return (
    <div style={{ flex: 1, minHeight: 0, padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {spotlightScreen ? (
          <ScreenShareTile
            trackRef={spotlightScreen}
            label={`${nameFor(spotlightScreen.participant.identity)} — экран`}
            pinned={pinValid}
            onClick={() => onPin(pinnedKey === spotlightKey ? null : spotlightKey)}
          />
        ) : (
          camTile(spotlightKey.slice(4), spotlightKey)
        )}
      </div>
      {filmstrip.length > 0 && (
        <div
          style={{
            height: 96,
            flexShrink: 0,
            display: 'flex',
            gap: 10,
            overflowX: 'auto',
            overflowY: 'hidden',
            scrollbarWidth: 'thin',
          }}
        >
          {filmstrip.map((p) => (
            <div key={`cam:${p.identity}`} style={{ width: 150, flexShrink: 0, background: palette.tileBg, borderRadius: 10 }}>
              {camTile(p.identity, `cam:${p.identity}`)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
